# Gym Management Portal — Requirements Specification

**Version:** 0.1
**Date:** September 20, 2026
**Status:** Attendance flow, online UPI payment, member accounts and password reset built; owner console partially built

## 1. Purpose and Scope

A multi-tenant gym management platform: one deployment hosting many
independent gyms (target ~100), each with its own owner, members, plans, prices
and door QR. Covers member registry, subscriptions and expiry tracking, cash
and online payment recording, and attendance capture at the gym door.

**Separation (decided 2026-09-20):** the gym portal shares no table and no
login with the grocery, doctors or helper portals on this deployment. Every
table is `gym_`-prefixed; gym logins live in `gym_accounts` in Postgres, not in
the Mongo `users` collection the other portals authenticate against. A gym owner
therefore holds no privilege anywhere else, and the gym's tables could be lifted
into their own service with nothing to untangle.

Frontend: `sounak-gym`, a standalone Angular web app (its own Cloudflare Worker).
Backend: `/api/gym/*` in `sounak-backend`, with `src/db/schema_gym.sql`.
Web first; iOS and Android to follow, which the flow below is compatible with
since it needs no native capability.

## 2. Roles

### 2.1 Platform administrator
Creates gyms, issues owner accounts, assigns owners to gyms. `gym_accounts.platform_admin`.

### 2.2 Gym owner / staff
Runs one gym (or several). Authority comes from a `gym_staff` row naming the
gym — never from a role claim in a token. This is the tenancy boundary.

### 2.3 Member (athlete)
**Does not *need* to log in.** A member is a `gym_members` row with a name and a
phone number — the owner registers them with nothing more, and they are
recognised at the door by their device. Marking attendance never requires an
account.

A member **may optionally create one** (§3.8) to sign in from any device and see
their own attendance, payments and renewals. The account is a `gym_accounts`
row, the same table staff use, linked through `gym_members.account_id`. What
someone *is* follows from what points at their account: a `gym_staff` row means
they administer a gym, `gym_members.account_id` means they train at one, and
both is an ordinary case — an owner who also trains.

## 3. Functional Requirements

### 3.1 Authentication & tenancy
- **FR-1.1** Gym owners/staff sign in with email + password against `gym_accounts` (bcrypt).
- **FR-1.2** Owner sessions are JWTs carrying `kind: 'gym'`, rejected by other portals and rejecting other portals' tokens. 12-hour expiry — an owner works a full shift at the desk.
- **FR-1.3** Authority over a gym is re-read from `gym_staff` on every request, so revoking access takes effect immediately rather than when a token expires.
- **FR-1.4** A gym the caller may not administer returns **404, not 403** — confirming an id exists but belongs to someone else leaks the platform's shape.
- **FR-1.5** Owner accounts are created by the platform admin. There is no self-registration.

### 3.2 Attendance — the door flow

The gym prints **one static QR** and fixes it by the entrance. Its URL is
`/checkin?g=<gym_code>`.

- **FR-2.1** A member scans it with their phone's ordinary camera app, which opens the URL. **No QR scanner is built, no camera permission is requested, and no app is installed** — the phone's camera did the scanning.
- **FR-2.2** Because the poster is identical for every member, the URL cannot identify who scanned. On a phone's **first** scan the member identifies themselves once, by **full mobile number or name fragment**.
- **FR-2.3** A name search requires ≥3 characters and returns at most 8 candidates. Without a floor, typing "a" would list most of the gym to anyone who photographed the poster; members' names are not the owner's to leak.
- **FR-2.4** Binding a device always requires the **last 4 digits** of the member's registered mobile. Found by full number, the client already holds those digits and submits them silently, so the everyday path has no extra step; only a name search prompts.
- **FR-2.5** The device is then remembered (`gym_device_tokens`, SHA-256 hashed, stored per gym code in `localStorage`). Every later scan is **one tap**.
- **FR-2.6** The device token grants attendance for its own member at its own gym and nothing else — no payments, no other members, no other gym, no admin route.
- **FR-2.7** The member never states arrival or departure. The **server** decides from whether today's visit is open: no row → check in; open row → check out; closed row → already done.
- **FR-2.8** A second scan within a grace window (default 120s) is ignored, so an accidental re-scan or page reload cannot close a 0-minute visit.
- **FR-2.9** A forgotten check-out is **not an error**. `check_out_at` stays null and the visit still counts as presence.
- **FR-2.10** Check-in is refused, with the expiry date shown, when the membership has lapsed or never started. The message is the renewal nudge.
- **FR-2.11** The owner can **mark a member present by hand**. This is not a convenience: it is the entire attendance path for members without a smartphone.
- **FR-2.12** The member sees **their own attendance percentage** after every scan. Compliance is voluntary, so the screen has to give a reason to keep scanning.

