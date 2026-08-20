const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');

// Load a .env file (KEY=VALUE lines) into process.env if present.
// Secrets like Privy credentials live here, never in the UI or the database.
function loadDotEnv() {
  const envFile = path.join(ROOT, '.env');
  if (!fs.existsSync(envFile)) return;
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    const key = m[1];
    if (key in process.env) continue; // real env wins over .env
    let value = m[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}
loadDotEnv();

const DATA_DIR = process.env.GITVIBE_DATA_DIR || path.join(ROOT, 'data');
const DB_FILE = path.join(DATA_DIR, 'gitvibe.db');
const WORK_DIR = path.join(DATA_DIR, 'work');

module.exports = {
  ROOT,
  DATA_DIR,
  DB_FILE,
  WORK_DIR,
  PORT: parseInt(process.env.PORT || '3000', 10),
  SESSION_DAYS: 30,
  HOST: process.env.GITVIBE_HOST || `http://localhost:${parseInt(process.env.PORT || '3000', 10)}`,
  APP_BASE_URL: process.env.APP_BASE_URL || process.env.GITVIBE_HOST || `http://localhost:${parseInt(process.env.PORT || '3000', 10)}`,
  DATABASE_URL: process.env.DATABASE_URL || ''
};
