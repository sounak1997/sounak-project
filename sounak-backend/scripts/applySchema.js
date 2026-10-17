// scripts/applySchema.js
//
// Applies the grocery + doctors/tests schema files to the database in
// POSTGRES_URL. Both files are idempotent (CREATE TABLE IF NOT EXISTS, ADD
// COLUMN IF NOT EXISTS), so this is safe to re-run and is how additions to
// them reach a database — the same approach scripts/seedGym.js takes for
// schema_gym.sql.
//
// Run it BEFORE deploying backend code that uses new columns: the old code
// ignores columns it does not know about, but new code inserting into a column
// that does not exist yet fails every save.
//
//   node scripts/applySchema.js
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pgPool = require('../src/config/pg.config');

const FILES = ['schema.sql', 'schema_doctors_tests.sql'];

async function main() {
  const host = (process.env.POSTGRES_URL || '').replace(/^.*@/, '').replace(/\/.*$/, '');
  console.log(`Applying to ${host || '(POSTGRES_URL not set)'}`);
  for (const file of FILES) {
    const sql = fs.readFileSync(path.join(__dirname, '../src/db', file), 'utf8');
    await pgPool.query(sql);
    console.log(`✓ ${file}`);
  }
}

main()
  .catch((err) => {
    console.error('✗ Schema apply failed:', err.message);
    process.exitCode = 1;
  })
  .finally(() => pgPool.pool.end());
