# Deploying the stack — free, no credit card

Target: **₹0/month**. Two earlier plans died, and the reasons are worth keeping:

- **AWS** — terminated 2026-09-02. The 12-month free tier expired 2026-07-29
  (account created 2025-07-29) and the stack began billing ~$14/mo.
- **Oracle Cloud Always Free** — card verification rejects many Indian cards.
- **Zeabur** — its CLI refuses project creation: *"Shared clusters are
  deprecated. Please rent a Server."* Free shared hosting is gone; their "Free
  plan" is a control plane for a server you rent yourself.
- **Hugging Face Spaces** — repo creation returns 402: *"hosting Gradio and
  Docker Spaces on free cpu-basic requires a PRO subscription."* Only static
  Spaces are free, which cannot run FastAPI.

## Architecture

```
Cloudflare Workers ──► Render: Express ──► Render: FastAPI ──► Gemini
  (Angular,               │                  (AI service)
   never sleeps)          ├──► MongoDB Atlas   (already hosted, free)
                          └──► Neon Postgres   (already hosted, free)
```

| Component | Host | Free? | Sleeps? |
|---|---|---|---|
| Angular web | Cloudflare Workers | yes, no card | never |
| Express API | Render | 750 instance-h/month | after 15 min, ~1 min wake |
| FastAPI AI | Render | shares the 750 h | after 15 min, ~1 min wake |
| MongoDB | Atlas M0 | yes | — |
| Postgres | Neon | yes | — |
| Android APK | GitHub Releases | yes | — |

**On the 750-hour limit.** Render grants 750 free instance-hours per workspace
per month. Hours accrue only while a service is **awake**, and both spin down
after 15 minutes idle — so a couple of hours of real use per day across both
services is roughly 120 h/month, far under the cap. Two services are fine.

> **Do not add a keep-alive pinger.** Keeping both awake 24/7 would need ~1460
> hours against a 750 cap, and the services would stop mid-month. That, not the
> service count, is what actually blows the budget.

The frontend is on Cloudflare rather than Render because it is static: a host
that never sleeps means the site always loads instantly and only API calls wait
on a cold backend.

Redis and RabbitMQ are not hosted anywhere. Both degrade gracefully
(`redis.config.js` disables caching and stops retrying; `rabbitmq.config.js`
retries without crashing), exactly as on the old EC2 box.

---

## Phase 0 — Already in the repo

- `render.yaml` — blueprint for **both** backend services
- `sounak-project/wrangler.jsonc` — the Cloudflare Worker, already deployed
- `angular.json` `fileReplacements` **now actually wired** — without it
  `environment.prod.ts` was dead code and the dev config shipped to production
- Shared-secret auth between backend and AI service (Phase 3)

`sounak-ai-service/Dockerfile` and `README.hf.md` are kept for reference — they
work on any Docker host if you ever move off Render — but are unused here.

## Phase 1 — Frontend (DONE)

Deployed to Cloudflare Workers static assets:

**https://sounak-project.sounak-project.workers.dev**

Redeploy after any frontend change:

```bash
cd sounak-project
npx ng build --configuration production
npx wrangler deploy
```

SPA routing comes from `not_found_handling: "single-page-application"` in
`wrangler.jsonc`. The classic Pages `_redirects` rule `/* /index.html 200` is
rejected by Cloudflare's validator as a redirect loop — do not reintroduce it.

## Phase 2 — Render: both backend services

The CLI can list services, tail logs and trigger deploys, but it has **no
blueprint-create command**, so this step is the dashboard.

1. <https://dashboard.render.com> → **New → Blueprint** → pick this repo.
   Render reads `render.yaml` and creates both services.
