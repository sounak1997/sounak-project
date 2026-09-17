# Deploying to Oracle Cloud Always Free

Target: **₹0/month, permanently.** Replaces the AWS setup, which started billing
~$14/mo once the 12-month free tier expired. The account was created
2025-07-29, so the free tier ended 2026-07-29. All AWS resources were
terminated 2026-09-02 and verified clean across all 17 regions.

## Architecture

```
Browser ──► nginx :80 ──► Express :3000 ──► AI service 127.0.0.1:8000 ──► Gemini
                             │
                             └─► serves the Angular dist (SAME-ORIGIN)
                             └─► MongoDB Atlas M0 (external, free forever)
```

Everything except Mongo runs on one Oracle ARM VM. **Keep the frontend on the
same host as the backend.** The Angular app uses `apiUrl: ''` (relative URLs),
so there is no CORS and no HTTPS/mixed-content problem. Splitting the frontend
onto Cloudflare Pages breaks all three at once — don't, until you own a domain.

| Piece | Where | Cost |
|---|---|---|
| Angular + Express + Python AI | Oracle VM.Standard.A1.Flex (4 OCPU, 24 GB) | Free always |
| MongoDB | Atlas M0 | Free always |
| LLM | Gemini API | Free tier |

---

## Phase 0 — Local prep (do this first)

### 0.1 SSH key ✅ done
`~/.ssh/oracle.key` / `.pub` already generated (RSA 4096).

### 0.2 Push your code — REQUIRED
`provision.sh` clones from GitHub, so anything uncommitted will be **missing on
the server**. At last check there were 13 modified and 166 untracked files,
including `provision.sh` and `nginx/sounak.conf` themselves.

```bash
cd "~/Desktop/sounak project"
git status                 # review — don't blind-commit 166 files
git add provision.sh nginx/sounak.conf docs/DEPLOYMENT.md
git add <the source files you actually want>
git commit -m "chore: provisioning script and nginx config for Oracle deploy"
git push origin master
```

Confirm `provision.sh` is really on GitHub before continuing — the server
cannot get it any other way.

---

## Phase 1 — Oracle account

1. Sign up at <https://cloud.oracle.com/> → *Start for free*
2. Credit card is for **identity verification only** (~₹100 hold, refunded).
   You are not charged unless you explicitly click *Upgrade to Paid*.
3. **Home region cannot be changed later.** Pick a less-busy region for a better
   chance at ARM capacity. From India, `ap-hyderabad-1` and `ap-mumbai-1` are
   convenient but often full; `ap-osaka-1` or `eu-frankfurt-1` are often easier.
4. You start on a 30-day trial with $300 credits, then auto-drop to Always Free.
   **Stay within the free shapes from day one** so nothing gets reclaimed.

---

## Phase 2 — Create the VM

Compute → Instances → **Create instance**

| Field | Value |
|---|---|
| Image | **Ubuntu 24.04** (ARM build) |
| Shape | **VM.Standard.A1.Flex** ← must be Ampere, not the AMD micro |
| OCPUs | **4** |
| Memory | **24 GB** |
| Boot volume | 50 GB (200 GB total is free; 50 is plenty) |
| SSH key | **Paste `~/.ssh/oracle.key.pub`** |
| Public IPv4 | Assign |

That's the entire Always Free ARM allowance in one machine — use all of it.

> **"Out of host capacity"** is extremely common on A1.Flex. It is not your
> mistake. Retry across the three availability domains, retry at a different
> hour, or fall back to `VM.Standard.E2.1.Micro` (AMD, 1 GB RAM) — the provision
> script detects low RAM and builds the 2 GB swapfile automatically.

Note the public IP when it boots.

---

## Phase 3 — Open the firewall (BOTH halves)

This is the #1 reason an Oracle VM appears dead. There are **two** firewalls.

**3.1 Cloud-side.** Networking → Virtual Cloud Networks → your VCN → Subnet →
Security List → **Add Ingress Rules**:

| Source | Protocol | Dest. port |
|---|---|---|
| `0.0.0.0/0` | TCP | 80 |
| `0.0.0.0/0` | TCP | 443 |

**3.2 Host-side.** Oracle's images ship iptables rules that REJECT everything
but SSH. `provision.sh` step 7 adds and persists the rules for 80/443, so this
half is automated — but if you skip the script, you must do it by hand.

---

## Phase 4 — Provision

```bash
ssh -i ~/.ssh/oracle.key ubuntu@<PUBLIC_IP>

git clone https://github.com/sounak1997/sounak-project.git ~/sounak-project
cd ~/sounak-project
./provision.sh
```

Takes 10–20 minutes. The slow part is `pip install` — on ARM, `chromadb` pulls
`onnxruntime`, which may compile from source.

The script installs Node 22, Python (3.11 via dnf on Oracle Linux; the system
3.10+ on Ubuntu, which parses `str | None` fine), builds the venv, runs
`npm ci`, builds Angular with `--configuration production`, installs the nginx
conf, opens the firewall, and starts both services under PM2 with boot
persistence.

---

## Phase 5 — Secrets and database

### 5.1 Copy the `.env` files
They are deliberately never in git. From your laptop:

```bash
BK=~/Desktop/sounak-server-backup-20260902
scp -i ~/.ssh/oracle.key $BK/env/backend.env    ubuntu@<IP>:~/sounak-project/sounak-backend/.env
scp -i ~/.ssh/oracle.key $BK/env/ai-service.env ubuntu@<IP>:~/sounak-project/sounak-ai-service/.env
```

Then on the server: `pm2 restart all --update-env`

### 5.2 Whitelist the new IP in Atlas
Atlas → Network Access → Add IP Address → the Oracle public IP.
**Until you do this, every database call fails** with a timeout that looks
like an app bug.

