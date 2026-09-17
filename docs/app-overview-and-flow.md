# App Overview & Flow

**Date:** September 16, 2026
**Status:** Confirmed — high-level flow. See the linked documents for full requirements, data model, and open-question resolutions.

One Ionic/Angular app (`sounak-android`), one login, one backend (`sounak-backend`). After login, the user sees three portals.

## Login

- Admin login
- User (customer) login

Same `User` model, JWT + role-based auth for both — see [shopping-cart-app-requirements.md § 3.1](shopping-cart-app-requirements.md#31-authentication--authorization).

## After login — three portals

1. **Grocery items**
2. **Doctors and Test Booking**
3. **Helper** (call an assistant)

---

## 1. Grocery Items

**Admin can:**
- Add product
- Change product cost
- Create coupon or voucher (e.g. 25% off listed price)
- Change/update the QR image used for online payment

**User can:**
- See the products (browse/search — see linked spec)
- Add to cart
- Place order
- Pay by Cash on Delivery, or by scanning the QR code for direct payment

**Flow:** select Grocery items → browse products → add to cart → place order → pay (COD or scan QR).

Full spec: [shopping-cart-app-requirements.md](shopping-cart-app-requirements.md)

---

## 2. Doctors and Test Booking

**Doctor booking:**
- Places are listed (e.g. Maiti Medical)
- Each place shows which doctors visit Monday–Sunday, and when
- Anyone can check this and book a doctor
- The place gets a call related to that booking (callback-to-confirm, staff-worked queue — not automated)

**Test booking:**
- Companies/labs are listed with their available tests
- Anyone can book a test from any company, and undergoes the test there

**Admin can:** add places, doctors and their Monday–Sunday schedules, companies, and their available tests.

**Flow:**
- (a) Check a place → check its Mon–Sun doctor schedule → book a doctor → that place gets a call about the booking
- (b) Check companies and their tests → book a test → undergo the test at that company

Full spec: [doctors-test-booking-and-helper-portal-requirements.md](doctors-test-booking-and-helper-portal-requirements.md)

---

## 3. Helper (call an assistant)

Request an assistant for any kind of job:
- Placing an order by phone call
- General help
- Delivery-related help, by phone call (e.g. arranging for someone to bring something to the user's home)

**Flow:** select Helper → request an assistant for one of the above.

Uses the same request/queue mechanism as grocery assistance and doctor/test booking — see [doctors-test-booking-and-helper-portal-requirements.md § 5](doctors-test-booking-and-helper-portal-requirements.md#5-data-model-high-level) (`ServiceRequest`, `request_type: helper_task`).

---

## Build status

- **Backend (`sounak-backend`):** in progress — Auth/RBAC extension and Grocery data model/API first, then Doctors & Test Booking + Helper.
- **Frontend (`sounak-android`):** Ionic scaffold created, screens not yet built.