2. Set the secrets it prompts for (all in your backup folder):

   **sounak-backend**
   ```
   MONGO_URI          <Atlas>
   POSTGRES_URL       <Neon>
   JWT_SECRET
   AI_SERVICE_URL     https://sounak-ai-service.onrender.com
   AI_INTERNAL_KEY    <shared secret>
   CORS_ORIGIN        https://sounak-project.sounak-project.workers.dev,https://suvidhaa.sounak-project.workers.dev,https://localhost,capacitor://localhost
   ```

   **sounak-ai-service**
   ```
   GEMINI_API_KEY     <from your backup folder>
   INTERNAL_API_KEY   <same shared secret>
   ```

3. If the backend's URL is not `https://sounak-backend.onrender.com`, update
   `sounak-project/src/environment/environment.prod.ts` and redeploy the
   frontend as in Phase 1.

> Chroma persists to disk and Render's free filesystem is ephemeral, so the
> vector store is wiped on restart. Documents need re-ingesting after a cold
> start.

## Phase 3 — Atlas network access

Render uses dynamic egress IPs, so the old single-IP whitelist will not work.
Atlas → Network Access → allow `0.0.0.0/0`. Without this, DB calls time out and
look like app bugs.

## Phase 4 — Lock down the AI service

Hosted, the AI service has a **public URL**; on EC2 it was `127.0.0.1`-only.
Without a guard anyone who finds it can spend your Gemini quota.

- Backend sends `x-internal-key` on every call (`aiService.js`)
- AI service rejects anything without it (`main.py` middleware)
- `/health` stays open so platform health checks work
- **Unset = disabled**, so local dev is unchanged

`AI_INTERNAL_KEY` (backend) and `INTERNAL_API_KEY` (AI service) must match. One is
saved in your backup folder as `INTERNAL_API_KEY.txt`.

## Phase 5 — Verify

```bash
curl -s https://sounak-ai-service.onrender.com/health      # open by design
curl -s https://sounak-ai-service.onrender.com/rag/status  # expect 401
curl -s https://sounak-backend.onrender.com/health         # ~1 min when cold
curl -sI https://sounak-project.sounak-project.workers.dev/dashboard  # 200, not 404
```

The 401 is the point: it proves the guard is live.

## Troubleshooting

| Symptom | Cause |
|---|---|
| Frontend loads, API calls fail | `CORS_ORIGIN` missing the Cloudflare domain |
| Everything 401s | secret mismatch between the two services |
| `/dashboard` 404s on refresh | `not_found_handling` missing from wrangler.jsonc |
| API calls hit the frontend domain | `environment.prod.ts` not updated, or `fileReplacements` reverted |
| DB timeouts | Atlas Network Access needs `0.0.0.0/0` |
| First request takes ~1 min | Render cold start; expected |
| AI answers ignore your documents | service restarted, Chroma wiped — re-ingest |
| Services stop mid-month | 750 instance-hours exhausted — remove any keep-alive pinger |

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

| Problem | Why it breaks | Status |
|---|---|---|
| `apiUrl: ''` | Relative URLs resolve to the *phone*, not your server. Every call fails. | fixed — `environment.prod.ts` holds `https://sounak-backend.onrender.com` |
| Cleartext blocked | Android 9+ refuses `http://` by default | **moot** — the backend is HTTPS. The cleartext exception was removed |
| Mixed content | `androidScheme: 'https'` makes the origin `https://localhost`; calling `http://` is blocked separately | **moot** — `androidScheme` is back to the default `https` |

Both workarounds existed only while the backend was an IP-only HTTP host. They
were deleted once Render provided HTTPS — shipping a cleartext exception that
is not needed would weaken the release for nothing.

You can preview the exact APK bundle in a browser at
<https://suvidhaa.sounak-project.workers.dev> — same code, minus native
plugins (camera, geolocation, push), which need a real device.

CORS is handled: `CORS_ORIGIN` on the backend lists both Cloudflare origins
plus `https://localhost` and `capacitor://localhost`, which are what a real
Capacitor WebView sends on Android and iOS. The APK therefore needs no further
backend change.

⚠️ Changing an env var on Render requires a **full redeploy**, not a restart.
`render restart` leaves the old value in the running process. Use
`render deploys create <srv-id> --confirm --wait`.

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
