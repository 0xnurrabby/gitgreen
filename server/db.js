const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');
const { DB_FILE, WORK_DIR } = require('./config');

fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
fs.mkdirSync(WORK_DIR, { recursive: true });

const db = new DatabaseSync(DB_FILE);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA busy_timeout = 5000;');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  github_login TEXT UNIQUE,
  privy_did TEXT UNIQUE,
  password_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  is_admin INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  github_username TEXT NOT NULL,
  token_enc TEXT NOT NULL,
  avatar_url TEXT,
  profile_url TEXT,
  is_active INTEGER DEFAULT 1,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER,
  last_error TEXT
);

CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  account_id INTEGER,
  slug TEXT NOT NULL,
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  stack TEXT NOT NULL,
  description TEXT,
  status TEXT DEFAULT 'ready',
  repo_name TEXT,
  repo_url TEXT,
  default_branch TEXT DEFAULT 'main',
  commits_done INTEGER DEFAULT 0,
  evo_index INTEGER DEFAULT 0,
  work_dir TEXT,
  created_at INTEGER NOT NULL,
  pushed_at INTEGER
);

CREATE TABLE IF NOT EXISTS day_plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  account_id INTEGER NOT NULL,
  plan_date TEXT NOT NULL,
  sessions_json TEXT NOT NULL,
  state_json TEXT,
  UNIQUE(user_id, account_id, plan_date)
);

CREATE TABLE IF NOT EXISTS activity_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  account_id INTEGER,
  project_id INTEGER,
  kind TEXT NOT NULL,
  message TEXT,
  ok INTEGER DEFAULT 1,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  user_id INTEGER PRIMARY KEY,
  active_day_pct INTEGER DEFAULT 100,
  min_commits INTEGER DEFAULT 5,
  max_commits INTEGER DEFAULT 160,
  sessions_per_day INTEGER DEFAULT 3,
  scheduler_enabled INTEGER DEFAULT 1,
  hourly_start INTEGER DEFAULT 9,
  hourly_end INTEGER DEFAULT 23,
  preserve_streak INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS run_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  account_id INTEGER NOT NULL,
  plan_date TEXT NOT NULL,
  batch INTEGER DEFAULT 0,
  scheduled_at INTEGER NOT NULL,
  executed INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS app_config (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL UNIQUE,
  plan_id TEXT NOT NULL DEFAULT 'free',
  account_limit INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'active',
  started_at INTEGER NOT NULL,
  expires_at INTEGER,
  source TEXT DEFAULT 'trial',
  updated_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  order_id TEXT NOT NULL UNIQUE,
  np_payment_id INTEGER,
  plan_id TEXT NOT NULL,
  action TEXT DEFAULT 'purchase',
  amount_usd REAL NOT NULL,
  currency TEXT,
  pay_amount REAL,
  pay_currency TEXT,
  pay_address TEXT,
  status TEXT DEFAULT 'waiting',
  upgrade_from TEXT,
  applied INTEGER DEFAULT 0,
  ipn_payload TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_accounts_user ON accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_projects_user ON projects(user_id);
CREATE INDEX IF NOT EXISTS idx_log_user ON activity_log(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_plans_user ON day_plans(user_id);
CREATE INDEX IF NOT EXISTS idx_run_queue_due ON run_queue(user_id, account_id, plan_date, executed, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_sub_user ON subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_pay_user ON payments(user_id, status);
CREATE INDEX IF NOT EXISTS idx_pay_np ON payments(np_payment_id);
`);

// Migrations for schema changes on existing databases.
function addColumn(table, column, ddl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!cols.includes(column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl};`);
  }
}

// UNIQUE columns cannot be added via ALTER, so rebuild the users table.
function rebuildUsersTable() {
  const oldCols = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
  const adminCol = oldCols.includes('is_admin') ? 'is_admin' : '0 AS is_admin';
  db.exec('BEGIN;');
  db.exec('ALTER TABLE users RENAME TO users_old;');
  db.exec(`CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    github_login TEXT UNIQUE,
    privy_did TEXT UNIQUE,
    email TEXT UNIQUE,
    password_hash TEXT NOT NULL,
    salt TEXT NOT NULL,
    is_admin INTEGER DEFAULT 0,
    created_at INTEGER NOT NULL
  );`);
  db.exec(`INSERT INTO users (id, username, github_login, privy_did, email, password_hash, salt, is_admin, created_at)
    SELECT id, username, github_login, privy_did, NULL, password_hash, salt, ${adminCol}, created_at FROM users_old;`);
  db.exec('DROP TABLE users_old;');
  db.exec('COMMIT;');
}

function ensureUsersTable() {
  const cols = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
  if (cols.includes('github_login') && cols.includes('privy_did') && cols.includes('email')) return;
  rebuildUsersTable();
}

ensureUsersTable();
addColumn('users', 'is_admin', 'INTEGER DEFAULT 0');
addColumn('users', 'email', 'TEXT');
addColumn('accounts', 'is_oauth', 'INTEGER DEFAULT 0');
addColumn('sessions', 'admin_authed', 'INTEGER DEFAULT 0');
addColumn('payments', 'pay_url', 'TEXT');

// v2: every single day gets activity (no skipped days by default).
if (!db.prepare("SELECT value FROM app_config WHERE key = 'v2'").get()) {
  db.prepare('UPDATE settings SET active_day_pct = 100').run();
  db.prepare('DELETE FROM day_plans').run();
  db.prepare("INSERT INTO app_config (key, value) VALUES ('v2', '1') ON CONFLICT(key) DO UPDATE SET value = '1'").run();
}

// v3: commits can scale up to 200/day and repos grow over many days.
if (!db.prepare("SELECT value FROM app_config WHERE key = 'v3'").get()) {
  db.prepare('UPDATE settings SET max_commits = 200').run();
  db.prepare('DELETE FROM day_plans').run();
  db.prepare("INSERT INTO app_config (key, value) VALUES ('v3', '1') ON CONFLICT(key) DO UPDATE SET value = '1'").run();
}

// v4: no more tiny 1-2 commit days; every day gets at least 7.
if (!db.prepare("SELECT value FROM app_config WHERE key = 'v4'").get()) {
  db.prepare('UPDATE settings SET min_commits = 7').run();
  db.prepare('DELETE FROM day_plans').run();
  db.prepare("INSERT INTO app_config (key, value) VALUES ('v4', '1') ON CONFLICT(key) DO UPDATE SET value = '1'").run();
}

// v5: genuinely random daily totals (5-160) instead of a flat ~28/day. Every day
// is a full random day again and old plans are thrown away so they regenerate.
if (!db.prepare("SELECT value FROM app_config WHERE key = 'v5'").get()) {
  db.prepare('UPDATE settings SET min_commits = 5, max_commits = 160, active_day_pct = 100').run();
  db.prepare('DELETE FROM day_plans').run();
  db.prepare('DELETE FROM run_queue').run();
  db.prepare("INSERT INTO app_config (key, value) VALUES ('v5', '1') ON CONFLICT(key) DO UPDATE SET value = '1'").run();
}

// v6: billing/subscriptions. The subscriptions and payments tables are created
// above; existing users get a free trial the first time the billing module
// touches them (see server/billing.js), so no data migration is needed here.
if (!db.prepare("SELECT value FROM app_config WHERE key = 'v6'").get()) {
  db.prepare("INSERT INTO app_config (key, value) VALUES ('v6', '1') ON CONFLICT(key) DO UPDATE SET value = '1'").run();
}

module.exports = db;