### 3.8 Optional member accounts

- **FR-8.1** Scanning the door QR remains login-free and unchanged. Everything here is additive; a member who never creates an account loses nothing.
- **FR-8.2** **At the gym:** a member creates a login from a device already recognised at the door. Binding that device already required the last 4 digits of the mobile the gym registered, so the identity proof is reused — nothing to type.
- **FR-8.2a** **Away from the gym** (`/signup`): identity is proven with **member code + mobile number**. The code is the secret half — 8 random characters, unique platform-wide, issued for exactly this so it cannot be guessed by incrementing someone else's. The phone is the confirming half and must match the record.
  *Why not phone alone:* asking someone to type a number and then confirm digits of that same number is circular and proves nothing. An OTP is the stronger answer but needs an SMS provider and a per-message cost; this reaches the same practical result for free, since gyms already hand out a membership number.
- **FR-8.2b** A wrong code and a wrong phone produce the **same** error, so the form cannot be used to discover which codes are real. The endpoint is rate limited as an enumeration surface.
- **FR-8.2c** The member code is surfaced in two places, or sign-up would be unusable: on the check-in screen to the recognised member, and in the owner's member list so staff can read it out.
- **FR-8.3** If the email already has an account (a member of two gyms, or an owner who also trains), its existing password is required to link the membership. A device token proves "this phone belongs to this member", not "this person owns that email".
- **FR-8.4** Sign-up signs the member straight in. Making someone retype the password they just chose is friction for no security.
- **FR-8.5** One login endpoint serves staff and members. The response carries both staffed gyms and memberships; the client picks its home screen from that.
- **FR-8.6** A signed-in member sees only their **own** record. Member routes use `requireGymAccount` but never `requireGymAccess` — being a member of a gym is not permission to administer it — and scope by `gym_members.account_id`, so another member's id returns 404.
- **FR-8.7** **Password reset** (`/reset-password`): member code + mobile number, exactly the proof sign-up uses. Anything weaker would be a way round sign-up; anything stronger would leave someone able to create a login but not recover it.
  *Known trade-off:* sign-up can only be used once, since a claimed membership refuses it, whereas reset works repeatedly. A leaked member code plus a known mobile is therefore a standing route into that account. Accepted because these accounts guard attendance history and a renewal button, not money — revisit first if that changes.
- **FR-8.8** Two fallbacks, because self-service cannot cover everyone: an **owner** can reset any of their own members' passwords from the console (for a member who has lost their code too), and the **platform admin** can reset any account (the only way back for a locked-out gym owner, who holds no member code).
- **FR-8.9** Sign-up and reset both sign the person straight in. They have just proved who they are and chosen a password; a login form would be a step for nothing.
- **FR-8.10** A member with no login yet is told to use sign-up rather than having an account silently created, so the two paths stay distinct.
- **FR-8.11** A member's payment history omits the owner's audit columns (who verified, gateway ids). That is bookkeeping, not theirs.

### 3.3 Presence percentage
- **FR-3.1** Attendance is **one row per member per day** (`UNIQUE (member_id, visit_date)`). Presence is the row's existence; times are detail.
- **FR-3.2** `visit_date` is computed in **the gym's own timezone**, never UTC. A 5 AM IST session is the previous day in UTC, which would silently skew every percentage.
- **FR-3.3** Percentage = attended days ÷ days elapsed in the current subscription, **excluding weekdays the gym is closed**.
- **FR-3.4** Null (not 0) when the subscription window has not started, so a future membership does not show a discouraging 0%.

