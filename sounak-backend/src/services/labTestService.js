// src/services/labTestService.js
//
// Admin-managed catalog: labs and the tests each one offers. Same shape as
// doctorBookingService — booking itself reuses service_requests.
const pgPool = require('../config/pg.config');
const { genId } = require('../utils/id');
const { updateRow } = require('../utils/updateRow');
const catalogImageService = require('./catalogImageService');

// Columns the admin panel can set; the controller's readFields spec produces them.
const LAB_COLUMNS = ['name', 'address', 'phone', 'opening_hours', 'accreditation', 'map_url', 'photo_url'];
const TEST_COLUMNS = ['name', 'price', 'description', 'sample_type', 'preparation', 'report_time'];

const pick = (fields, columns) =>
  Object.fromEntries(columns.filter((c) => fields[c] !== undefined).map((c) => [c, fields[c]]));

exports.listLabs = async ({ includeInactive = false } = {}) => {
  const labsResult = await pgPool.query(
    `SELECT * FROM labs ${includeInactive ? '' : 'WHERE active = true'} ORDER BY name ASC`
  );
  const labs = labsResult.rows;
  if (labs.length === 0) return [];

  const labIds = labs.map((l) => l.id);
  const testsResult = await pgPool.query(
    `SELECT * FROM tests WHERE lab_id = ANY($1) ${includeInactive ? '' : 'AND active = true'} ORDER BY name ASC`,
    [labIds]
  );
  const tests = testsResult.rows;

  return labs.map((lab) => ({
    ...lab,
    tests: tests.filter((t) => t.lab_id === lab.id),
  }));
};

exports.getLab = async (id) => {
  const result = await pgPool.query('SELECT * FROM labs WHERE id = $1', [id]);
  return result.rows[0] || null;
};

exports.createLab = async (fields) => {
  const id = genId('LAB');
  const values = LAB_COLUMNS.map((column) => fields[column] ?? null);
  const placeholders = LAB_COLUMNS.map((_, i) => `$${i + 2}`).join(', ');
  const result = await pgPool.query(
    `INSERT INTO labs (id, ${LAB_COLUMNS.join(', ')}) VALUES ($1, ${placeholders}) RETURNING *`,
    [id, ...values]
  );
  return result.rows[0];
};

exports.updateLab = async (id, fields) => {
  const changes = pick(fields, LAB_COLUMNS);
  if (Object.keys(changes).length === 0) return exports.getLab(id);
  const updated = await updateRow(pgPool, 'labs', id, changes);
  if (!updated) return null;
  if (updated.previous?.photo_url && updated.previous.photo_url !== updated.row.photo_url) {
    await catalogImageService.releaseImages([updated.previous.photo_url]);
  }
  return updated.row;
};

exports.setLabActive = async (id, active) => {
  const result = await pgPool.query(
    'UPDATE labs SET active = $1, updated_at = now() WHERE id = $2 RETURNING *',
    [active, id]
  );
  return result.rows[0] || null;
};

/** One test, with the name of the lab that offers it. */
exports.getTest = async (id) => {
  const result = await pgPool.query(
    `SELECT t.*, l.name AS lab_name FROM tests t JOIN labs l ON l.id = t.lab_id WHERE t.id = $1`,
    [id]
  );
  return result.rows[0] || null;
};

// Accepts column-keyed fields, plus labId. The seed scripts' original
// { labId, name, price, description } shape still fits.
exports.createTest = async ({ labId, ...fields }) => {
  const lab = await exports.getLab(labId);
  if (!lab) {
    const err = new Error(`Lab '${labId}' not found.`);
    err.statusCode = 404;
    throw err;
  }
  const id = genId('TEST');
  const values = TEST_COLUMNS.map((column) => fields[column] ?? null);
  const placeholders = TEST_COLUMNS.map((_, i) => `$${i + 3}`).join(', ');
  const result = await pgPool.query(
    `INSERT INTO tests (id, lab_id, ${TEST_COLUMNS.join(', ')}) VALUES ($1, $2, ${placeholders}) RETURNING *`,
    [id, labId, ...values]
  );
  return result.rows[0];
};

exports.updateTest = async (id, fields) => {
  const changes = pick(fields, TEST_COLUMNS);
  if (Object.keys(changes).length === 0) return exports.getTest(id);
  const updated = await updateRow(pgPool, 'tests', id, changes);
  return updated ? updated.row : null;
};

exports.setTestActive = async (id, active) => {
  const result = await pgPool.query(
    'UPDATE tests SET active = $1, updated_at = now() WHERE id = $2 RETURNING *',
    [active, id]
  );
  return result.rows[0] || null;
};
