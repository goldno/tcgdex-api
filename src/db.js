const { Pool } = require('pg');

// Single connection pool shared across the whole app.
// DATABASE_URL is provided by Railway when a Postgres service is linked.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

module.exports = pool;
