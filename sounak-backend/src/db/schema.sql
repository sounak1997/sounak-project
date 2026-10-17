-- Shopping Cart App (Grocery portal) — Postgres schema additions.
--
-- Idempotent: every statement is safe to re-run (CREATE TABLE IF NOT EXISTS /
-- ADD COLUMN IF NOT EXISTS), so this file can be applied repeatedly as it
-- grows, the same way `products`/`product_details` were presumably set up.
--
-- Ids are app-generated UUIDs (crypto.randomUUID() in Node), stored as
-- VARCHAR to match the existing `products.id` column type. `user_id` columns
-- reference MongoDB _id strings (the User collection lives in Mongo, not
-- here) — there is no DB-level FK for those, only an application-level one.
--
-- See docs/shopping-cart-app-requirements.md for the requirements this
-- implements.

-- ---------------------------------------------------------------------------
-- Extend the existing `products` table (additive only — existing rows get
-- the defaults below).
-- ---------------------------------------------------------------------------
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS image_urls JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS in_stock BOOLEAN NOT NULL DEFAULT true;

-- ---------------------------------------------------------------------------
-- Coupons (FR-2.5 / FR-2.6 / FR-2.7)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS coupons (
  id             VARCHAR PRIMARY KEY,
  code           VARCHAR NOT NULL UNIQUE,
  discount_type  VARCHAR NOT NULL CHECK (discount_type IN ('percentage', 'flat')),
  value          NUMERIC NOT NULL CHECK (value > 0),
  min_cart_value NUMERIC,
  usage_limit    INTEGER,
  times_used     INTEGER NOT NULL DEFAULT 0,
  valid_from     TIMESTAMPTZ NOT NULL DEFAULT now(),
  valid_to       TIMESTAMPTZ,
  active         BOOLEAN NOT NULL DEFAULT true,
  created_by     VARCHAR NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Cart, tied to the account rather than device storage (FR-3.3 / FR-3.4).
-- One cart per user; items keyed by (cart_id, product_id) so "add to cart"
-- on an item already present is an upsert (quantity += 1), not a new row.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS carts (
  id         VARCHAR PRIMARY KEY,
  user_id    VARCHAR NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cart_items (
  id         VARCHAR PRIMARY KEY,
  cart_id    VARCHAR NOT NULL REFERENCES carts(id) ON DELETE CASCADE,
  product_id VARCHAR NOT NULL REFERENCES products(id),
  quantity   INTEGER NOT NULL CHECK (quantity > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (cart_id, product_id)
);

-- ---------------------------------------------------------------------------
-- Orders (FR-3.6–FR-3.9, FR-2.10–FR-2.12). `order_items` snapshots product
-- name + price at purchase time so later product edits never change history
-- (products are soft-deleted, not hard-deleted, for the same reason).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS orders (
  id                  VARCHAR PRIMARY KEY,
  user_id             VARCHAR NOT NULL,
  status              VARCHAR NOT NULL DEFAULT 'placed'
                        CHECK (status IN ('placed', 'packed', 'out_for_delivery', 'delivered', 'cancelled')),
  payment_method      VARCHAR NOT NULL CHECK (payment_method IN ('cod', 'qr')),
  -- pending             = COD, due on delivery
  -- pending_verification = QR paid by customer, awaiting admin check
  -- verified            = QR payment confirmed by admin
  -- collected           = COD cash collected on delivery
  payment_status      VARCHAR NOT NULL DEFAULT 'pending'
                        CHECK (payment_status IN ('pending', 'pending_verification', 'verified', 'collected')),
  payment_reference    VARCHAR,          -- optional UPI txn id the customer supplies (FR-3.8)
  subtotal             NUMERIC NOT NULL,
  discount_applied     NUMERIC NOT NULL DEFAULT 0,
  coupon_code          VARCHAR,
  total                NUMERIC NOT NULL,
  delivery_address     JSONB NOT NULL,
  payment_verified_by  VARCHAR,          -- audit trail (NFR-2)
  payment_verified_at  TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS order_items (
  id                 VARCHAR PRIMARY KEY,
  order_id           VARCHAR NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id         VARCHAR NOT NULL REFERENCES products(id),
  product_name       VARCHAR NOT NULL,
  quantity           INTEGER NOT NULL CHECK (quantity > 0),
  price_at_purchase  NUMERIC NOT NULL
);

-- Audit trail for status + payment changes (NFR-2: who and when).
CREATE TABLE IF NOT EXISTS order_status_history (
  id         VARCHAR PRIMARY KEY,
  order_id   VARCHAR NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  event      VARCHAR NOT NULL,   -- e.g. 'status:packed', 'payment:verified', 'payment:collected'
  changed_by VARCHAR NOT NULL,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Payment QR config — a single "live" row (FR-2.8 / FR-2.9).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payment_config (
  id            INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  qr_image_url  VARCHAR,
  updated_by    VARCHAR,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO payment_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Service requests — the unified callback-queue table (FR-3.10 / FR-3.11 /
-- FR-2.13 / FR-2.14). Shared across grocery assistance, doctor booking, test
-- booking, and the Helper portal — see
-- docs/doctors-test-booking-and-helper-portal-requirements.md § 5. Only
-- 'grocery_assistance' is wired up to an API yet; the other request_type
-- values are reserved for when that portal is built.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS service_requests (
  id            VARCHAR PRIMARY KEY,
  user_id       VARCHAR NOT NULL,
  phone         VARCHAR NOT NULL,
  request_type  VARCHAR NOT NULL
                  CHECK (request_type IN ('grocery_assistance', 'doctor_booking', 'test_booking', 'helper_task')),
  reason        VARCHAR,           -- e.g. 'place_order' | 'general_help' | 'delivery_issue' | 'custom'
  details       JSONB NOT NULL DEFAULT '{}'::jsonb,  -- type-specific structured fields
  note          TEXT,
  status        VARCHAR NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'contacted', 'resolved')),
  resolved_by   VARCHAR,
  resolved_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Admin panel additions (2026-10-13)
--
-- `mrp` is the printed maximum retail price. Optional: when set and above
-- `price`, the customer screens show it struck through next to the selling
-- price. Nothing else (cart, orders, coupons) reads it — `price` stays the
-- only number money is computed from.
-- ---------------------------------------------------------------------------
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS mrp NUMERIC;

-- ---------------------------------------------------------------------------
-- Catalogue images, stored as BYTES IN POSTGRES (2026-10-13)
--
-- Every image the admin panel uploads — product photos, doctor / clinic / lab
-- photos, the payment QR — lands here and is served from GET /images/:id.
--
-- Not on disk, for the reason recorded at MEMBER PHOTOS in schema_gym.sql and
-- in commit ae26747: Render's filesystem is ephemeral, so a file written to
-- uploads/ in production is gone on the next restart while the row that points
-- at it survives. That made every admin upload a picture with a shelf life of
-- a few hours, and the payment QR — the one image checkout depends on — the
-- worst of them. The images already under uploads/products/ are committed to
-- git and keep being served from /uploads; only new uploads come here.
--
-- Each image is resized to webp before it is stored (~20-120 KB), so even a
-- thousand of them sit comfortably inside Neon's free tier.
--
-- The id is random and is the whole URL, so it is safe to cache for ever: a
-- replaced image always gets a new id rather than new bytes under the old one.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS catalog_images (
  id         VARCHAR PRIMARY KEY,
  mime       VARCHAR NOT NULL DEFAULT 'image/webp',
  bytes      BYTEA   NOT NULL,
  byte_size  INTEGER NOT NULL,
  created_by VARCHAR,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_service_requests_status ON service_requests(status);
CREATE INDEX IF NOT EXISTS idx_coupons_code ON coupons(code);
