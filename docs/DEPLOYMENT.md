# Deploying the stack — free, no credit card

Target: **₹0/month**. Two earlier plans died, and the reasons are worth keeping:

- **AWS** — terminated 2026-09-02. The 12-month free tier expired 2026-07-29
  (account created 2025-07-29) and the stack began billing ~$14/mo.
- **Oracle Cloud Always Free** — card verification rejects many Indian cards.
- **Zeabur** — its CLI now refuses project creation with *"Shared clusters are
  deprecated. Please rent a Server."* Free shared hosting is gone; their "Free
  plan" is a control plane for a server you rent yourself.

## Architecture

```
Cloudflare Pages ──► Render: Express ──► HF Spaces: FastAPI ──► Gemini
  (Angular,             │                  (AI service, 16GB)
   never sleeps)        ├──► MongoDB Atlas   (already hosted, free)
                        └──► Neon Postgres   (already hosted, free)
```

| Component | Host | Free? | Sleeps? |
|---|---|---|---|
| Angular web | Cloudflare Pages | yes, no card | never |
| Express API | Render | 750 instance-h/month | after 15 min, ~1 min wake |
| FastAPI AI | Hugging Face Spaces | yes, no card | after long idle |
| MongoDB | Atlas M0 | yes | — |
| Postgres | Neon | yes | — |
| Android APK | GitHub Releases | yes | — |

**Why this exact split.** Render grants **750 free instance-hours per workspace
per month** and a month is ~730 hours — so exactly one service fits. Putting
the AI service on Hugging Face instead keeps Render to a single service *and*
gives it 16 GB RAM rather than Render's 512 MB, which matters once ChromaDB and
the LangChain/Gemini stack load. The frontend is static, so a CDN that never
sleeps means the site always loads instantly and only API calls wait on a cold
backend.

> **Do not add a keep-alive pinger to Render.** Keeping the service awake 24/7
> would consume ~730 of your 750 hours and leave no margin.

Redis and RabbitMQ are not hosted anywhere. Both degrade gracefully
(`redis.config.js` disables caching and stops retrying; `rabbitmq.config.js`
retries without crashing), exactly as on the old EC2 box.

---

## Phase 0 — Already in the repo

- `render.yaml` — the backend blueprint
- `sounak-ai-service/Dockerfile` + `README.hf.md` — the Hugging Face Space
- `sounak-project/public/_redirects` — SPA fallback, or `/dashboard` 404s
- `angular.json` `fileReplacements` **now actually wired** — without it
  `environment.prod.ts` was dead code and the dev config shipped to production
- Shared-secret auth between backend and AI service (Phase 3)

## Phase 1 — Hugging Face Space (deploy this FIRST)

The backend needs this URL, so it goes first.

1. Sign up at <https://huggingface.co>. No card.
2. New → Space. SDK **Docker**, visibility Public (private works too).
3. Push the `sounak-ai-service` directory to the Space repo, renaming
   `README.hf.md` to `README.md` — Spaces read its frontmatter to learn the
   SDK and port.
4. Settings → Variables and secrets:

   ```
   GEMINI_API_KEY=<from your backup folder>
   INTERNAL_API_KEY=<shared secret>
   MODEL=gemini-2.5-flash
   MAX_TOKENS=1024
   ```

5. Note the URL: `https://<username>-<space-name>.hf.space`

> The Space filesystem is ephemeral, so Chroma is wiped on restart. Seed
> documents are baked into the image via `COPY data/`; anything uploaded at
> runtime must be re-ingested after a restart.

## Phase 2 — Render: the backend

1. Sign up at <https://render.com> with GitHub. No card for the free tier.
2. New → **Blueprint** → select this repo. Render reads `render.yaml`.
3. Set the secrets it prompts for (all in your backup folder):

   ```
   MONGO_URI          <Atlas>
   POSTGRES_URL       <Neon>
   JWT_SECRET
   AI_SERVICE_URL     https://<username>-<space>.hf.space
   AI_INTERNAL_KEY    <same shared secret as Phase 1>
   CORS_ORIGIN        https://<project>.pages.dev,http://localhost
   ```

4. Note the URL: `https://sounak-backend.onrender.com`

## Phase 3 — Cloudflare Pages: the frontend

1. Sign up at <https://dash.cloudflare.com>. No card.
2. Workers & Pages → Create → Pages → Connect to Git → this repo.
3. Build settings:

   | Field | Value |
   |---|---|
   | Root directory | `sounak-project` |
   | Build command | `npm ci && npx ng build --configuration production` |
   | Output directory | `dist/sounak-project` |

   (The legacy `:browser` builder produces flat output — no `browser/` subdir.)

4. Put the real Render URL in
   `sounak-project/src/environment/environment.prod.ts` and push; Pages
   rebuilds automatically.

## Phase 4 — Lock down the AI service

Hosted, the AI service has a **public URL**; on EC2 it was `127.0.0.1`-only.
Without a guard anyone who finds it can spend your Gemini quota.

- Backend sends `x-internal-key` on every call (`aiService.js`)
- AI service rejects anything without it (`main.py` middleware)
- `/health` stays open so platform health checks work
- **Unset = disabled**, so local dev is unchanged

`AI_INTERNAL_KEY` (Render) and `INTERNAL_API_KEY` (Space) must match. One is
saved in your backup folder as `INTERNAL_API_KEY.txt`.

## Phase 5 — Atlas network access

Render and Hugging Face both use dynamic egress IPs, so the old single-IP
whitelist will not work. Atlas → Network Access → allow `0.0.0.0/0`.
Without this, DB calls time out and look like app bugs.

## Phase 6 — Verify

```bash
curl -s https://<space>.hf.space/health                  # open by design
curl -s https://<space>.hf.space/rag/status              # expect 401
curl -s https://sounak-backend.onrender.com/health       # may take ~1 min cold
curl -sI https://<project>.pages.dev/dashboard           # expect 200, not 404
```

The 401 is the point: it proves the guard is live.

## Troubleshooting

| Symptom | Cause |
|---|---|
| Frontend loads, API calls fail | `CORS_ORIGIN` missing the Pages domain |
| Everything 401s | secret mismatch between backend and Space |
| `/dashboard` 404s on refresh | `_redirects` missing from the build output |
| API calls hit the Pages domain | `environment.prod.ts` not updated, or `fileReplacements` reverted |
| DB timeouts | Atlas Network Access needs `0.0.0.0/0` |
| First request takes ~1 min | Render cold start; expected |
| AI answers ignore your documents | Space restarted, Chroma wiped — re-ingest |
| Render service stops mid-month | 750 instance-hours exhausted — remove any keep-alive pinger |

## Alternative: a real VM

`provision.sh` still rebuilds the whole stack on any Linux box (Ubuntu, Oracle
Linux or Amazon Linux; x86 or ARM). Use it if you ever get an Oracle Always
Free instance or rent a small VPS. It is architecture-independent, unlike an
AMI — an x86 image cannot boot on ARM.

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
