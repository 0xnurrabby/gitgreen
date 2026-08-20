const crypto = require('crypto');
const db = require('./db');
const { encrypt, decrypt, hashPassword, newSalt } = require('./crypto');
const { SESSION_DAYS } = require('./config');

// Admin access is limited to these emails. They log in normally (email OTP),
// then unlock the /admin panel with ADMIN_PASSWORD.
const ADMIN_EMAILS = String(process.env.ADMIN_EMAILS || 'nurrabby01.bd@gmail.com,nurw3b@gmail.com')
  .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Nur1@2@3';

function now() {
  return Date.now();
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function isAdminEmail(email) {
  const e = normalizeEmail(email);
  return e ? ADMIN_EMAILS.includes(e) : false;
}

function createUser(username, password, githubLogin = null, privyDid = null, email = null) {
  const salt = newSalt();
  const hash = (githubLogin || privyDid) ? hashPassword(randomSecret(), salt) : hashPassword(password, salt);
  const info = db.prepare('INSERT INTO users (username, github_login, privy_did, email, password_hash, salt, created_at) VALUES (?,?,?,?,?,?,?)')
    .run(username.toLowerCase(), githubLogin, privyDid, email ? normalizeEmail(email) : null, hash, salt, now());
  const uid = Number(info.lastInsertRowid);
  // A user whose email is on the admin list is an admin from the moment it exists.
  if (isAdminEmail(email)) {
    db.prepare('UPDATE users SET is_admin = 1 WHERE id = ?').run(uid);
  }
  db.prepare('INSERT INTO settings (user_id) VALUES (?)').run(uid);
  return getUser(uid);
}

function getUserByUsername(username) {
  return db.prepare('SELECT * FROM users WHERE username = ?').get(username.toLowerCase()) || null;
}

function getUserByEmail(email) {
  const e = normalizeEmail(email);
  return e ? db.prepare('SELECT * FROM users WHERE email = ?').get(e) || null : null;
}

function getUserByGithub(githubLogin) {
  return db.prepare('SELECT * FROM users WHERE github_login = ?').get(githubLogin) || null;
}

function getUserByPrivy(privyDid) {
  return db.prepare('SELECT * FROM users WHERE privy_did = ?').get(privyDid) || null;
}

// Mark users whose email is on the admin list as admins.
function ensureAdmins() {
  let marked = 0;
  for (const email of ADMIN_EMAILS) {
    const u = getUserByEmail(email);
    if (u && !u.is_admin) {
      db.prepare('UPDATE users SET is_admin = 1 WHERE id = ?').run(u.id);
      marked += 1;
    }
  }
  return marked;
}

function verifyAdminPassword(password) {
  return password === ADMIN_PASSWORD;
}

// Find or create a local user for a verified Privy identity.
function createOrGetUserByPrivy(privyDid, displayName, email = null) {
  let existing = getUserByPrivy(privyDid);
  if (existing) {
    // Link the email if we now have it and the account was created without one.
    if (email && !existing.email) {
      db.prepare('UPDATE users SET email = ? WHERE id = ?').run(normalizeEmail(email), existing.id);
    }
    if (isAdminEmail(email) && !existing.is_admin) {
      db.prepare('UPDATE users SET is_admin = 1 WHERE id = ?').run(existing.id);
    }
    return existing;
  }

  // Reuse an account created with the same email (e.g. older signup).
  const byEmail = email ? getUserByEmail(email) : null;
  if (byEmail) {
    if (!byEmail.privy_did) db.prepare('UPDATE users SET privy_did = ? WHERE id = ?').run(privyDid, byEmail.id);
    if (isAdminEmail(email) && !byEmail.is_admin) db.prepare('UPDATE users SET is_admin = 1 WHERE id = ?').run(byEmail.id);
    return byEmail;
  }

  let base = String(displayName || 'user').toLowerCase().trim().replace(/[^a-z0-9_.-]/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '') || 'user';
  if (base.length > 24) base = base.slice(0, 24);
  let username = base;
  let n = 2;
  while (getUserByUsername(username)) {
    username = base + '-' + n;
    n += 1;
  }
  return createUser(username, null, null, privyDid, email);
}

function randomSecret() {
  return crypto.randomBytes(24).toString('hex');
}

function getUser(id) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id) || null;
}

function verifyPassword(user, password) {
  return hashPassword(password, user.salt) === user.password_hash;
}

function changePassword(userId, newPassword) {
  const salt = newSalt();
  const hash = hashPassword(newPassword, salt);
  db.prepare('UPDATE users SET password_hash = ?, salt = ? WHERE id = ?').run(hash, salt, userId);
}

function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const createdAt = now();
  const expiresAt = createdAt + SESSION_DAYS * 86400000;
  db.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at, admin_authed) VALUES (?,?,?,?,0)')
    .run(token, userId, createdAt, expiresAt);
  return token;
}

function markSessionAdminAuthed(token) {
  db.prepare('UPDATE sessions SET admin_authed = 1 WHERE token = ?').run(token);
}

function sessionRow(token) {
  if (!token) return null;
  const s = db.prepare('SELECT * FROM sessions WHERE token = ?').get(token);
  if (!s) return null;
  if (s.expires_at < now()) {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    return null;
  }
  return s;
}

function getUserBySession(token) {
  const s = sessionRow(token);
  return s ? getUser(s.user_id) : null;
}

function isSessionAdminAuthed(token) {
  const s = sessionRow(token);
  return !!(s && s.admin_authed);
}

function destroySession(token) {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

function logActivity(userId, accountId, projectId, kind, message, ok = 1) {
  db.prepare('INSERT INTO activity_log (user_id, account_id, project_id, kind, message, ok, created_at) VALUES (?,?,?,?,?,?,?)')
    .run(userId, accountId, projectId, kind, message, ok ? 1 : 0, now());
}

module.exports = {
  now,
  ADMIN_EMAILS,
  ADMIN_PASSWORD,
  isAdminEmail,
  verifyAdminPassword,
  createUser,
  getUserByUsername,
  getUserByEmail,
  getUserByGithub,
  getUserByPrivy,
  ensureAdmins,
  createOrGetUserByPrivy,
  getUser,
  verifyPassword,
  changePassword,
  createSession,
  markSessionAdminAuthed,
  sessionRow,
  isSessionAdminAuthed,
  getUserBySession,
  destroySession,
  logActivity
};
