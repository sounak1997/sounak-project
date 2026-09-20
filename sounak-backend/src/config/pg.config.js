const { Pool, types } = require('pg');

// A bare DATE column is a calendar day with no time and no zone, but
// node-postgres parses it into a JS Date at LOCAL midnight. Serialise that and
// "2026-09-20" leaves as "2026-09-19T18:30:00.000Z" from an IST machine — a
// client reading it as UTC sees the day before. For the gym portal, whose whole
// attendance model is keyed on the calendar day a member trained, that is an
// off-by-one on every date it reports.
//
// So DATE (OID 1082) is handed back as the plain 'YYYY-MM-DD' string Postgres
// sent, which is unambiguous and needs no timezone reasoning at the boundary.
// Safe to set globally: no other schema in this codebase uses a bare DATE
// column (orders, carts and doctor schedules use TIMESTAMPTZ or TIME, which are
// untouched by this).
types.setTypeParser(types.builtins.DATE, (value) => value);

// Create a connection pool using the environment variable
const pool = new Pool({
    connectionString: process.env.POSTGRES_URL,
    ssl: {
        // MUST be set to false for many environments, including Neon on Node.js
        rejectUnauthorized: false 
    }
});

// Test the connection when the module is imported
pool.connect()
    .then(client => {
        console.log('PostgreSQL Connected!');
        client.release(); 
    })
    .catch(err => {
        // Crucial: We need to see this error to diagnose the issue!
        console.error('PostgreSQL Connection Error:', err.message); 
        // Do NOT exit here, as MongoDB is already connected.
    });

module.exports = {
    query: (text, params) => pool.query(text, params),
    pool,
};