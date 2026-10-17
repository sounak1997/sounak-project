// src/utils/updateRow.js
//
// "UPDATE <table> SET <the columns given> WHERE id = $1 RETURNING *" for the
// admin edit endpoints, which each change any subset of a record's fields.
//
// Table and column names are interpolated, so they must come from the
// caller's own code (a readFields spec), never from request input — values
// always go through parameters.
//
// Also returns the row as it was BEFORE the write, read in the same statement,
// so a caller can tell what changed (e.g. which photo was replaced and can now
// be deleted) without a second round trip or a race.

/**
 * @returns {Promise<{ row: object, previous: object } | null>} null if no row has that id
 */
async function updateRow(db, table, id, fields) {
  const columns = Object.keys(fields);
  const params = [id, ...columns.map((column) => fields[column])];
  const setClauses = columns.map((column, i) => `${column} = $${i + 2}`);
  setClauses.push('updated_at = now()');

  const result = await db.query(
    `WITH before AS (SELECT * FROM ${table} WHERE id = $1)
     UPDATE ${table} SET ${setClauses.join(', ')}
     WHERE id = $1
     RETURNING ${table}.*, (SELECT row_to_json(before) FROM before) AS __previous`,
    params
  );
  if (!result.rows[0]) return null;

  const { __previous: previous, ...row } = result.rows[0];
  return { row, previous };
}

module.exports = { updateRow };
