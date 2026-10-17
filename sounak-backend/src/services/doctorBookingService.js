// src/services/doctorBookingService.js
//
// Admin-managed catalog: medical centers, their doctors, and each doctor's
// weekly schedule. See docs/doctors-test-booking-and-helper-portal-requirements.md.
// The actual booking action (customer requests a doctor, staff calls the
// center to confirm) reuses the existing service_requests table/service —
// nothing booking-specific lives here, only the catalog customers browse.
const pgPool = require('../config/pg.config');
const { genId } = require('../utils/id');
const { updateRow } = require('../utils/updateRow');
const catalogImageService = require('./catalogImageService');

// Columns the admin panel can set, beyond the ids. Keys of these objects are
// what create/update accept — the controller's readFields spec produces them.
const CENTER_COLUMNS = ['name', 'address', 'phone', 'map_url', 'photo_url'];
const DOCTOR_COLUMNS = [
  'name', 'specialization', 'qualification', 'experience_years', 'consultation_fee',
  'registration_no', 'languages', 'about', 'photo_url',
];

const pick = (fields, columns) =>
  Object.fromEntries(columns.filter((c) => fields[c] !== undefined).map((c) => [c, fields[c]]));

/** Release the old photo when an update replaced or cleared it. */
const releaseReplacedPhoto = async (updated) => {
  if (updated && updated.previous?.photo_url && updated.previous.photo_url !== updated.row.photo_url) {
    await catalogImageService.releaseImages([updated.previous.photo_url]);
  }
};

const scheduleFor = async (db, doctorId) => {
  const result = await db.query(
    'SELECT * FROM doctor_schedules WHERE doctor_id = $1 ORDER BY day_of_week ASC, start_time ASC',
    [doctorId]
  );
  return result.rows;
};

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

exports.getCenter = async (id) => {
  const result = await pgPool.query('SELECT * FROM medical_centers WHERE id = $1', [id]);
  return result.rows[0] || null;
};

exports.createCenter = async (fields) => {
  const { name, address, phone, map_url: mapUrl, photo_url: photoUrl } = fields;
  const id = genId('CTR');
  const result = await pgPool.query(
    `INSERT INTO medical_centers (id, name, address, phone, map_url, photo_url)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [id, name, address || null, phone, mapUrl || null, photoUrl || null]
  );
  return result.rows[0];
};

exports.updateCenter = async (id, fields) => {
  const changes = pick(fields, CENTER_COLUMNS);
  if (Object.keys(changes).length === 0) return exports.getCenter(id);
  const updated = await updateRow(pgPool, 'medical_centers', id, changes);
  await releaseReplacedPhoto(updated);
  return updated ? updated.row : null;
};

exports.setCenterActive = async (id, active) => {
  const result = await pgPool.query(
    'UPDATE medical_centers SET active = $1, updated_at = now() WHERE id = $2 RETURNING *',
    [active, id]
  );
  return result.rows[0] || null;
};

/** One doctor with their weekly schedule and the name of the center they sit at. */
exports.getDoctor = async (id) => {
  const result = await pgPool.query(
    `SELECT d.*, c.name AS center_name
     FROM doctors d JOIN medical_centers c ON c.id = d.center_id
     WHERE d.id = $1`,
    [id]
  );
  const doctor = result.rows[0];
  if (!doctor) return null;
  return { ...doctor, schedule: await scheduleFor(pgPool, id) };
};

/**
 * Add a doctor, and optionally their weekly schedule in the same transaction,
 * so the admin's single "Save" never leaves a doctor listed with no hours.
 *
 * Accepts either column-keyed fields (from the admin controller) or the
 * original { centerId, name, specialization } shape the seed scripts pass.
 */
exports.createDoctor = async ({ centerId, slots, ...fields }) => {
  const id = genId('DOC');
  const values = DOCTOR_COLUMNS.map((column) => fields[column] ?? null);

  const client = await pgPool.pool.connect();
  try {
    await client.query('BEGIN');
    const center = await client.query('SELECT 1 FROM medical_centers WHERE id = $1', [centerId]);
    if (!center.rows[0]) {
      const err = new Error(`Center '${centerId}' not found.`);
      err.statusCode = 404;
      throw err;
    }
    const placeholders = DOCTOR_COLUMNS.map((_, i) => `$${i + 3}`).join(', ');
    const result = await client.query(
      `INSERT INTO doctors (id, center_id, ${DOCTOR_COLUMNS.join(', ')})
       VALUES ($1, $2, ${placeholders}) RETURNING *`,
      [id, centerId, ...values]
    );
    if (slots) await replaceSchedule(client, id, slots);
    await client.query('COMMIT');
    return { ...result.rows[0], schedule: await scheduleFor(pgPool, id) };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
};

/**
 * Edit a doctor's details and, when `slots` is given, replace their schedule —
 * both or neither, in one transaction.
 */
exports.updateDoctor = async (id, { slots, ...fields }) => {
  const changes = pick(fields, DOCTOR_COLUMNS);

  const client = await pgPool.pool.connect();
  let updated;
  try {
    await client.query('BEGIN');
    if (Object.keys(changes).length) {
      updated = await updateRow(client, 'doctors', id, changes);
      if (!updated) {
        await client.query('ROLLBACK');
        return null;
      }
    } else {
      const exists = await client.query('SELECT 1 FROM doctors WHERE id = $1', [id]);
      if (!exists.rows[0]) {
        await client.query('ROLLBACK');
        return null;
      }
    }
    if (slots) await replaceSchedule(client, id, slots);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  await releaseReplacedPhoto(updated);
  return exports.getDoctor(id);
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
async function replaceSchedule(client, doctorId, slots) {
  await client.query('DELETE FROM doctor_schedules WHERE doctor_id = $1', [doctorId]);
  for (const slot of slots) {
    await client.query(
      `INSERT INTO doctor_schedules (id, doctor_id, day_of_week, start_time, end_time) VALUES ($1, $2, $3, $4, $5)`,
      [genId('SCH'), doctorId, slot.dayOfWeek, slot.startTime, slot.endTime]
    );
  }
}

exports.setDoctorSchedule = async (doctorId, slots) => {
  const client = await pgPool.pool.connect();
  try {
    await client.query('BEGIN');
    await replaceSchedule(client, doctorId, slots);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  return scheduleFor(pgPool, doctorId);
};
