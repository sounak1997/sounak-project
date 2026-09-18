# Live URLs & Dashboards

Everything below is free tier. No credit card on any of it.
Full deployment runbook: [DEPLOYMENT.md](DEPLOYMENT.md)

## Applications

| What | URL | Host | Sleeps? |
|---|---|---|---|
| **Web app** (Angular) | https://sounak-project.sounak-project.workers.dev | Cloudflare Workers | never |
| **Mobile app in browser** (Ionic) | https://suvidhaa.sounak-project.workers.dev | Cloudflare Workers | never |
| **Backend API** (Express) | https://sounak-backend.onrender.com | Render | 15 min idle |
| **AI service** (FastAPI) | https://sounak-ai-service.onrender.com | Render | 15 min idle |

The two Cloudflare sites load instantly. The first API call after a quiet spell
takes **30–60 seconds** while Render wakes the backend — that is the free tier
behaving normally, not a fault.

The Ionic site serves the exact bundle that ships inside the APK, so UI and API
behaviour match. Native plugins (camera, geolocation, push) only work in the
real APK on a device.

## Health & smoke checks

```bash
curl https://sounak-backend.onrender.com/health         # {"status":"ok",...}
curl https://sounak-ai-service.onrender.com/health      # open by design
curl https://sounak-ai-service.onrender.com/rag/status  # 401 — the guard working
curl -I https://sounak-project.sounak-project.workers.dev/dashboard   # 200, not 404
```

The 401 is the point: only the backend holds the shared key.

## Dashboards

| Service | URL | Account |
|---|---|---|
| Cloudflare | https://dash.cloudflare.com | sounakmitra82@gmail.com |
| Render | https://dashboard.render.com | sounakmitra82@gmail.com |
| MongoDB Atlas | https://cloud.mongodb.com | — |
| Neon Postgres | https://console.neon.tech | — |
| Gemini API keys | https://aistudio.google.com/apikey | — |
| GitHub repo | https://github.com/sounak1997/sounak-project | sounak1997 |
| Hugging Face | https://huggingface.co/sounakmitra | unused — see below |

## Resource IDs

```
Render workspace     tea-dame8ugu01pc739uf5b0
Render blueprint     exs-damgepp42hec73911cj0
  backend service    srv-damgh8h42hec73919spg
  ai service         srv-damgh8h42hec73919sng
Cloudflare account   55a3f90f778e755b3d6daaea7f7807ff
```

## CORS allowlist

`CORS_ORIGIN` on the backend must contain every frontend origin, comma
separated. Currently:

```
https://sounak-project.sounak-project.workers.dev
https://sounak-android-web.sounak-project.workers.dev
https://localhost              <- Capacitor WebView on Android
capacitor://localhost          <- Capacitor WebView on iOS
```

The last two mean the APK works with no further backend change.

⚠️ Changing an env var on Render needs a **full redeploy**, not a restart.
`render restart` leaves the old value in the running process — verified the
hard way. Use `render deploys create <srv-id> --confirm --wait`.

## Redeploying

**Frontend** (after any Angular change):
```bash
cd sounak-project && npm run deploy     # ng build --configuration production && wrangler deploy
```

**Ionic web build**:
```bash
cd sounak-android
npx ng build --configuration production && npx cap sync android
npx wrangler deploy
```

**Backend / AI service**: push to `master` — Render auto-deploys from GitHub.

**Android APK**: see section 8 of `CREDENTIALS-AND-NOTES.txt` in the backup
folder. Signed APK currently at `~/Desktop/sounak-release.apk`.

## Custom naming — what is and is not possible

Tested, so it does not get retried:

- **Cloudflare account subdomain cannot be changed.** `PUT
  /accounts/{id}/workers/subdomain` returns error 10036, "Account already has
  an associated subdomain." It is fixed at first use, so `app.suvidhaa.workers.dev`
  is unreachable on this account. Only the *worker name* is editable, which is
  why the Ionic app is `suvidhaa.sounak-project.workers.dev`.
- **Renaming a Render service does not change its URL.** The service object has
  a `slug` separate from `name`; the URL is `https://<slug>.onrender.com` and
  the slug is frozen at creation. Verified by renaming the AI service to
  `suvidhaa-ai`: name changed, slug and URL did not. Reverted, because a name
  that disagrees with `render.yaml` risks the blueprint creating a duplicate on
  its next sync.
- Getting `suvidhaa-api.onrender.com` would require deleting and recreating the
  service: all 8 env vars re-entered, downtime, and a new backend URL — which
  is compiled into the APK, so every installed copy would break.

**A real domain is the only clean fix.** `suvidhaa.dev` was available at the
time of writing (~₹1,100/yr). The practical argument is not branding: the
backend URL is baked into every APK, so on a domain you own you repoint DNS
when hosts change, instead of rebuilding, re-signing and redistributing.

## Not used

**Hugging Face** — the CLI is logged in, but free `cpu-basic` refuses Docker
Spaces (402, "requires a PRO subscription"). Only static Spaces are free, which
cannot run FastAPI. `sounak-ai-service/Dockerfile` and `README.hf.md` remain in
the repo and work on any Docker host.

**AWS, Oracle Cloud, Zeabur** — all dead ends, reasons recorded in
[DEPLOYMENT.md](DEPLOYMENT.md). Do not retry them.

## Secrets

Not here by design. They live outside the repo in
`~/Desktop/sounak-server-backup-20260902/CREDENTIALS-AND-NOTES.txt`.