---

## Phase 6 — Verify

```bash
pm2 list                                  # both processes 'online'
curl -s localhost:3000/api/health         # Express
curl -s 127.0.0.1:8000/health             # AI service (localhost-bound by design)
sudo nginx -t && sudo systemctl status nginx
```

From your laptop: `curl -I http://<PUBLIC_IP>/` → expect `200`.

---

## Phase 7 — Point deploy.sh at the new box

`deploy.sh` is now host-agnostic. Add to your `~/.zshrc`:

```bash
export SOUNAK_HOST=<oracle-public-ip>
export SOUNAK_USER=ubuntu
export SOUNAK_KEY=~/.ssh/oracle.key
```

Then `./deploy.sh all` works exactly as it did against EC2.

---

## Troubleshooting

| Symptom | Cause |
|---|---|
| Site unreachable, SSH works | Firewall — you did only one of the two halves (Phase 3) |
| `Out of host capacity` | ARM shortage. Retry other ADs/regions, or use the AMD micro |
| DB timeouts | Atlas IP whitelist (5.2) |
| AI service won't start | Python < 3.10 can't parse `str | None`. Check `python3 --version` |
| pip killed mid-install | No swap on a 1 GB shape. Re-run provision.sh; step 3 handles it |
| Angular bundle huge / has source maps | Built without `--configuration production` |
| Uploads fail at ~1 MB | nginx `client_max_body_size` — it's in `nginx/sounak.conf` |
| Chat streams in one lump | nginx `proxy_buffering off` on the SSE route — same file |

## Later: HTTPS

Needs a domain. Once you have one, either point it at the VM and run
`certbot --nginx`, or put Cloudflare's free plan in front for HTTPS + CDN in
about ten minutes. Only *then* does moving the frontend to Cloudflare Pages
become viable.

---

# Part 2 — Android app (Ionic + Capacitor)

`sounak-android` is an Ionic/Angular app wrapped by Capacitor
(`appId: com.sounak.android`). It is a **native app, not a page served by your
backend**, which changes three things that are already fixed in the repo:

| Problem | Why it breaks | Fix (done) |
|---|---|---|
| `apiUrl: ''` | Relative URLs resolve to the *phone*, not your server. Every call fails. | `environment.prod.ts` now takes an absolute URL |
| Cleartext blocked | Android 9+ refuses `http://` by default; shows a generic network error | `res/xml/network_security_config.xml`, wired into the manifest |
| Mixed content | Capacitor's default `androidScheme: 'https'` makes the origin `https://localhost`; calling `http://` is blocked *separately* | `androidScheme: 'http'` in `capacitor.config.ts` |

CORS is already fine — the backend runs `CORS_ORIGIN=*`. Tighten it later to
`http://localhost,http://<oracle-ip>`.

> The CapacitorHttp plugin would bypass CORS and mixed content in one move, but
> it **cannot stream responses** — it would break the SSE chat at
> `/api/ai/chat/stream`. That's why it is deliberately left off.

## A1 — Toolchain (one time)

```bash
brew install openjdk@21                        # Capacitor 8 needs JDK 21
brew install --cask android-commandlinetools
```

Add to `~/.zshrc`:

```bash
export JAVA_HOME=/opt/homebrew/opt/openjdk@21
export ANDROID_HOME=/opt/homebrew/share/android-commandlinetools
export PATH=$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$PATH
```

Then accept licences and install the build pieces:

```bash
sdkmanager --licenses
sdkmanager "platform-tools" "platforms;android-35" "build-tools;35.0.0"
```

## A2 — Point the app at your server

After the Oracle VM is up, replace the placeholder in **both** files with the
same IP:

- `src/environments/environment.prod.ts` → `apiUrl: 'http://<IP>'`
- `android/app/src/main/res/xml/network_security_config.xml` → `<domain>`

## A3 — Build

```bash
cd sounak-android
npm ci
npx ng build --configuration production   # fileReplacements ARE wired here, unlike sounak-project
npx cap sync android
cd android && ./gradlew assembleRelease
```

Output: `android/app/build/outputs/apk/release/app-release-unsigned.apk`

## A4 — Sign it

An unsigned APK will not install. Generate a keystore **once** and never lose
it — Play will not accept an app signed with a different key later.

```bash
keytool -genkey -v -keystore ~/sounak-release.keystore \
  -alias sounak -keyalg RSA -keysize 2048 -validity 10000

$ANDROID_HOME/build-tools/35.0.0/zipalign -v 4 \
  app-release-unsigned.apk sounak-release.apk
$ANDROID_HOME/build-tools/35.0.0/apksigner sign \
  --ks ~/sounak-release.keystore sounak-release.apk
```

Back the keystore up somewhere that is not this laptop. Losing it means you can
never update the app under the same identity.

## A5 — Distribute

**Google Play is not free — it costs $25 (~₹2,100) one-time** to register a
developer account. That is the only part of this whole stack with a price tag.

Free alternatives, all fine for a learning project:

| Method | Notes |
|---|---|
| **GitHub Releases** | Attach the signed APK to a release. Users enable "install from unknown sources". Zero cost, zero setup. |
| **Firebase App Distribution** | Free. Proper tester invites and update notifications. Best if others will test it. |
| **Direct download** | Serve the APK from nginx on the Oracle box. |

If you do pay the $25, use `./gradlew bundleRelease` instead — Play requires an
`.aab`, not an APK.

## A6 — Rebuild when the backend moves

The IP is compiled into the APK. If the server address changes you must edit
both files from A2, rebuild, re-sign and redistribute. A domain name avoids
this permanently, and is the main practical argument for buying one.
