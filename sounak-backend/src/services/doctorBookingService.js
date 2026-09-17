// src/services/doctorBookingService.js
//
// Admin-managed catalog: medical centers, their doctors, and each doctor's
// weekly schedule. See docs/doctors-test-booking-and-helper-portal-requirements.md.
// The actual booking action (customer requests a doctor, staff calls the
// center to confirm) reuses the existing service_requests table/service —
// nothing booking-specific lives here, only the catalog customers browse.
const pgPool = require('../config/pg.config');
const { genId } = require('../utils/id');

// Centers, each with their doctors and each doctor's weekly schedule
// nested in — this is what the customer-facing browse screen needs in one
// call, matching the "check a place -> see its Mon-Sun schedule" flow.
exports.listCenters = async ({ includeInactive = false } = {}) => {
  const centersResult = await pgPool.query(
    `SELECT * FROM medical_centers ${includeInactive ? '' : 'WHERE active = true'} ORDER BY name ASC`
  );
  const centers = centersResult.rows;
  if (centers.length === 0) return [];

  const centerIds = centers.map((c) => c.id);
  const doctorsResult = await pgPool.query(
    `SELECT * FROM doctors WHERE center_id = ANY($1) ${includeInactive ? '' : 'AND active = true'} ORDER BY name ASC`,
    [centerIds]
  );
  const doctors = doctorsResult.rows;

  const doctorIds = doctors.map((d) => d.id);
  const schedulesResult = doctorIds.length
    ? await pgPool.query(
        `SELECT * FROM doctor_schedules WHERE doctor_id = ANY($1) ORDER BY day_of_week ASC, start_time ASC`,
        [doctorIds]
      )
    : { rows: [] };
  const schedules = schedulesResult.rows;

  return centers.map((center) => ({
    ...center,
    doctors: doctors
      .filter((d) => d.center_id === center.id)
      .map((doctor) => ({
        ...doctor,
        schedule: schedules.filter((s) => s.doctor_id === doctor.id),
      })),
  }));
};

exports.createCenter = async ({ name, address, phone }) => {
  const id = genId('CTR');
  const result = await pgPool.query(
    `INSERT INTO medical_centers (id, name, address, phone) VALUES ($1, $2, $3, $4) RETURNING *`,
    [id, name, address || null, phone]
  );
  return result.rows[0];
};

exports.setCenterActive = async (id, active) => {
  const result = await pgPool.query(
    'UPDATE medical_centers SET active = $1, updated_at = now() WHERE id = $2 RETURNING *',
    [active, id]
  );
  return result.rows[0] || null;
};

exports.createDoctor = async ({ centerId, name, specialization }) => {
  const id = genId('DOC');
  const result = await pgPool.query(
    `INSERT INTO doctors (id, center_id, name, specialization) VALUES ($1, $2, $3, $4) RETURNING *`,
    [id, centerId, name, specialization || null]
  );
  return result.rows[0];
};

exports.setDoctorActive = async (id, active) => {
  const result = await pgPool.query(
    'UPDATE doctors SET active = $1, updated_at = now() WHERE id = $2 RETURNING *',
    [active, id]
  );
  return result.rows[0] || null;
};

// A doctor's schedule is replaced wholesale on edit — simpler and safer than
// diffing individual slots for a "Mon/Wed/Fri 5-8pm" style weekly pattern.
exports.setDoctorSchedule = async (doctorId, slots) => {
  const client = await pgPool.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM doctor_schedules WHERE doctor_id = $1', [doctorId]);
    for (const slot of slots) {
      await client.query(
        `INSERT INTO doctor_schedules (id, doctor_id, day_of_week, start_time, end_time) VALUES ($1, $2, $3, $4, $5)`,
        [genId('SCH'), doctorId, slot.dayOfWeek, slot.startTime, slot.endTime]
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  const result = await pgPool.query('SELECT * FROM doctor_schedules WHERE doctor_id = $1 ORDER BY day_of_week ASC', [doctorId]);
  return result.rows;
};
