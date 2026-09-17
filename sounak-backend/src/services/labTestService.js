// src/services/labTestService.js
//
// Admin-managed catalog: labs and the tests each one offers. Same shape as
// doctorBookingService — booking itself reuses service_requests.
const pgPool = require('../config/pg.config');
const { genId } = require('../utils/id');

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

exports.createLab = async ({ name, address, phone }) => {
  const id = genId('LAB');
  const result = await pgPool.query(
    `INSERT INTO labs (id, name, address, phone) VALUES ($1, $2, $3, $4) RETURNING *`,
    [id, name, address || null, phone]
  );
  return result.rows[0];
};

exports.setLabActive = async (id, active) => {
  const result = await pgPool.query(
    'UPDATE labs SET active = $1, updated_at = now() WHERE id = $2 RETURNING *',
    [active, id]
  );
  return result.rows[0] || null;
};

exports.createTest = async ({ labId, name, price, description }) => {
  const id = genId('TEST');
  const result = await pgPool.query(
    `INSERT INTO tests (id, lab_id, name, price, description) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [id, labId, name, price ?? null, description || null]
  );
  return result.rows[0];
};

exports.setTestActive = async (id, active) => {
  const result = await pgPool.query(
    'UPDATE tests SET active = $1, updated_at = now() WHERE id = $2 RETURNING *',
    [active, id]
  );
  return result.rows[0] || null;
};
