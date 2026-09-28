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
    },
    // Neon closes connections it considers idle, and a laptop that sleeps drops
    // them without telling anyone. Retire our own clients first, and keep the
    // TCP socket probed so a dead one is noticed in seconds rather than at the
    // OS read timeout minutes later.
    idleTimeoutMillis: 30_000,
    keepAlive: true,
    // A connect that hangs should fail the request rather than hold it open
    // forever — but Neon scales to zero, and waking it takes a good few seconds,
    // so this has to be generous enough to survive a cold start. 10s was not:
    // the first connect after an idle spell timed out before the database was
    // awake.
    connectionTimeoutMillis: 30_000,
});

// A dropped IDLE connection must never take the API down with it.
//
// pg-pool emits 'error' on the POOL when a client that is sitting idle fails —
// typically Neon hanging up, or the machine waking from sleep to find the TLS
// socket gone ("read ETIMEDOUT"). An EventEmitter that emits 'error' with no
// listener throws, so without this line the whole server exits: every request
// after that is a 502, which reads at the browser as though login itself is
// broken. The pool discards the dead client and opens a fresh one on the next
// query, so there is nothing to do here but say so and carry on.
pool.on('error', (err) => {
    console.error('[pg] idle client error — discarded, pool will reconnect:', err.message);
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