// Tiny key/value blob store on top of the Neon (Postgres) database. Used to
// persist the SQLite database file and the encryption key so they survive any
// server change. If DATABASE_URL is not set the store is a no-op.

const { Pool } = require('pg');

let pool = null;

function available() {
  return !!(process.env.DATABASE_URL || process.env.PGDATABASE_URL);
}

function getPool() {
  if (!available()) return null;
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL || process.env.PGDATABASE_URL,
      max: 2,
      connectionTimeoutMillis: 10000,
      idleTimeoutMillis: 30000
    });
  }
  return pool;
}

async function init() {
  const p = getPool();
  if (!p) return false;
  await p.query(`CREATE TABLE IF NOT EXISTS gitgreen_files (
    key TEXT PRIMARY KEY,
    data BYTEA NOT NULL,
    updated_at BIGINT NOT NULL
  )`);
  return true;
}

async function load(key) {
  const p = getPool();
  if (!p) return null;
  const r = await p.query('SELECT data FROM gitgreen_files WHERE key = $1', [key]);
  return r.rows.length ? r.rows[0].data : null;
}

async function save(key, buffer) {
  const p = getPool();
  if (!p) return;
  await p.query(
    `INSERT INTO gitgreen_files (key, data, updated_at) VALUES ($1, $2, $3)
     ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, updated_at = EXCLUDED.updated_at`,
    [key, buffer, Date.now()]
  );
}

module.exports = { available, init, load, save };
