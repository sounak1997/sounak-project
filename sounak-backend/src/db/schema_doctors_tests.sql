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

CREATE INDEX IF NOT EXISTS idx_doctors_center_id ON doctors(center_id);
CREATE INDEX IF NOT EXISTS idx_doctor_schedules_doctor_id ON doctor_schedules(doctor_id);
CREATE INDEX IF NOT EXISTS idx_tests_lab_id ON tests(lab_id);
