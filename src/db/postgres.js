const { Pool } = require('pg');
const { databaseUrl } = require('../config');

const pool = new Pool({ connectionString: databaseUrl, max: 10, idleTimeoutMillis: 30_000 });
pool.on('error', (error) => console.error('Unexpected idle PostgreSQL error:', error.message));

async function query(text, params) {
  return pool.query(text, params);
}

async function closePostgres() {
  await pool.end();
}

module.exports = { pool, query, closePostgres };