### 3.4 Members, plans, subscriptions
- **FR-4.1** An owner registers a member with name + phone. Phone is required — it is how they identify themselves at the door and how the owner calls them.
- **FR-4.2** Two members may share a phone number (a parent and child). This is reported, not blocked; the check-in screen asks which of them is scanning.
- **FR-4.3** Plans are per gym: name, duration in days, price.
- **FR-4.4** A renewal is a **new subscription row**, never an edit, so payment history stays intact.
- **FR-4.5** A renewal bought before the current one lapses starts the **day after it ends**, so renewing early never discards paid days.
- **FR-4.6** Plans are deactivated, never deleted — past subscriptions reference them.

### 3.5 Expiry and renewals
- **FR-5.1** **Expiry is derived, never stored.** There is no `expired` status or flag anywhere; it is computed from `end_date` against today in the gym's timezone, at read time.
  *Why it matters:* a stored flag needs a nightly job to flip it, Render's free tier has no scheduler, and a stale flag is worse than none.
- **FR-5.2** The owner's dashboard shows three separate buckets: **expired**, **expiring within N days** (default 7), and **registered but never started**.
- **FR-5.3** Every row carries the member's phone as a `tel:` link, so "call them to renew" is one tap.

### 3.6 Payments
- **FR-6.1** Cash is recorded as `collected` with who took it and when.
- **FR-6.2** QR/UPI payments land as `pending_verification` and the owner confirms them — there is no gateway callback to trust in v1. Same manual model as the grocery portal.
- **FR-6.3** Every subscription gets a payment row even when unpaid, so "who owes money" is a query rather than an absence of data.
- **FR-6.4** `gateway_payment_id` exists and is nullable, so a Razorpay/Stripe webhook can be added with no migration.

### 3.7 Online payment (UPI) — automatic confirmation

**The problem this solves:** a static UPI QR produces **no callback**. Money
moves bank → NPCI → bank and the server is not in that path, so it never learns
the payment happened. A confirmation only exists if a provider created the order
and therefore knows what the money was for.

- **FR-7.1** Each gym connects **its own** Razorpay account (key id, key secret, webhook secret). Money settles directly to that gym's bank account; the platform never holds it, which also keeps the platform clear of payment-aggregator licensing.
- **FR-7.2** Key secrets and webhook secrets are stored AES-256-GCM encrypted (`src/utils/secretBox.js`), under a master key held in `GYM_CREDENTIALS_KEY` in the environment — never in the database, or encrypting would be theatre. `key_id` is stored in the clear because it is public by design.
- **FR-7.3** A member renews **from the check-in screen on their own phone**, identified by the same device token the door flow uses. That token can start a payment for its own membership and read that payment's status — nothing more.
- **FR-7.4** The subscription is created immediately as `pending_payment` and activates only when money is confirmed. Every access query already filters `status = 'active'`, so the unpaid state grants nothing by default, and an abandoned checkout stays visible rather than vanishing.
- **FR-7.5** Confirmation arrives by **three independent routes**, all landing on one idempotent `settle()`:
  1. **Checkout callback** — the browser returns a signed receipt. ~1s, but lost if the tab closes mid-redirect.
  2. **Webhook** — `POST /api/gym/webhooks/razorpay`, authenticated by HMAC over the **raw** body.
  3. **Reconciliation poll** — asks the gateway about anything still pending.
  *Why three:* none is dependable alone on this stack — see NFR-7.
