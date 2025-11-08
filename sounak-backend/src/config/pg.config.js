const { Pool } = require('pg');

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