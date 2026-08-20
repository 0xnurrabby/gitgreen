// Persistence bridge: restores the SQLite database and encryption key from
// Neon before the app opens them, and periodically snapshots them back so a
// server change never loses state. Nothing is synced when DATABASE_URL is not
// set (plain local mode).

const fs = require('fs');
const path = require('path');
const os = require('os');
const blobstore = require('./blobstore');
const { DATA_DIR, DB_FILE } = require('./config');

const KEY_FILE = path.join(DATA_DIR, '.key');

// Download db + key from Neon before db.js opens the SQLite file.
async function restore() {
  if (!blobstore.available()) return { restored: false, reason: 'no DATABASE_URL' };
  await blobstore.init();
  let restored = false;

  const keyBuf = await blobstore.load('enc-key');
  if (keyBuf) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(KEY_FILE, keyBuf);
    restored = true;
  }

  const dbBuf = await blobstore.load('db');
  if (dbBuf) {
    fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
    fs.writeFileSync(DB_FILE, dbBuf);
    restored = true;
  }

  return { restored, reason: restored ? 'restored from Neon' : 'fresh start (no backup yet)' };
}

// Snapshot the SQLite file (consistent via VACUUM INTO) and the key to Neon.
async function backupNow() {
  if (!blobstore.available()) return false;
  await blobstore.init();

  const tmp = path.join(os.tmpdir(), `gitvibe-${process.pid}-${Date.now()}.db`);
  try {
    const db = require('./db');
    db.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);
    const buf = fs.readFileSync(tmp);
    await blobstore.save('db', buf);
    if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
  } catch (err) {
    console.error('[persist] snapshot failed:', err.message);
    if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    return false;
  }

  if (fs.existsSync(KEY_FILE)) {
    await blobstore.save('enc-key', fs.readFileSync(KEY_FILE));
  }
  return true;
}

// Run a backup a short while after boot, then every intervalMs, plus a final
// backup on SIGTERM/SIGINT so Railway stops never lose recent writes.
function startBackupLoop(intervalMs = 5 * 60 * 1000) {
  if (!blobstore.available()) return;
  setTimeout(() => backupNow().catch((e) => console.error('[persist]', e.message)), 30 * 1000);
  setInterval(() => backupNow().catch((e) => console.error('[persist]', e.message)), intervalMs);

  let shuttingDown = false;
  const skipShutdown = process.env.PERSIST_SKIP_SHUTDOWN_BACKUP === '1';
  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    if (skipShutdown) { process.exit(0); return; }
    backupNow()
      .catch(() => {})
      .finally(() => process.exit(0));
    setTimeout(() => process.exit(0), 15000).unref();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

module.exports = { restore, backupNow, startBackupLoop, KEY_FILE };
