# Shopping Cart App — Requirements Specification

**Version:** 0.1 (Draft)
**Date:** September 16, 2026
**Status:** Draft — for review

## 1. Purpose and Scope

This document specifies the functional and non-functional requirements for a Flipkart-style shopping cart application with two user roles — Admin and Customer — covering product and pricing management, coupons, cart and checkout, Cash on Delivery and QR-based online payment, and a phone-based assistance feature for orders and delivery support.

Target platforms: Android app and web app from a single Ionic/Angular codebase, backed by a Node/Express API (with an optional Python/FastAPI service for future GenAI features — out of scope for this version, see Section 7).

## 2. User Roles

### 2.1 Admin
Manages the product catalog, pricing, promotions, the payment QR code, incoming orders, and assistance requests.

### 2.2 Customer (User)
Browses products, manages a cart, places orders, chooses a payment method, and can request phone-based assistance.

**Decision (2026-09-16):** no separate Delivery Agent / support-staff role in v1 — Admin alone handles order-status updates and assistance callbacks. The `role` field stays a simple `admin` / `customer` enum, structured so a third role can be added later without a data-model change. See Section 6.

## 3. Functional Requirements

### 3.1 Authentication & Authorization
- **FR-1.1** Both Admin and Customer accounts require login (email or phone + password, or OTP-based).
- **FR-1.2** Admin accounts are provisioned manually/seeded rather than self-registered, for security. Customers self-register, and Admin can also create a customer account directly (e.g. for a phone-order customer walked through checkout verbally by staff).
- **FR-1.3** JWT-based session tokens, with role (admin/customer) encoded in the token and checked on every protected route (RBAC).
- **FR-1.4** Password reset via email or OTP.
- **FR-1.5** Session expiry with refresh-token handling.

### 3.2 Admin Module

#### 3.2.1 Product Management
- **FR-2.1** Add a new product: name, description, images, category, stock quantity, price.
- **FR-2.2** Edit an existing product's details, including price ("change product cost").
- **FR-2.3** Deactivate a product (soft delete, so past orders referencing it stay intact) rather than hard-delete.
- **FR-2.4** Mark a product in stock / out of stock.

#### 3.2.2 Coupon / Voucher Management
- **FR-2.5** Create a coupon: code, discount type (percentage or flat amount), value (e.g. 25% off listed price), validity window, optional minimum cart value and usage limit.
- **FR-2.6** Edit or deactivate an existing coupon.
- **FR-2.7** View redemption count per coupon code.

#### 3.2.3 Payment QR Management
- **FR-2.8** Upload or replace the QR code image used for online payments (e.g. a UPI QR).
- **FR-2.9** Only one QR image is "live" at a time; uploading a new one replaces what customers see.

#### 3.2.4 Order Management
- **FR-2.10** View all incoming orders: customer details, items, total, payment method (COD or QR), payment status.
- **FR-2.11** Update order status (Placed → Packed → Out for delivery → Delivered / Cancelled).
- **FR-2.12** For QR payments, mark payment as "verified" once confirmed — there's no payment-gateway callback in this version, so verification is manual (see Section 6).

#### 3.2.5 Assistance Request Management
- **FR-2.13** View a queue of customer assistance requests, each with phone number, requested reason, and notes.
- **FR-2.14** Mark a request as contacted / resolved.

### 3.3 Customer Module

#### 3.3.1 Product Browsing
- **FR-3.1** View product listing with category filter and search.
- **FR-3.2** View product detail: images, price, description, stock status.

#### 3.3.2 Cart Management
- **FR-3.3** Add to cart, adjust quantity, remove an item.
- **FR-3.4** Cart persists across sessions, tied to the logged-in account rather than only local device storage.
- **FR-3.5** Apply a coupon code at checkout; total recalculates with the discount applied.

#### 3.3.3 Order Placement & Payment
- **FR-3.6** Place an order from the cart: choose a delivery address and a payment method — Cash on Delivery or Scan & Pay.
- **FR-3.7** Cash on Delivery: order confirms immediately, payment marked "pending, due on delivery."
- **FR-3.8** Scan & Pay: app displays the admin-uploaded QR code; customer pays via any UPI app; order is recorded as "pending verification," optionally with a transaction/reference ID field to speed up admin verification.
- **FR-3.9** View order history and current order status.

#### 3.3.4 Assistance / Callback Requests
- **FR-3.10** A visible "Request assistance" option lets the customer request a phone call for: placing an order verbally, general help, a delivery-related issue, or a custom request (e.g. asking someone to bring a specific item not in the catalog — captured as free text for staff to review).
- **FR-3.11** The request captures a phone number (defaulting to the account's number, editable) and an optional note, and joins the queue in FR-2.13. This is a manual callback queue in v1 — not an automated dialer or AI voice agent.

## 4. Non-Functional Requirements

- **NFR-1** Passwords hashed (bcrypt or equivalent); JWTs signed and short-lived, with refresh tokens.
- **NFR-2** Payment-related actions (marking COD collected, marking QR payment verified) are logged with who and when, for audit purposes.
- **NFR-3** Product images and the QR image are compressed/resized on upload.
- **NFR-4** The same Angular/Ionic codebase serves both the Android app and the web app without duplicated business logic.
- **NFR-5** Product listing API supports pagination so it scales as the catalog grows.

## 5. Suggested Data Model (high level)

- **User** — id, name, phone, email, password_hash, role (admin/customer), address(es)
- **Product** — id, name, description, price, stock, category, image_url(s), active
- **Coupon** — id, code, discount_type, value, valid_from, valid_to, usage_limit, times_used
- **Order** — id, user_id, items[], total, discount_applied, payment_method, payment_status, order_status, address, created_at
- **OrderItem** — order_id, product_id, quantity, price_at_purchase
- **AssistanceRequest** — id, user_id, phone, reason, note, status (pending/contacted/resolved), created_at
- **PaymentConfig** — current QR image URL, updated_by, updated_at

## 6. Assumptions & Open Questions — Resolved 2026-09-16

- **Delivery/support role** — **Resolved:** no separate role in v1. Admin alone handles order-status updates and assistance callbacks. `User.role` stays a two-value enum (`admin` / `customer`); a `delivery_agent` value can be added later without restructuring.
- **Payment verification** — Scan & Pay verification is manual (Admin checks their own UPI app and marks the order paid). A real gateway (Razorpay/PayU) with automatic confirmation is a later upgrade, not v1, based on "admin can change [the QR] by uploading the QR image."
- **Account creation** — **Resolved:** customers self-register, **and** Admin can also create a customer account directly (e.g. for a phone-order customer). See FR-1.2.
- **Assistance feature** — a manual callback queue (staff calls the customer back), not an automated IVR/AI voice agent, based on "order a person to bring something" implying a human handles it.

## 7. Build Sequencing

Starting point (2026-09-16): **data model + Node/Express API first**, extending the existing `sounak-backend` service — User/Product/Coupon/Order models, auth (JWT + RBAC), and CRUD endpoints — since this is the shared foundation both the admin and customer screens in `sounak-android` depend on. Screens follow once the API contract is stable.
