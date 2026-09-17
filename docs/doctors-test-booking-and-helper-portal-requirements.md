# Doctors & Test Booking Portal + Helper Portal — Requirements (Draft)

**Version:** 0.1 (Draft — captured from verbal description)
**Date:** September 16, 2026
**Status:** Draft — open questions below block the data model

## 1. Context

The app is now a **multi-portal platform**, not a single shopping-cart app. On login, the customer sees multiple sections:

1. **Grocery** — the shopping cart app already specified in [shopping-cart-app-requirements.md](shopping-cart-app-requirements.md).
2. **Doctors & Test Booking** — described below.
3. **Helper** — a general-purpose "call an assistant to do any kind of job" portal.

All three sit behind the same login (one account, one app), per "when the user logs in he will be able to see two things [and more]."

## 2. Doctors & Test Booking Portal

### 2.1 Doctor Booking
- Medical centers (e.g. "Maiti Medical") are listed in the app.
- Each center has a weekly doctor schedule: which doctors visit, on which day(s) of the week, and at what time(s).
- A customer browses centers/doctors and books an appointment with a doctor.
- On booking, the medical center receives a call related to the booking (mechanism TBD — see Open Questions).

### 2.2 Test Booking
- Companies/labs are listed, each with the tests they offer.
- A customer books a test from any listed company, then undergoes the test at that company's location (not home collection, per "undergo test from there").

### 2.3 Admin
- All center, doctor-schedule, company, and test-catalog data is entered from the Admin end — customers cannot list themselves.

## 3. Helper Portal

- A general request for a human assistant to "do any kind of job" — broader than the grocery app's delivery/order-related assistance queue (FR-3.10/3.11 in the shopping cart spec).
- Working assumption: same underlying mechanism as the grocery assistance queue (a request captured with phone + note, joining a staff-worked queue), just exposed as its own top-level portal with a wider set of task categories, not tied to an order. **To confirm.**

## 4. Decisions (2026-09-16)

- **App/account structure** — **Resolved:** one Ionic/Angular app (`sounak-android`), one login, one `sounak-backend`. Home screen shows sections for Grocery / Doctors & Tests / Helper. Same `User`/JWT/role system as the grocery portal — no new roles.
- **Center & lab data ownership** — **Resolved:** Admin-only for v1, same as grocery. The platform Admin enters and maintains every medical center's doctors/schedules and every lab's test menu. No separate center/lab login in this version.
- **Doctor appointment model** — **Resolved: callback-to-confirm.** Booking a doctor is a *request* (doctor + preferred day), not a slot reservation. It joins the same queue mechanism as the grocery assistance feature; staff calls the center to lock in an actual time. No slot-capacity tracking needed in v1.
- **The "call to the medical center"** — **Resolved:** same manual queue as above — staff (Admin) works the queue and calls the center, mirroring how the grocery portal's assistance queue has staff call the *customer*. No automated dialer/SMS in v1.
- **Test booking flow** — **Resolved:** same callback-to-confirm pattern as doctor booking (request queued, staff/lab coordinates the actual time).
- **Helper portal scope** — **Resolved: same mechanism, generalized.** Reuses the single request/queue table built for grocery assistance — just a different `request_type` and no order reference required.

## 5. Data Model (high level)

Reuses the platform's single `User` (role: admin/customer) and a **generalized request/queue table** shared across all four callback-style flows (this supersedes a grocery-only `AssistanceRequest` table):

- **ServiceRequest** — id, user_id, phone, request_type (`grocery_assistance` | `doctor_booking` | `test_booking` | `helper_task`), details (structured, type-specific — e.g. `{doctor_id, center_id, preferred_date}` or `{test_id, lab_id, preferred_date}` or `{}`), note (free text), status (pending/contacted/resolved), resolved_by, resolved_at, created_at, updated_at

Catalog data (Admin-managed, read-only for customers):

- **MedicalCenter** — id, name, address, phone, active
- **Doctor** — id, center_id, name, specialization, active
- **DoctorSchedule** — id, doctor_id, day_of_week, start_time, end_time (recurring weekly availability, informational — no capacity)
- **Lab** — id, name, address, phone, active
- **Test** — id, lab_id, name, price, description, active

## 6. Build Sequencing

This portal's backend is specified but **not yet built**. Per the existing plan, the grocery portal's data model + Express API is being completed first (see [shopping-cart-app-requirements.md](shopping-cart-app-requirements.md) Section 7); this portal — MedicalCenter/Doctor/Lab/Test catalog CRUD plus the generalized `ServiceRequest` table — follows once that's done, unless redirected sooner.
