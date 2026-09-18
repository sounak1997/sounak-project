# Deploying the stack — free, no credit card

Target: **₹0/month**. AWS was terminated 2026-09-02 after its 12-month free
tier expired (account created 2025-07-29, tier ended 2026-07-29) and the stack
began billing ~$14/mo. Oracle Cloud was the next plan but its card
verification rejects many Indian cards, so the live plan is **Zeabur +
Cloudflare Pages**, neither of which asks for a card.

## Architecture

```
Cloudflare Pages ──► Zeabur: Express ──► Zeabur: FastAPI ──► Gemini
  (Angular,              │                  (AI service)
   never sleeps)         ├──► MongoDB Atlas   (already hosted, free)
                         └──► Neon Postgres   (already hosted, free)
```

| Component | Host | Cost | Sleeps? |
|---|---|---|---|
| Angular web | Cloudflare Pages | free | never |
| Express API | Zeabur | free | after idle, few-sec wake |
| FastAPI AI service | Zeabur | free | after idle, few-sec wake |
| MongoDB | Atlas M0 | free | — |
| Postgres | Neon | free | — |
| Android APK | GitHub Releases | free | — |

The frontend is deliberately **not** on Zeabur: it is static, so a CDN that
never sleeps means the site always loads instantly and only API calls wait on a
cold backend.

Redis and RabbitMQ are not hosted anywhere. Both degrade gracefully
(`redis.config.js` disables caching and stops retrying; `rabbitmq.config.js`
retries without crashing), exactly as on the old EC2 box.

> **Known unknown:** Zeabur does not publish runtime CPU/RAM limits — the
> "2C4G" figure on their pricing page is the *build* machine, explicitly
> separate from runtime. If the Python service runs out of memory, move it to
> Hugging Face Spaces (16 GB free, no card). `render.yaml` in the repo root is
> a second fallback: Render publishes 512MB/750h but has ~50s cold starts.

---

## Phase 0 — Local prep

Already done and in the repo:

- `sounak-backend/zbpack.json` → `node server.js`, and `engines.node >= 22`
- `sounak-ai-service/zbpack.json` → `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
  (it bound to `127.0.0.1:8000` under PM2, which is unreachable when hosted)
- `sounak-project/public/_redirects` → SPA fallback, or `/dashboard` 404s on refresh
- `angular.json` `fileReplacements` **now actually wired** — without it
  `environment.prod.ts` was dead code and the dev config shipped to production
- Shared-secret auth between backend and AI service (see Phase 3)

## Phase 1 — Zeabur: the two servers

1. Sign up at <https://zeabur.com> with GitHub. No card.
2. New Project → Deploy Service → Git → pick `sounak-project`.
3. Add **two** services from the same repo, setting **Root Directory** on each
   (Service → Settings → Root Directory). This is how Zeabur handles a monorepo:

   | Service | Root Directory |
   |---|---|
   | backend | `sounak-backend` |
   | ai-service | `sounak-ai-service` |

   Each directory's `zbpack.json` supplies the start command automatically.

4. Set environment variables per service (Zeabur dashboard → Variables):

   **backend**
   ```
   NODE_ENV=production
   MONGO_URI=<from your backup folder>
   POSTGRES_URL=<your Neon URL, from the backup folder>
   JWT_SECRET=<from your backup folder>
   AI_SERVICE_URL=https://<ai-service>.zeabur.app
   AI_INTERNAL_KEY=<shared secret>
   AI_TIMEOUT_MS=60000
   CORS_ORIGIN=https://<your-pages-domain>.pages.dev,http://localhost
   ```

   **ai-service**
   ```
   GEMINI_API_KEY=<from your backup folder>
   MODEL=gemini-2.5-flash
   MAX_TOKENS=1024
   INTERNAL_API_KEY=<same shared secret>
   CHROMA_DIR=/tmp/chroma_db
   ```

5. Generate a domain for each service (Networking → Generate Domain) and note
   both URLs.

> Chroma persists to disk and the free filesystem is ephemeral, so the vector
> store is wiped on restart. Documents must be re-ingested after a cold start.

## Phase 2 — Cloudflare Pages: the frontend

1. Sign up at <https://dash.cloudflare.com>. No card.
2. Workers & Pages → Create → Pages → Connect to Git → `sounak-project`.
3. Build settings:

   | Field | Value |
   |---|---|
   | Root directory | `sounak-project` |
   | Build command | `npm ci && npx ng build --configuration production` |
   | Output directory | `dist/sounak-project` |

   (The legacy `:browser` builder produces flat output — no `browser/` subdir.)

4. Before this build is useful, set the real backend URL in
   `sounak-project/src/environment/environment.prod.ts` and push.

## Phase 3 — Lock down the AI service

Hosted, the AI service has a **public URL**; on EC2 it was `127.0.0.1`-only.
Without a guard, anyone who finds it can spend your Gemini quota.

Both services now share a secret:

- Backend sends `x-internal-key` on every call (`aiService.js`)
- AI service rejects anything without it (`main.py` middleware)
- `/health` stays open so the platform's health check works
- **Unset = disabled**, so local dev is unchanged

Set `AI_INTERNAL_KEY` (backend) and `INTERNAL_API_KEY` (AI service) to the same
value. One is saved in your backup folder as `INTERNAL_API_KEY.txt`.

## Phase 4 — Wire the URLs together

Order matters, because each step needs the previous URL:

1. Deploy ai-service → copy its URL → set `AI_SERVICE_URL` on the backend
2. Deploy backend → copy its URL → put in `environment.prod.ts`, push
3. Cloudflare rebuilds → copy the Pages URL → set `CORS_ORIGIN` on the backend
4. Whitelist nothing in Atlas: Zeabur egress IPs are dynamic, so Atlas needs
   `0.0.0.0/0` under Network Access (or Zeabur's documented ranges, if any)

## Phase 5 — Verify

```bash
curl -s https://<backend>.zeabur.app/health
curl -s https://<ai-service>.zeabur.app/health          # open by design
curl -s https://<ai-service>.zeabur.app/rag/status      # expect 401
curl -sI https://<pages-domain>.pages.dev/dashboard     # expect 200, not 404
```

The 401 is the point: it proves the guard is on.

## Troubleshooting

| Symptom | Cause |
|---|---|
| Frontend loads, API calls fail | `CORS_ORIGIN` missing the Pages domain |
| Everything 401s | secret mismatch between the two services |
| `/dashboard` 404s on refresh | `_redirects` missing from the build output |
| API calls go to the Pages domain | `environment.prod.ts` not updated, or `fileReplacements` reverted |
| DB timeouts | Atlas Network Access needs `0.0.0.0/0` |
| First request takes ~30s | cold start; expected on free tier |
| AI answers ignore your documents | Chroma wiped by a restart — re-ingest |
| AI service OOM | move it to Hugging Face Spaces (16 GB free) |

## Alternative: a real VM

`provision.sh` still works and rebuilds the whole stack on any Linux box
(Ubuntu/Oracle Linux/Amazon Linux, x86 or ARM). Use it if you get an Oracle
Always Free instance later, or any other VM. It is architecture-independent,
unlike an AMI — an x86 image cannot boot on Oracle's free ARM tier.

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
