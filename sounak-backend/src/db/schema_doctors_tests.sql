-- Doctors & Test Booking portal — Postgres schema.
--
-- Idempotent, additive-only, same conventions as schema.sql (app-generated
-- VARCHAR ids, admin-managed catalog data). See
-- docs/doctors-test-booking-and-helper-portal-requirements.md §§ 4-5 for the
-- requirements and decisions this implements: Admin-only data entry, no
-- separate center/lab login, callback-to-confirm booking (handled by the
-- existing `service_requests` table in schema.sql — not duplicated here).

CREATE TABLE IF NOT EXISTS medical_centers (
  id         VARCHAR PRIMARY KEY,
  name       VARCHAR NOT NULL,
  address    VARCHAR,
  phone      VARCHAR NOT NULL,   -- who the "place gets a call" lands on
  active     BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS doctors (
  id              VARCHAR PRIMARY KEY,
  center_id       VARCHAR NOT NULL REFERENCES medical_centers(id) ON DELETE CASCADE,
  name            VARCHAR NOT NULL,
  specialization  VARCHAR,
  active          BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Recurring weekly availability — informational only (FR: "callback to
-- confirm" booking model, no slot capacity to track).
CREATE TABLE IF NOT EXISTS doctor_schedules (
  id          VARCHAR PRIMARY KEY,
  doctor_id   VARCHAR NOT NULL REFERENCES doctors(id) ON DELETE CASCADE,
  day_of_week INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6), -- 0=Sunday .. 6=Saturday (JS Date.getDay() convention)
  start_time  TIME NOT NULL,
  end_time    TIME NOT NULL
);

CREATE TABLE IF NOT EXISTS labs (
  id         VARCHAR PRIMARY KEY,
  name       VARCHAR NOT NULL,
  address    VARCHAR,
  phone      VARCHAR NOT NULL,
  active     BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tests (
  id          VARCHAR PRIMARY KEY,
  lab_id      VARCHAR NOT NULL REFERENCES labs(id) ON DELETE CASCADE,
  name        VARCHAR NOT NULL,
  price       NUMERIC,
  description VARCHAR,
  active      BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Admin panel additions (2026-10-13)
--
-- The details a patient actually decides on, entered from the admin panel.
-- All optional, so every existing row stays valid and the booking screen just
-- leaves out whatever has not been filled in. Free text where the real-world
-- value is free text ("MBBS, MD (Medicine)", "Mon-Sat 7 AM - 8 PM",
-- "10-12 hours fasting"); a number only where it is one.
--
-- photo_url holds a /images/<id> path from catalog_images (schema.sql).
-- map_url is a Google Maps (or any) link the "Directions" button opens.
-- ---------------------------------------------------------------------------
ALTER TABLE medical_centers
  ADD COLUMN IF NOT EXISTS map_url   VARCHAR,
  ADD COLUMN IF NOT EXISTS photo_url VARCHAR;

ALTER TABLE doctors
  ADD COLUMN IF NOT EXISTS qualification    VARCHAR,   -- degrees, e.g. "MBBS, MD (Medicine)"
  ADD COLUMN IF NOT EXISTS experience_years INTEGER CHECK (experience_years >= 0),
  ADD COLUMN IF NOT EXISTS consultation_fee NUMERIC CHECK (consultation_fee >= 0),
  ADD COLUMN IF NOT EXISTS registration_no  VARCHAR,   -- medical council registration
  ADD COLUMN IF NOT EXISTS languages        VARCHAR,   -- e.g. "Bengali, Hindi, English"
  ADD COLUMN IF NOT EXISTS about            TEXT,
  ADD COLUMN IF NOT EXISTS photo_url        VARCHAR;

ALTER TABLE labs
  ADD COLUMN IF NOT EXISTS opening_hours VARCHAR,     -- e.g. "Mon-Sat 7 AM - 8 PM"
  ADD COLUMN IF NOT EXISTS accreditation VARCHAR,     -- e.g. "NABL"
  ADD COLUMN IF NOT EXISTS map_url       VARCHAR,
  ADD COLUMN IF NOT EXISTS photo_url     VARCHAR;

ALTER TABLE tests
  ADD COLUMN IF NOT EXISTS sample_type VARCHAR,       -- e.g. "Blood", "Urine"
  ADD COLUMN IF NOT EXISTS preparation VARCHAR,       -- e.g. "10-12 hours fasting"
  ADD COLUMN IF NOT EXISTS report_time VARCHAR;       -- e.g. "Same day", "24 hours"

CREATE INDEX IF NOT EXISTS idx_doctors_center_id ON doctors(center_id);
CREATE INDEX IF NOT EXISTS idx_doctor_schedules_doctor_id ON doctor_schedules(doctor_id);
CREATE INDEX IF NOT EXISTS idx_tests_lab_id ON tests(lab_id);
