const express = require('express');
const path = require('path');
const fs = require('fs');
const { PORT, ROOT, HOST } = require('./config');
const { todayBDStr, bdDateStr } = require('./timebd');

const app = express();
app.use(express.json({ limit: '2mb', verify: (req, res, buf) => { req.rawBody = buf; } }));
app.use(express.urlencoded({ extended: true }));

async function main() {
  // Restore the SQLite db + encryption key from Neon BEFORE opening them, so a
  // server change resumes exactly where the previous one left off.
  const restoreResult = await require('./persist').restore();
  console.log('[persist]', restoreResult.reason || 'no remote backup');

  const db = require('./db');
  const auth = require('./auth');
  const { encrypt, decrypt } = require('./crypto');
  const github = require('./github');
  const projects = require('./projects');
  const scheduler = require('./scheduler');
  const oauth = require('./oauth');
  const privy = require('./privy');
  const persist = require('./persist');
  const billing = require('./billing');
  const CATALOG = require('../content/catalog');
  // Accounts currently being bulk-pushed, to prevent duplicate concurrent runs.
  const pushAllBusy = new Set();

  auth.ensureAdmins();

  // One-time migration: existing users created before email extraction have a
  // privy_did but no stored email. Fetch each user's email from Privy and link
  // it so the profile and admin panel show the real gmail instead of random
  // auto-generated usernames like "user_cmt00amn".
  async function migrateEmails() {
    const rows = db.prepare('SELECT id, privy_did, email FROM users WHERE privy_did IS NOT NULL AND (email IS NULL OR email = \'\')').all() || [];
    let done = 0;
    for (const u of rows) {
      try {
        const info = await privy.getUserInfo({ userId: u.privy_did, sub: u.privy_did });
        if (info && info.email) {
          db.prepare('UPDATE users SET email = ? WHERE id = ?').run(String(info.email).trim().toLowerCase(), u.id);
          if (auth.isAdminEmail(info.email)) db.prepare('UPDATE users SET is_admin = 1 WHERE id = ?').run(u.id);
          done += 1;
        }
      } catch (e) { /* skip users Privy can't resolve */ }
    }
    if (done > 0) console.log(`[migrate] linked ${done} user email(s) from Privy`);
    return done;
  }
  migrateEmails().catch((e) => console.error('[migrate]', e.message));
  setInterval(() => migrateEmails().catch(() => {}), 10 * 60 * 1000);

  // Session middleware
  function requireUser(req, res, next) {
    const sid = (req.headers.cookie || '').match(/(?:^|;\s*)sid=([^;]+)/);
    const user = sid ? auth.getUserBySession(sid[1]) : null;
    if (!user) return res.status(401).json({ error: 'not_authenticated' });
    req.user = user;
    req.sessionToken = sid ? sid[1] : null;
    next();
  }

  // Admin endpoints need BOTH an admin account and the admin panel password.
  function requireAdmin(req, res, next) {
    requireUser(req, res, () => {
      if (!req.user.is_admin) return res.status(403).json({ error: 'not_admin' });
      if (!auth.isSessionAdminAuthed(req.sessionToken)) {
        return res.status(403).json({ error: 'admin_password_required' });
      }
      next();
    });
  }

  function publicUser(user) {
    let subscription = null;
    try {
      subscription = billing.serializeSub(user.id);
    } catch (e) { /* billing not ready */ }
    return {
      id: user.id,
      username: user.username,
      email: user.email || null,
      created_at: user.created_at,
      is_admin: !!user.is_admin,
      subscription
    };
  }

  // ---------- Auth ----------
  app.post('/api/auth/signup', (req, res) => {
    const { username, password } = req.body || {};
    if (!username || !password) return res.status(400).json({ error: 'username and password required' });
    if (!/^[a-zA-Z0-9_.-]{3,32}$/.test(username)) return res.status(400).json({ error: 'invalid username' });
    if (password.length < 6) return res.status(400).json({ error: 'password must be at least 6 characters' });
    if (auth.getUserByUsername(username)) return res.status(409).json({ error: 'username taken' });
    const user = auth.createUser(username, password);
    const token = auth.createSession(user.id);
    res.cookie('sid', token, { httpOnly: true, maxAge: 30 * 86400000, sameSite: 'lax' });
    res.json({ user: publicUser(user) });
  });

  app.post('/api/auth/login', (req, res) => {
    const { username, password } = req.body || {};
    const user = username ? auth.getUserByUsername(username) : null;
    if (!user || !auth.verifyPassword(user, password)) return res.status(401).json({ error: 'invalid credentials' });
    const token = auth.createSession(user.id);
    res.cookie('sid', token, { httpOnly: true, maxAge: 30 * 86400000, sameSite: 'lax' });
    res.json({ user: publicUser(user) });
  });

  app.post('/api/auth/logout', (req, res) => {
    const sid = (req.headers.cookie || '').match(/(?:^|;\s*)sid=([^;]+)/);
    if (sid) auth.destroySession(sid[1]);
    res.clearCookie('sid');
    res.json({ ok: true });
  });

  app.get('/api/auth/me', requireUser, (req, res) => {
    res.json({ user: publicUser(req.user) });
  });

  app.post('/api/auth/change-password', requireUser, (req, res) => {
    const { current, next } = req.body || {};
    if (!auth.verifyPassword(req.user, current)) return res.status(401).json({ error: 'current password is wrong' });
    if (!next || String(next).length < 6) return res.status(400).json({ error: 'new password too short' });
    auth.changePassword(req.user.id, next);
    res.json({ ok: true });
  });

  // ---------- Privy auth ----------
  app.get('/api/privy/config', (req, res) => {
    const cfg = privy.getConfig();
    res.json({ configured: cfg.configured, appId: cfg.appId || null, clientId: cfg.clientId || null });
  });

  app.post('/api/auth/privy', async (req, res) => {
    const { token } = req.body || {};
    if (!token) return res.status(400).json({ error: 'missing token' });
    try {
      const claims = await privy.verifyToken(token);
      const info = await privy.getUserInfo(claims);
      const user = auth.createOrGetUserByPrivy(info.did, info.displayName, info.email);
      const sid = auth.createSession(user.id);
      res.cookie('sid', sid, { httpOnly: true, maxAge: 30 * 86400000, sameSite: 'lax' });
      auth.logActivity(user.id, null, null, 'auth', `Signed in via email (${info.email || info.displayName})`, 1);
      res.json({ user: publicUser(user) });
    } catch (err) {
      res.status(401).json({ error: 'invalid privy token: ' + err.message });
    }
  });

  // ---------- GitHub OAuth (legacy, kept for reference) ----------
  app.get('/api/oauth/status', (req, res) => {
    const cfg = oauth.getConfig();
    res.json({ configured: cfg.configured, clientId: cfg.clientId || null, redirectUri: oauth.redirectUri() });
  });

  app.post('/api/oauth/config', requireUser, (req, res) => {
    const { clientId, clientSecret } = req.body || {};
    if (!clientId || !clientSecret) return res.status(400).json({ error: 'client id and client secret required' });
    oauth.saveConfig(clientId, clientSecret);
    res.json({ ok: true, configured: true, redirectUri: oauth.redirectUri() });
  });

  app.get('/api/auth/github', (req, res) => {
    const cfg = oauth.getConfig();
    if (!cfg.configured) return res.status(400).json({ error: 'not_configured', redirectUri: oauth.redirectUri() });
    const state = oauth.newState();
    res.cookie('oauth_state', state, { httpOnly: true, maxAge: 600000, sameSite: 'lax' });
    res.redirect(oauth.buildAuthorizeUrl(state));
  });

  app.get('/api/auth/github/callback', async (req, res) => {
    const cookie = (req.headers.cookie || '').match(/(?:^|;\s*)oauth_state=([^;]+)/);
    const { code, state, error } = req.query;
    if (error) {
      res.clearCookie('oauth_state');
      return res.redirect('/?auth_error=denied');
    }
    if (!code || !state || !cookie || state !== cookie[1]) {
      res.clearCookie('oauth_state');
      return res.redirect('/?auth_error=invalid_state');
    }
    res.clearCookie('oauth_state');
    try {
      const token = await oauth.exchangeCode(code);
      const info = await github.getUser(token);
      let user = auth.getUserByGithub(info.login);
      if (!user) {
        user = auth.createUser(info.login, null, info.login);
      }
      const existing = db.prepare('SELECT * FROM accounts WHERE user_id = ? AND github_username = ?').get(user.id, info.login);
      if (existing) {
        const enc = encrypt(token);
        db.prepare('UPDATE accounts SET token_enc = ?, is_oauth = 1, avatar_url = ?, profile_url = ?, is_active = 1, last_error = NULL WHERE id = ?')
          .run(enc, info.avatar_url, info.profile_url, existing.id);
        scheduler.ensurePlans(user.id, existing.id, 14);
      } else {
        const limit = billing.activeAccountLimit(user.id);
        const used = db.prepare('SELECT COUNT(*) AS n FROM accounts WHERE user_id = ?').get(user.id).n;
        if (used >= limit) {
          auth.logActivity(user.id, null, null, 'error', `OAuth connect blocked: account limit (${limit}) reached`, 0);
          return res.redirect('/?auth_error=limit_reached');
        }
        const r2 = db.prepare('INSERT INTO accounts (user_id, github_username, token_enc, avatar_url, profile_url, is_oauth, is_active, created_at) VALUES (?,?,?,?,?,?,?,?)')
          .run(user.id, info.login, enc, info.avatar_url, info.profile_url, 1, 1, auth.now());
        scheduler.ensurePlans(user.id, Number(r2.lastInsertRowid), 14);
      }
      auth.logActivity(user.id, null, null, 'auth', `Signed in with GitHub @${info.login}`, 1);
      const sid = auth.createSession(user.id);
      res.cookie('sid', sid, { httpOnly: true, maxAge: 30 * 86400000, sameSite: 'lax' });
      res.redirect('/');
    } catch (err) {
      res.redirect('/?auth_error=' + encodeURIComponent(err.message.slice(0, 80)));
    }
  });

  // ---------- GitHub accounts ----------
  app.get('/api/accounts', requireUser, (req, res) => {
    const rows = db.prepare('SELECT * FROM accounts WHERE user_id = ? ORDER BY created_at DESC').all(req.user.id) || [];
    res.json(rows.map((a) => {
      let settings = {};
      try { settings = a.settings_json ? JSON.parse(a.settings_json) : {}; } catch (e) { settings = {}; }
      return { ...a, token_enc: undefined, settings };
    }));
  });

  app.post('/api/accounts', requireUser, async (req, res) => {
    const { token } = req.body || {};
    if (!token || !/^[A-Za-z0-9_]{10,}$/.test(token)) return res.status(400).json({ error: 'enter a valid GitHub personal access token' });
    // Enforce the subscription's account limit before connecting a new account.
    const limit = billing.activeAccountLimit(req.user.id);
    const used = db.prepare('SELECT COUNT(*) AS n FROM accounts WHERE user_id = ?').get(req.user.id).n;
    if (used >= limit) {
      const sub = billing.getSubscription(req.user.id);
      return res.status(402).json({
        error: sub.status === 'active' ? `You've reached the ${sub.plan.name} limit of ${limit} account${limit === 1 ? '' : 's'}. Upgrade your plan to connect more.` : 'Your subscription has expired. Renew a plan to keep using GitGreen.',
        code: 'limit_reached',
        subscription: billing.serializeSub(req.user.id)
      });
    }
    try {
      const info = await github.getUser(token);
      const existing = db.prepare('SELECT * FROM accounts WHERE user_id = ? AND github_username = ?').get(req.user.id, info.login);
      if (existing) return res.status(409).json({ error: `${info.login} is already connected` });
      // Prevent the same GitHub account being used across multiple GitGreen
      // accounts, so one GitHub account is never connected to two users.
      const elsewhere = db.prepare('SELECT a.id, u.email, u.username FROM accounts a JOIN users u ON u.id = a.user_id WHERE a.github_username = ?').get(info.login);
      if (elsewhere) {
        return res.status(409).json({
          error: `${info.login} is already connected to another GitGreen account${elsewhere.email ? ` (${elsewhere.email})` : ` (@${elsewhere.username})`}. Remove it there first, or ask an admin to move it.`,
          code: 'account_in_use',
          owner: { email: elsewhere.email, username: elsewhere.username }
        });
      }
      const enc = encrypt(token);
      const res2 = db.prepare('INSERT INTO accounts (user_id, github_username, token_enc, avatar_url, profile_url, created_at) VALUES (?,?,?,?,?,?)')
        .run(req.user.id, info.login, enc, info.avatar_url, info.profile_url, auth.now());
      scheduler.ensurePlans(req.user.id, Number(res2.lastInsertRowid), 14);
      auth.logActivity(req.user.id, Number(res2.lastInsertRowid), null, 'account', `Connected GitHub account @${info.login}`, 1);
      res.json({ ok: true, id: Number(res2.lastInsertRowid) });
    } catch (err) {
      res.status(400).json({ error: `GitHub rejected the token: ${err.message}` });
    }
  });

  // Check a token before connecting: report the GitHub user and which scopes
  // the token allows, so the user can confirm before committing. Note that
  // GitHub only reports scopes for classic tokens; fine-grained tokens return
  // an empty x-oauth-scopes header even though they may have full access.
  app.post('/api/accounts/check', requireUser, async (req, res) => {
    const { token } = req.body || {};
    if (!token || !/^[A-Za-z0-9_]{10,}$/.test(token)) return res.status(400).json({ error: 'enter a valid GitHub personal access token' });
    try {
      const info = await github.checkToken(token);
      const scopes = info.scopes || [];
      const scopesReported = scopes.length > 0;
      // "public_repo" also lets us push to public repos (GitGreen creates
      // public repos by default), so treat it as sufficient.
      const hasRepo = scopes.includes('repo') || scopes.includes('public_repo');
      const hasWorkflow = scopes.includes('workflow');
      // If scopes are not reported (fine-grained token), we cannot verify from
      // the header, so do not block the connection.
      const canPush = !scopesReported || hasRepo;
      let warning = null;
      if (!scopesReported) {
        warning = 'GitHub does not report scopes for this token type. Connect and run a test to confirm it has repo access.';
      } else if (!hasRepo) {
        warning = 'This token cannot push. Tick the "repo" scope and regenerate.';
      } else if (!hasWorkflow) {
        warning = 'Tip: add the "workflow" scope to avoid push errors on repos with GitHub Actions.';
      }
      res.json({
        ok: true,
        login: info.login,
        avatar_url: info.avatar_url,
        profile_url: info.profile_url,
        scopes,
        scopesReported,
        hasRepo,
        hasWorkflow,
        canPush,
        warning
      });
    } catch (err) {
      res.status(400).json({ error: `Could not check this token: ${err.message}` });
    }
  });

  app.delete('/api/accounts/:id', requireUser, (req, res) => {
    const account = db.prepare('SELECT * FROM accounts WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (!account) return res.status(404).json({ error: 'not found' });
    db.prepare('DELETE FROM accounts WHERE id = ?').run(account.id);
    res.json({ ok: true });
  });

  app.post('/api/accounts/:id/activate', requireUser, (req, res) => {
    const account = db.prepare('SELECT * FROM accounts WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (!account) return res.status(404).json({ error: 'not found' });
    const active = req.body?.active ? 1 : 0;
    db.prepare('UPDATE accounts SET is_active = ? WHERE id = ?').run(active, account.id);
    res.json({ ok: true });
  });

  // Per-account settings (commit range, sessions, active hours). Merged over
  // the user's global settings by the scheduler.
  app.put('/api/accounts/:id/settings', requireUser, (req, res) => {
    const account = db.prepare('SELECT * FROM accounts WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (!account) return res.status(404).json({ error: 'not found' });
    const b = req.body || {};
    const cur = (() => { try { return JSON.parse(account.settings_json || '{}'); } catch (e) { return {}; } })();
    ['min_commits', 'max_commits', 'sessions_per_day', 'active_day_pct', 'hourly_start', 'hourly_end', 'scheduler_enabled'].forEach((k) => {
      if (b[k] !== undefined && b[k] !== null && b[k] !== '') cur[k] = Number(b[k]);
    });
    db.prepare('UPDATE accounts SET settings_json = ? WHERE id = ?').run(JSON.stringify(cur), account.id);
    // Regenerate that account's plans so the new pacing takes effect today.
    try { scheduler.ensurePlans(req.user.id, account.id, 14); } catch (e) {}
    res.json({ ok: true, settings: cur });
  });

  // Bulk pause/resume for a set of accounts (e.g. dashboard "turn off all").
  app.post('/api/accounts/set-active', requireUser, (req, res) => {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).filter(Boolean) : [];
    const active = req.body?.active ? 1 : 0;
    if (ids.length === 0) return res.status(400).json({ error: 'no accounts selected' });
    const owned = new Set((db.prepare('SELECT id FROM accounts WHERE user_id = ?').all(req.user.id) || []).map((a) => a.id));
    const valid = ids.filter((id) => owned.has(id));
    if (valid.length === 0) return res.status(404).json({ error: 'no matching accounts' });
    const ph = valid.map(() => '?').join(',');
    db.prepare(`UPDATE accounts SET is_active = ? WHERE id IN (${ph})`).run(active, ...valid);
    res.json({ ok: true, updated: valid.length });
  });

  // ---------- Catalog & projects ----------
  app.get('/api/catalog', requireUser, (req, res) => {
    const accountId = req.query.accountId ? Number(req.query.accountId) : null;
    const pushed = new Set((accountId
      ? db.prepare('SELECT slug FROM projects WHERE user_id = ? AND account_id = ?').all(req.user.id, accountId)
      : db.prepare('SELECT slug FROM projects WHERE user_id = ?').all(req.user.id)
    ).map((r) => r.slug));
    const list = CATALOG.map((c) => ({ id: c.id, title: c.title, category: c.category, stack: c.stack, blurb: c.blurb, pushed: pushed.has(c.slug) }));
    res.json(list);
  });

  app.get('/api/projects', requireUser, (req, res) => {
    const accountId = req.query.accountId ? Number(req.query.accountId) : null;
    const rows = accountId
      ? db.prepare('SELECT * FROM projects WHERE user_id = ? AND account_id = ? ORDER BY pushed_at DESC, id DESC LIMIT 400').all(req.user.id, accountId) || []
      : db.prepare('SELECT * FROM projects WHERE user_id = ? ORDER BY pushed_at DESC, id DESC LIMIT 400').all(req.user.id) || [];
    res.json(rows);
  });

  // ---------- Push all repos ----------
  // One-click bulk push: every catalog project that is not yet on the selected
  // account is created and pushed. This bypasses the daily autopilot pacing
  // (which spreads repos across days) so the user can build up a library in one
  // go when they want to. Once done, the account keeps evolving normally.
  app.get('/api/push-all/status', requireUser, (req, res) => {
    const accountId = Number(req.query.accountId) || null;
    const total = CATALOG.length;
    if (!accountId) return res.json({ total, pushed: 0, remaining: total, account: null });
    const account = db.prepare('SELECT * FROM accounts WHERE id = ? AND user_id = ?').get(accountId, req.user.id);
    if (!account) return res.status(404).json({ error: 'account not found' });
    const pushed = db.prepare('SELECT COUNT(*) AS n FROM projects WHERE user_id = ? AND account_id = ?').get(req.user.id, account.id).n || 0;
    res.json({
      total,
      pushed,
      remaining: Math.max(0, total - pushed),
      account: account.github_username,
      inFlight: pushAllBusy.has(account.id)
    });
  });

  // Push the next batch (up to `batch`, default 6) of catalog projects that are
  // not yet on the selected account. Returns progress + per-repo results.
  app.post('/api/push-all', requireUser, async (req, res) => {
    const accountId = Number(req.body?.accountId) || null;
    const batch = Math.max(1, Math.min(10, Number(req.body?.batch) || 6));
    const account = accountId
      ? db.prepare('SELECT * FROM accounts WHERE id = ? AND user_id = ?').get(accountId, req.user.id)
      : null;
    if (!account || !accountId) return res.status(404).json({ error: 'account not found' });
    if (pushAllBusy.has(account.id)) return res.status(409).json({ error: 'A push is already running for this account.' });

    const token = (() => { try { return decrypt(account.token_enc); } catch (e) { return null; } })();
    if (!token) return res.status(400).json({ error: 'this account has no usable token' });

    // Which catalog projects already exist for this account.
    const pushedSlugs = new Set(
      (db.prepare('SELECT slug FROM projects WHERE user_id = ? AND account_id = ?').all(req.user.id, account.id) || []).map((r) => r.slug)
    );
    const remaining = CATALOG.filter((c) => !pushedSlugs.has(c.slug)).slice(0, batch);
    if (remaining.length === 0) {
      const total = CATALOG.length;
      const pushed = pushedSlugs.size;
      return res.json({ ok: true, done: true, pushed, remaining: Math.max(0, total - pushed), total });
    }

    pushAllBusy.add(account.id);
    const results = [];
    try {
      const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
      for (const cat of remaining) {
        try {
          // Skip repos that already exist on GitHub under this account but were
          // not recorded locally (rare duplicate-safety).
          if (await github.repoExists(token, account.github_username, cat.slug)) {
            // Record it so the count advances without re-creating it.
            const info = db.prepare(`
              INSERT INTO projects (user_id, account_id, slug, title, category, stack, description, status, repo_name, repo_url, default_branch, commits_done, evo_index, work_dir, created_at, pushed_at)
              VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
              ON CONFLICT DO NOTHING
            `).run(req.user.id, account.id, cat.slug, cat.title, cat.category, cat.stack, cat.blurb,
              'pushed', cat.slug, `https://github.com/${account.github_username}/${cat.slug}`, 'main', 1, 0, null, auth.now(), auth.now());
            results.push({ slug: cat.slug, status: 'recorded' });
            continue;
          }
          await projects.createProject(user, account, cat, new Date());
          results.push({ slug: cat.slug, status: 'pushed' });
        } catch (err) {
          results.push({ slug: cat.slug, status: 'failed', error: String(err.message).slice(0, 200) });
        }
        // Small delay so a big batch still looks human and doesn't hammer the API.
        await new Promise((r) => setTimeout(r, 350));
      }
    } finally {
      pushAllBusy.delete(account.id);
    }

    const pushedNow = db.prepare('SELECT COUNT(*) AS n FROM projects WHERE user_id = ? AND account_id = ?').get(req.user.id, account.id).n || 0;
    const total = CATALOG.length;
    res.json({ ok: true, done: false, pushed: pushedNow, remaining: Math.max(0, total - pushedNow), total, results });
  });

  // ---------- Stats & logs ----------
  app.get('/api/stats', requireUser, (req, res) => {
    const uid = req.user.id;
    const accountId = req.query.accountId ? Number(req.query.accountId) : null;
    const accounts = db.prepare('SELECT * FROM accounts WHERE user_id = ?').all(uid) || [];
    const acc = accountId ? accounts.find((a) => a.id === accountId) : null;

    const totalCommits = acc
      ? db.prepare('SELECT COALESCE(SUM(commits_done),0) AS n FROM projects WHERE user_id = ? AND account_id = ?').get(uid, acc.id).n
      : db.prepare('SELECT COALESCE(SUM(commits_done),0) AS n FROM projects WHERE user_id = ?').get(uid).n;
    const totalRepos = acc
      ? db.prepare('SELECT COUNT(*) AS n FROM projects WHERE user_id = ? AND account_id = ?').get(uid, acc.id).n
      : db.prepare('SELECT COUNT(*) AS n FROM projects WHERE user_id = ?').get(uid).n;
    const totalLogs = db.prepare('SELECT COUNT(*) AS n FROM activity_log WHERE user_id = ? AND kind != ?').get(uid, 'account').n;

    // Commit counts bucketed by Bangladesh day (UTC+6), matching the scheduler.
    // When an account is selected the grid shows only that account's activity.
    const commits = acc
      ? db.prepare(
          `SELECT DATE((created_at/1000) + 21600, 'unixepoch') AS day, COUNT(*) AS n FROM activity_log
           WHERE user_id = ? AND account_id = ? AND kind IN ('create','evolve')
           GROUP BY day`
        ).all(uid, acc.id) || []
      : db.prepare(
          `SELECT DATE((created_at/1000) + 21600, 'unixepoch') AS day, COUNT(*) AS n FROM activity_log
           WHERE user_id = ? AND kind IN ('create','evolve')
           GROUP BY day`
        ).all(uid) || [];
    const byDay = {};
    for (const c of commits) byDay[c.day] = c.n;

    // current streak (from the same account-scoped history)
    let streak = 0;
    const d = new Date();
    for (let i = 0; i < 730; i++) {
      const day = bdDateStr(d);
      if (byDay[day] > 0) streak += 1;
      else if (i > 0) break;
      d.setUTCDate(d.getUTCDate() - 1);
    }

    // upcoming 14-day plan summary (scoped to the account when one is selected)
    const planRows = acc
      ? db.prepare('SELECT * FROM day_plans WHERE user_id = ? AND account_id = ? AND plan_date >= ? ORDER BY plan_date LIMIT 14').all(uid, acc.id, todayBDStr()) || []
      : db.prepare('SELECT * FROM day_plans WHERE user_id = ? AND plan_date >= ? ORDER BY plan_date LIMIT 14').all(uid, todayBDStr()) || [];
    const planned = planRows.map((p) => {
      let sessions = [];
      try { sessions = JSON.parse(p.sessions_json); } catch (e) { sessions = []; }
      let state = {};
      try { state = JSON.parse(p.state_json || '{}'); } catch (e) { state = {}; }
      return {
        date: p.plan_date,
        account_id: p.account_id,
        commits: sessions.reduce((s, x) => s + (x.commits ? x.commits.length : 0), 0),
        done: !!state.done
      };
    });

    res.json({ accounts, totalCommits, totalRepos, totalLogs, byDay, streak, planned, schedulerOn: true, selectedAccount: acc ? acc.github_username : null });
  });

  app.get('/api/logs', requireUser, (req, res) => {
    const rows = db.prepare(
      'SELECT * FROM activity_log WHERE user_id = ? AND ok = 1 ORDER BY id DESC LIMIT 60'
    ).all(req.user.id) || [];
    const accNames = new Map((db.prepare('SELECT id, github_username FROM accounts').all() || []).map((a) => [a.id, a.github_username]));
    res.json(rows.map((r) => ({ ...r, account_name: accNames.get(r.account_id) || null })));
  });

  // Account health: per-account running totals of recent failures and last error,
  // shown on the account card instead of cluttering the activity feed.
  app.get('/api/accounts/health', requireUser, (req, res) => {
    const accounts = db.prepare('SELECT id, github_username, last_error FROM accounts WHERE user_id = ?').all(req.user.id) || [];
    const ids = accounts.map((a) => a.id);
    const health = {};
    if (ids.length) {
      const ph = ids.map(() => '?').join(',');
      const fails = db.prepare(
        `SELECT account_id, COUNT(*) AS n FROM activity_log
         WHERE user_id = ? AND account_id IN (${ph}) AND ok = 0 AND created_at >= ?
         GROUP BY account_id`
      ).all(req.user.id, ...ids, Date.now() - 24 * 3600000) || [];
      fails.forEach((f) => { health[f.account_id] = { errorsToday: f.n }; });
    }
    res.json(accounts.map((a) => ({ id: a.id, github_username: a.github_username, last_error: a.last_error, errorsToday: (health[a.id] || {}).errorsToday || 0 })));
  });

  // ---------- Scheduler & settings ----------
  app.get('/api/plans', requireUser, (req, res) => {
    const accountId = req.query.accountId ? Number(req.query.accountId) : null;
    const rows = accountId
      ? db.prepare('SELECT * FROM day_plans WHERE user_id = ? AND account_id = ? ORDER BY plan_date LIMIT 14').all(req.user.id, accountId) || []
      : db.prepare('SELECT * FROM day_plans WHERE user_id = ? ORDER BY plan_date LIMIT 14').all(req.user.id) || [];
    const accNames = new Map((db.prepare('SELECT id, github_username FROM accounts').all() || []).map((a) => [a.id, a.github_username]));
    res.json(rows.map((p) => {
      let sessions = [];
      try { sessions = JSON.parse(p.sessions_json); } catch (e) { sessions = []; }
      return { date: p.plan_date, account_id: p.account_id, account: accNames.get(p.account_id) || null, sessions };
    }));
  });

  app.post('/api/run-now', requireUser, async (req, res) => {
    const { accountId, commits } = req.body || {};
    const accounts = accountId
      ? [{ id: Number(accountId) }]
      : (db.prepare('SELECT id FROM accounts WHERE user_id = ? AND is_active = 1').all(req.user.id) || []);
    if (accounts.length === 0) return res.status(400).json({ error: accountId ? 'account not found' : 'no active accounts' });
    try {
      let done = 0;
      for (const a of accounts) {
        done += await scheduler.runNow(req.user.id, Number(a.id), commits ? Number(commits) : null);
      }
      res.json({ ok: true, commits: done, accounts: accounts.length });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // "Run today's task": queue today's full planned activity as 1-3 batches
  // spread across the day (commits 2-5 minutes apart), then let the scheduler
  // execute them one by one so it never looks like a bot burst.
  app.post('/api/run-today', requireUser, async (req, res) => {
    const { accountId } = req.body || {};
    const accounts = accountId
      ? [{ id: Number(accountId) }]
      : (db.prepare('SELECT id FROM accounts WHERE user_id = ? AND is_active = 1').all(req.user.id) || []);
    if (accounts.length === 0) return res.status(400).json({ error: accountId ? 'account not found' : 'no active accounts' });
    try {
      let total = 0, inserted = 0, batches = 0, firstAt = null, lastAt = null;
      for (const a of accounts) {
        const r = await scheduler.runToday(req.user.id, Number(a.id));
        total += r.total;
        inserted += r.inserted;
        batches += r.batches;
        if (r.firstAt && (firstAt === null || r.firstAt < firstAt)) firstAt = r.firstAt;
        if (r.lastAt && (lastAt === null || r.lastAt > lastAt)) lastAt = r.lastAt;
      }
      res.json({ ok: true, total, inserted, batches, firstAt, lastAt, accounts: accounts.length });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Estimated time of the next commit for an account. The client uses this once
  // and counts down locally, so there is no polling pressure on the server.
  // "pending" is how many queued commits are still waiting to be executed, so
  // the UI can show progress instead of getting stuck on "running".
  app.get('/api/next-commit', requireUser, (req, res) => {
    const accountId = req.query.accountId ? Number(req.query.accountId) : null;
    const today = todayBDStr();
    if (accountId) {
      const account = db.prepare('SELECT * FROM accounts WHERE id = ? AND user_id = ?').get(accountId, req.user.id);
      if (!account) return res.status(400).json({ error: 'account not found' });
      const pending = db.prepare('SELECT COUNT(*) AS n FROM run_queue WHERE user_id = ? AND account_id = ? AND plan_date = ? AND executed = 0').get(req.user.id, account.id, today).n;
      return res.json({ scheduledAt: scheduler.nextCommitAt(req.user.id, account.id), pending, serverTime: Date.now() });
    }
    // "All accounts" view: the earliest commit across every account.
    const accounts = db.prepare('SELECT * FROM accounts WHERE user_id = ?').all(req.user.id) || [];
    let best = null;
    let pending = 0;
    for (const a of accounts) {
      pending += db.prepare('SELECT COUNT(*) AS n FROM run_queue WHERE user_id = ? AND account_id = ? AND plan_date = ? AND executed = 0').get(req.user.id, a.id, today).n;
      const t = scheduler.nextCommitAt(req.user.id, a.id);
      if (t && (best === null || t < best)) best = t;
    }
    res.json({ scheduledAt: best, pending, serverTime: Date.now() });
  });

  app.post('/api/regenerate-plans', requireUser, (req, res) => {
    const accounts = db.prepare('SELECT * FROM accounts WHERE user_id = ?').all(req.user.id) || [];
    for (const a of accounts) {
      db.prepare('DELETE FROM day_plans WHERE user_id = ? AND account_id = ?').run(req.user.id, a.id);
      db.prepare('DELETE FROM run_queue WHERE user_id = ? AND account_id = ? AND plan_date = ?').run(req.user.id, a.id, todayBDStr());
      scheduler.ensurePlans(req.user.id, a.id, 14);
    }
    res.json({ ok: true });
  });

  app.get('/api/settings', requireUser, (req, res) => {
    const s = db.prepare('SELECT * FROM settings WHERE user_id = ?').get(req.user.id) || {};
    res.json(s);
  });

  app.post('/api/settings', requireUser, (req, res) => {
    const s = db.prepare('SELECT * FROM settings WHERE user_id = ?').get(req.user.id) || {};
    const fields = ['active_day_pct', 'min_commits', 'max_commits', 'sessions_per_day', 'hourly_start', 'hourly_end'];
    const next = { ...s, ...req.body };
    for (const f of fields) {
      const v = Number(req.body[f]);
      if (!Number.isNaN(v)) next[f] = Math.max(1, Math.min(100, Math.round(v)));
    }
    next.preserve_streak = req.body.preserve_streak ? 1 : 0;
    next.scheduler_enabled = req.body.scheduler_enabled ? 1 : 0;
    db.prepare('UPDATE settings SET active_day_pct=?, min_commits=?, max_commits=?, sessions_per_day=?, hourly_start=?, hourly_end=?, preserve_streak=?, scheduler_enabled=? WHERE user_id=?')
      .run(next.active_day_pct, next.min_commits, next.max_commits, next.sessions_per_day, next.hourly_start, next.hourly_end, next.preserve_streak, next.scheduler_enabled, req.user.id);
    res.json(next);
  });

  // ---------- Billing & subscriptions ----------
  app.get('/api/billing/plans', (req, res) => {
    res.json({ plans: billing.PLANS, configured: billing.configured() });
  });

  app.get('/api/billing/subscription', requireUser, (req, res) => {
    res.json({ subscription: billing.serializeSub(req.user.id), plans: billing.PLANS, configured: billing.configured() });
  });

// How much a plan costs right now for this user (full price, upgrade
  // difference, or free switch). Lets the UI show the price before checkout.
  app.get('/api/billing/quote', requireUser, (req, res) => {
    const { planId } = req.query;
    if (!planId) return res.status(400).json({ error: 'planId required' });
    try {
      const plan = billing.getPlan(String(planId));
      if (!plan) return res.status(400).json({ error: 'unknown plan' });
      const { amount, action, upgradeFrom, keepExpiry } = billing.computeAmount(req.user.id, String(planId));
      res.json({ plan: { id: plan.id, name: plan.name, accounts: plan.accounts, price: plan.price, tagline: plan.tagline, popular: plan.popular }, amount, action, upgradeFrom, keepExpiry, subscription: billing.serializeSub(req.user.id) });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // Create a payment order for a plan. Upgrade = pay the difference and keep
  // the current expiry; purchase = full price for a fresh 30 days. Returns the
  // OxaPay payment_url the customer is redirected to.
  app.post('/api/billing/payment', requireUser, async (req, res) => {
    const { planId } = req.body || {};
    if (!planId) return res.status(400).json({ error: 'planId required' });
    try {
      const result = await billing.createPayment(req.user.id, String(planId));
      if (result.applied) {
        auth.logActivity(req.user.id, null, null, 'billing', `Switched to ${result.plan.name} plan`, 1);
        return res.json({ applied: true, amount: result.amount, action: result.action, upgradeFrom: result.upgradeFrom, plan: result.plan, subscription: billing.serializeSub(req.user.id) });
      }
      const order = result.order;
      res.json({
        applied: false,
        amount: result.amount,
        action: result.action,
        upgradeFrom: result.upgradeFrom,
        plan: result.plan,
        order: {
          order_id: order.order_id,
          track_id: order.np_payment_id,
          payment_url: order.pay_url,
          status: order.status,
          created_at: order.created_at
        }
      });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // Poll the status of an order (also re-queries OxaPay so the plan activates
  // even if the user never comes back to the site after paying).
  app.get('/api/billing/payment/:orderId', requireUser, async (req, res) => {
    const order = db.prepare('SELECT * FROM payments WHERE order_id = ? AND user_id = ?').get(req.params.orderId, req.user.id);
    if (!order) return res.status(404).json({ error: 'order not found' });
    try {
      const updated = await billing.syncOrder(order.order_id);
      res.json({
        status: updated.status,
        applied: !!updated.applied,
        amount: updated.amount_usd,
        plan_id: updated.plan_id,
        action: updated.action,
        payment_url: updated.pay_url,
        subscription: billing.serializeSub(req.user.id)
      });
    } catch (err) {
      res.json({ status: order.status, applied: !!order.applied, amount: order.amount_usd, error: err.message });
    }
  });

  // OxaPay webhook. Configure this URL in the OxaPay dashboard (and it is also
  // sent per-invoice as callback_url): <APP_BASE_URL>/api/billing/ipn
  app.post('/api/billing/ipn', async (req, res) => {
    try {
      await billing.handleIpn(req.rawBody, req.headers.hmac, req.body || {});
      res.type('text/plain').send('OK');
    } catch (err) {
      // Never retry-loop: bad signatures/unknown orders are logged instead.
      if (err.message === 'bad hmac signature') console.warn('[ipn] rejected bad hmac signature');
      res.status(400).type('text/plain').send('ERROR');
    }
  });

  // ---------- Admin ----------
  app.get('/api/admin/me', requireUser, (req, res) => {
    if (!req.user.is_admin) return res.status(403).json({ error: 'not_admin' });
    const authed = auth.isSessionAdminAuthed(req.sessionToken);
    res.json({ admin: true, needPassword: !authed, user: publicUser(req.user) });
  });

  // Unlock the admin panel with the admin password. Only works for admin users.
  app.post('/api/admin/login', requireUser, (req, res) => {
    if (!req.user.is_admin) return res.status(403).json({ error: 'not_admin' });
    const { password } = req.body || {};
    if (!auth.verifyAdminPassword(password || '')) return res.status(401).json({ error: 'wrong password' });
    auth.markSessionAdminAuthed(req.sessionToken);
    res.json({ ok: true, user: publicUser(req.user) });
  });

  app.get('/api/admin/overview', requireAdmin, (req, res) => {
    const users = db.prepare(`
      SELECT u.id, u.username, u.email, u.github_login, u.privy_did, u.is_admin, u.created_at,
        (SELECT COUNT(*) FROM accounts a WHERE a.user_id = u.id) AS accounts_n,
        (SELECT COUNT(*) FROM projects p WHERE p.user_id = u.id) AS repos_n,
        (SELECT COALESCE(SUM(p.commits_done),0) FROM projects p WHERE p.user_id = u.id) AS commits_n,
        (SELECT COUNT(*) FROM activity_log l WHERE l.user_id = u.id) AS logs_n,
        (SELECT MAX(created_at) FROM activity_log l WHERE l.user_id = u.id) AS last_active,
        (SELECT COUNT(*) FROM day_plans p WHERE p.user_id = u.id AND p.plan_date = ? AND (p.state_json LIKE '%"done":true%')) AS today_done
      FROM users u ORDER BY u.id
    `).all(todayBDStr()) || [];
    const settings = new Map((db.prepare('SELECT user_id, scheduler_enabled, active_day_pct, min_commits, max_commits FROM settings').all() || []).map((s) => [s.user_id, s]));
    const enriched = users.map((u) => {
      let sub = null;
      try { sub = billing.serializeSub(u.id); } catch (e) {}
      return {
      ...u,
      scheduler_enabled: settings.get(u.id) ? settings.get(u.id).scheduler_enabled : 1,
      active_day_pct: settings.get(u.id) ? settings.get(u.id).active_day_pct : 100,
      min_commits: settings.get(u.id) ? settings.get(u.id).min_commits : 7,
      max_commits: settings.get(u.id) ? settings.get(u.id).max_commits : 200,
      subscription: sub
    };
    });
    const totals = db.prepare(`
      SELECT
        (SELECT COUNT(*) FROM users) AS users,
        (SELECT COUNT(*) FROM accounts) AS accounts,
        (SELECT COUNT(*) FROM projects) AS repos,
        (SELECT COALESCE(SUM(commits_done),0) FROM projects) AS commits,
        (SELECT COUNT(*) FROM activity_log) AS logs,
        (SELECT COUNT(*) FROM run_queue WHERE executed = 0) AS queued
    `).get();
    res.json({ users: enriched, totals });
  });

  // Admin: list every connected GitHub account across all users, so an admin
  // can find which GitGreen user owns a given GitHub account and remove/move it.
  app.get('/api/admin/accounts', requireAdmin, (req, res) => {
    const q = (req.query.q || '').trim().toLowerCase();
    const rows = db.prepare(`
      SELECT a.id, a.github_username, a.avatar_url, a.profile_url, a.is_active, a.created_at, a.last_used_at, a.last_error,
             a.user_id, u.username AS owner_username, u.email AS owner_email
      FROM accounts a JOIN users u ON u.id = a.user_id
      ORDER BY a.created_at DESC
    `).all() || [];
    const filtered = q ? rows.filter((a) =>
      (a.github_username || '').toLowerCase().includes(q) ||
      (a.owner_email || '').toLowerCase().includes(q) ||
      (a.owner_username || '').toLowerCase().includes(q)
    ) : rows;
    res.json(filtered.map((a) => ({ ...a, token_enc: undefined })));
  });

  // Admin: remove a GitHub account from whichever user owns it (with all its data).
  app.delete('/api/admin/accounts/:id', requireAdmin, (req, res) => {
    const account = db.prepare('SELECT * FROM accounts WHERE id = ?').get(Number(req.params.id));
    if (!account) return res.status(404).json({ error: 'account not found' });
    db.exec('BEGIN;');
    try {
      db.prepare('DELETE FROM run_queue WHERE account_id = ?').run(account.id);
      db.prepare('DELETE FROM day_plans WHERE account_id = ?').run(account.id);
      db.prepare('DELETE FROM projects WHERE account_id = ?').run(account.id);
      db.prepare('DELETE FROM accounts WHERE id = ?').run(account.id);
      db.exec('COMMIT;');
    } catch (err) {
      db.exec('ROLLBACK;');
      return res.status(500).json({ error: err.message });
    }
    auth.logActivity(account.user_id, null, null, 'admin', `Account @${account.github_username} removed by admin`, 1);
    res.json({ ok: true });
  });

  app.get('/api/admin/users/:id', requireAdmin, (req, res) => {
    const u = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(req.params.id));
    if (!u) return res.status(404).json({ error: 'user not found' });
    const settings = db.prepare('SELECT * FROM settings WHERE user_id = ?').get(u.id) || {};
    let subscription = null;
    try { subscription = billing.serializeSub(u.id); } catch (e) {}
    let payments = [];
    try { payments = db.prepare('SELECT * FROM payments WHERE user_id = ? ORDER BY id DESC LIMIT 50').all(u.id) || []; } catch (e) { payments = []; }
    const accounts = (db.prepare('SELECT * FROM accounts WHERE user_id = ? ORDER BY created_at DESC').all(u.id) || []).map((a) => ({ ...a, token_enc: undefined }));
    const projects = db.prepare('SELECT * FROM projects WHERE user_id = ? ORDER BY pushed_at DESC, id DESC LIMIT 200').all(u.id) || [];
    const plans = (db.prepare('SELECT * FROM day_plans WHERE user_id = ? AND plan_date >= ? ORDER BY plan_date LIMIT 14').all(u.id, todayBDStr()) || []).map((p) => {
      let sessions = [];
      let state = {};
      try { sessions = JSON.parse(p.sessions_json); } catch (e) { sessions = []; }
      try { state = JSON.parse(p.state_json || '{}'); } catch (e) { state = {}; }
      return { id: p.id, plan_date: p.plan_date, account_id: p.account_id, sessions, done: !!state.done, state };
    });
    const logs = db.prepare('SELECT * FROM activity_log WHERE user_id = ? ORDER BY id DESC LIMIT 80').all(u.id) || [];
    const accNames = new Map((db.prepare('SELECT id, github_username FROM accounts').all() || []).map((a) => [a.id, a.github_username]));
    const queue = db.prepare('SELECT * FROM run_queue WHERE user_id = ? AND plan_date = ? ORDER BY scheduled_at').all(u.id, todayBDStr()) || [];
    res.json({
      user: { ...u, password_hash: undefined, salt: undefined },
      settings,
      accounts,
      projects,
      plans,
      logs: logs.map((l) => ({ ...l, account_name: accNames.get(l.account_id) || null })),
      queue,
      subscription,
      payments
    });
  });

  app.post('/api/admin/users/:id/pause', requireAdmin, (req, res) => {
    const u = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(req.params.id));
    if (!u) return res.status(404).json({ error: 'user not found' });
    db.prepare('UPDATE settings SET scheduler_enabled = 0 WHERE user_id = ?').run(u.id);
    auth.logActivity(u.id, null, null, 'admin', 'Autopilot paused by admin', 1);
    res.json({ ok: true, scheduler_enabled: 0 });
  });

  app.post('/api/admin/users/:id/resume', requireAdmin, (req, res) => {
    const u = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(req.params.id));
    if (!u) return res.status(404).json({ error: 'user not found' });
    db.prepare('UPDATE settings SET scheduler_enabled = 1 WHERE user_id = ?').run(u.id);
    auth.logActivity(u.id, null, null, 'admin', 'Autopilot resumed by admin', 1);
    res.json({ ok: true, scheduler_enabled: 1 });
  });

  app.post('/api/admin/users/:id/set-admin', requireAdmin, (req, res) => {
    const u = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(req.params.id));
    if (!u) return res.status(404).json({ error: 'user not found' });
    if (u.id === req.user.id && !req.body?.admin) return res.status(400).json({ error: 'you cannot remove your own admin' });
    const admin = req.body?.admin ? 1 : 0;
    db.prepare('UPDATE users SET is_admin = ? WHERE id = ?').run(admin, u.id);
    res.json({ ok: true, is_admin: !!admin });
  });

  app.post('/api/admin/users/:id/accounts/:accountId/activate', requireAdmin, (req, res) => {
    const account = db.prepare('SELECT * FROM accounts WHERE id = ? AND user_id = ?').get(Number(req.params.accountId), Number(req.params.id));
    if (!account) return res.status(404).json({ error: 'account not found' });
    const active = req.body?.active ? 1 : 0;
    db.prepare('UPDATE accounts SET is_active = ? WHERE id = ?').run(active, account.id);
    auth.logActivity(account.user_id, account.id, null, 'admin', active ? 'Account resumed by admin' : 'Account paused by admin', 1);
    res.json({ ok: true, is_active: !!active });
  });

  app.post('/api/admin/users/:id/run-today', requireAdmin, async (req, res) => {
    const { accountId } = req.body || {};
    if (!accountId) return res.status(400).json({ error: 'accountId required' });
    try {
      const r = await scheduler.runToday(Number(req.params.id), Number(accountId));
      auth.logActivity(Number(req.params.id), Number(accountId), null, 'admin', `Run today's task triggered by admin (${r.total} commits, ${r.batches} batches)`, 1);
      res.json({ ok: true, ...r });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/admin/users/:id/run-now', requireAdmin, async (req, res) => {
    const { accountId, commits } = req.body || {};
    if (!accountId) return res.status(400).json({ error: 'accountId required' });
    try {
      const done = await scheduler.runNow(Number(req.params.id), Number(accountId), commits ? Number(commits) : 3);
      res.json({ ok: true, commits: done });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/admin/users/:id/regenerate-plans', requireAdmin, (req, res) => {
    const accounts = db.prepare('SELECT * FROM accounts WHERE user_id = ?').all(Number(req.params.id)) || [];
    for (const a of accounts) {
      db.prepare('DELETE FROM day_plans WHERE user_id = ? AND account_id = ?').run(a.user_id, a.id);
      db.prepare('DELETE FROM run_queue WHERE user_id = ? AND account_id = ? AND plan_date = ?').run(a.user_id, a.id, todayBDStr());
      scheduler.ensurePlans(a.user_id, a.id, 14);
    }
    auth.logActivity(Number(req.params.id), null, null, 'admin', 'Plans regenerated by admin', 1);
    res.json({ ok: true });
  });

  app.post('/api/admin/users/:id/settings', requireAdmin, (req, res) => {
    const u = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(req.params.id));
    if (!u) return res.status(404).json({ error: 'user not found' });
    const s = db.prepare('SELECT * FROM settings WHERE user_id = ?').get(u.id) || {};
    const fields = ['active_day_pct', 'min_commits', 'max_commits', 'sessions_per_day', 'hourly_start', 'hourly_end'];
    const next = { ...s, ...req.body };
    for (const f of fields) {
      const v = Number(req.body[f]);
      if (!Number.isNaN(v)) next[f] = Math.max(1, Math.min(100, Math.round(v)));
    }
    next.preserve_streak = req.body.preserve_streak ? 1 : 0;
    next.scheduler_enabled = req.body.scheduler_enabled ? 1 : 0;
    db.prepare('UPDATE settings SET active_day_pct=?, min_commits=?, max_commits=?, sessions_per_day=?, hourly_start=?, hourly_end=?, preserve_streak=?, scheduler_enabled=? WHERE user_id=?')
      .run(next.active_day_pct, next.min_commits, next.max_commits, next.sessions_per_day, next.hourly_start, next.hourly_end, next.preserve_streak, next.scheduler_enabled, u.id);
    res.json({ ok: true, settings: next });
  });

  app.delete('/api/admin/users/:id', requireAdmin, (req, res) => {
    const u = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(req.params.id));
    if (!u) return res.status(404).json({ error: 'user not found' });
    if (u.id === req.user.id) return res.status(400).json({ error: 'you cannot delete your own account' });
    db.exec('BEGIN;');
    try {
      db.prepare('DELETE FROM run_queue WHERE user_id = ?').run(u.id);
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(u.id);
      db.prepare('DELETE FROM settings WHERE user_id = ?').run(u.id);
      db.prepare('DELETE FROM day_plans WHERE user_id = ?').run(u.id);
      db.prepare('DELETE FROM projects WHERE user_id = ?').run(u.id);
      db.prepare('DELETE FROM activity_log WHERE user_id = ?').run(u.id);
      db.prepare('DELETE FROM accounts WHERE user_id = ?').run(u.id);
      db.prepare('DELETE FROM users WHERE id = ?').run(u.id);
      db.exec('COMMIT;');
    } catch (err) {
      db.exec('ROLLBACK;');
      return res.status(500).json({ error: err.message });
    }
    res.json({ ok: true });
  });

  // Manually grant or change a user's subscription (admin can do anything:
  // give a plan, add/remove days, change the account limit).
  app.post('/api/admin/users/:id/subscription', requireAdmin, (req, res) => {
    const u = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(req.params.id));
    if (!u) return res.status(404).json({ error: 'user not found' });
    const { planId, days, limit } = req.body || {};
    try {
      if (planId) {
        const plan = billing.getPlan(String(planId));
        if (!plan) return res.status(400).json({ error: 'unknown plan' });
        billing.activatePlan(u.id, plan.id, { days: days != null ? Number(days) : null, source: 'admin' });
      } else {
        billing.adjustSubscription(u.id, { days: days != null ? Number(days) : null, limit: limit != null ? Number(limit) : null });
      }
      auth.logActivity(u.id, null, null, 'admin', 'Subscription updated by admin', 1);
      res.json({ ok: true, subscription: billing.serializeSub(u.id), plans: billing.PLANS });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.delete('/api/admin/users/:id/accounts/:accountId', requireAdmin, (req, res) => {
    const account = db.prepare('SELECT * FROM accounts WHERE id = ? AND user_id = ?').get(Number(req.params.accountId), Number(req.params.id));
    if (!account) return res.status(404).json({ error: 'account not found' });
    db.exec('BEGIN;');
    try {
      db.prepare('DELETE FROM run_queue WHERE account_id = ?').run(account.id);
      db.prepare('DELETE FROM day_plans WHERE account_id = ?').run(account.id);
      db.prepare('DELETE FROM projects WHERE account_id = ?').run(account.id);
      db.prepare('DELETE FROM accounts WHERE id = ?').run(account.id);
      db.exec('COMMIT;');
    } catch (err) {
      db.exec('ROLLBACK;');
      return res.status(500).json({ error: err.message });
    }
    auth.logActivity(account.user_id, null, null, 'admin', `Account @${account.github_username} removed by admin`, 1);
    res.json({ ok: true });
  });

  app.get('/api/admin/next-commit', requireAdmin, (req, res) => {
    const accountId = req.query.accountId ? Number(req.query.accountId) : null;
    if (accountId) {
      const account = db.prepare('SELECT * FROM accounts WHERE id = ?').get(accountId);
      if (!account) return res.status(400).json({ error: 'account not found' });
      return res.json({ scheduledAt: scheduler.nextCommitAt(account.user_id, account.id), serverTime: Date.now() });
    }
    const accounts = db.prepare('SELECT * FROM accounts WHERE user_id = ?').all(Number(req.query.userId) || 0) || [];
    let best = null;
    for (const a of accounts) {
      const t = scheduler.nextCommitAt(a.user_id, a.id);
      if (t && (best === null || t < best)) best = t;
    }
    res.json({ scheduledAt: best, serverTime: Date.now() });
  });

  // ---------- Static ----------
  // Landing page is the public homepage; the app lives at /app.
  app.get('/', (req, res) => res.sendFile(path.join(ROOT, 'public', 'landing.html')));
  app.get('/app', (req, res) => res.sendFile(path.join(ROOT, 'public', 'index.html')));
  app.get('/admin', (req, res) => res.sendFile(path.join(ROOT, 'public', 'admin.html')));
  app.use(express.static(path.join(ROOT, 'public')));

  // Scheduler loop
  setInterval(() => {
    try {
      scheduler.tick().catch((err) => console.error('[scheduler]', err.message));
    } catch (err) {
      console.error('[scheduler]', err.message);
    }
  }, 60 * 1000);

  // Keep a snapshot of the SQLite db + key in Neon.
  persist.startBackupLoop();

  app.listen(PORT, () => {
    console.log('GitGreen running at ' + HOST);
    console.log('Public data dir:', path.join(ROOT, 'data'));
  });
}

main().catch((err) => {
  console.error('Startup failed:', err.message);
  process.exit(1);
});