- **FR-7.6** Idempotency is enforced at three levels: `UNIQUE (event_id)` on the webhook log, a partial `UNIQUE` on `gateway_payment_id`, and `settle()`'s `status = 'pending'` predicate. Gateways deliver at-least-once and retry, so duplicates are certain, not hypothetical.
- **FR-7.7** The webhook returns **200 for everything except a bad signature**, including duplicates and events it ignores — a non-2xx makes the gateway retry, and retrying something already recorded is pure noise.
- **FR-7.8** An unconfirmed payment is reported to the member as *"we haven't had confirmation yet"*, never as failure. Telling someone their payment failed when their account was debited is the worst outcome this screen can produce.
- **FR-7.9** Cash and manual-QR payment remain fully supported and unchanged. Online payment is additive; a gym that never connects a gateway loses nothing.

## 4. Non-Functional

- **NFR-1 Tenancy.** Every tenant table carries `gym_id` explicitly, denormalised rather than reached by join. With ~100 gyms sharing tables, the failure that matters is one owner seeing another's data, and a forgotten join is easier to write than a forgotten `WHERE` on a column that is right there.
- **NFR-2 Cold start.** Render free sleeps after 15 min; the first call takes 30–60s. The member is standing at the door, so the check-in page fires its state request on load (which doubles as the wake-up), sends its own `clientTime` so the recorded time is when they tapped rather than when the request landed, and says plainly that it may take a minute.
- **NFR-3 Clock trust.** A client timestamp more than 10 minutes from the server's is discarded in favour of the server clock.
- **NFR-4 Rate limiting.** A whole gym shares one public IP, so per-IP counting sees the membership as one client. The global limiter skips `/api/gym/checkin`; check-in gets 300/15min and the identify endpoints 30/hour.
- **NFR-5 Dates on the wire.** Bare `DATE` columns are returned as `YYYY-MM-DD` strings, not JS `Date`s — otherwise node-postgres yields local midnight and serialises the previous day.
- **NFR-6 Audit.** Payment verification and manual attendance record who acted and when. Every webhook is stored raw in `gym_webhook_events`, because when a member says they paid and the system disagrees, the only question that matters is what the gateway actually sent — and a parsed summary cannot answer it.
- **NFR-7 Webhooks will be missed on the free tier.** Render sleeps after 15 min; a cold start takes 30–60s; a gateway's webhook timeout is a few seconds. Deliveries to a sleeping service therefore fail. Razorpay retries with backoff, but nothing may be built on that assumption — hence the reconciliation poll (FR-7.5), run when the owner opens their payments screen and when a member returns to the check-in page. Webhook is the fast path; polling is the correct one.
- **NFR-8 Raw body for signatures.** `express.raw()` is mounted for `/api/gym/webhooks` **before** `express.json()`. Once the JSON parser consumes the stream the original bytes are gone, and re-serialising the parsed object changes whitespace and key order, so every signature would fail.

## 5. Accepted risks

- **A static QR can be photographed and scanned from elsewhere.** Accepted deliberately (2026-09-20): attendance here measures a presence percentage, not gate security. The owner does not care whether someone fakes a visit.
- **The real exposure is the opposite — members who don't bother scanning.** Their percentage undercounts, and the owner cannot distinguish a lazy scanner from an absentee. Mitigated by showing members their own percentage (FR-2.12) and by the owner's manual mark (FR-2.11).
- **A printed URL is permanent.** A laminated poster cannot be updated remotely, so moving off `*.workers.dev` would kill every poster. `gym_code` is stored and reissuable (reprint required); a real domain is the durable fix. Same argument as [URLS.md](URLS.md) makes about the APK, but sharper.
- **iOS PWA storage is separate from Safari's.** A member who installs the page to their home screen and identifies themselves there will not be recognised when the Camera app opens Safari. Android Chrome shares storage. Not worked around; do not promote "Add to Home Screen" to members.

## 6. Not in v1

**UPI AutoPay (recurring e-mandate)** — the natural next step: a member approves
a monthly mandate once and the fee auto-debits, which would shrink the renewal
worklist to only the mandates that bounce. Deliberately deferred until one gym
is live on one-off payments first.

Open member self-registration (signing up without the owner registering you
first, which would need phone OTP);
trainer/class scheduling; body-measurement tracking; per-member photos;
push notifications; the native iOS/Android wrapper.
