const db = require('./db');
const auth = require('./auth');
const { decrypt } = require('./crypto');
const github = require('./github');
const projects = require('./projects');
const CATALOG = require('../content/catalog');
const {
  bdMinutesNow,
  bdMinutesFromDate,
  bdDateStr,
  todayBDStr,
  daysAgoBDStr,
  bdMinToDate,
  isInQuietWindow,
  isQuietNow,
  clipWindows,
  weekdayOf,
  QUIET_END
} = require('./timebd');

// Time windows are expressed in Bangladesh time (UTC+6). The evening window
// starts after the 20:00-22:00 maintenance window, so nothing is ever planned
// inside it.
const WINDOWS = clipWindows([
  { from: 9 * 60, to: 11 * 60 + 40 },   // late morning
  { from: 13 * 60 + 20, to: 15 * 60 + 10 }, // early afternoon
  { from: 16 * 60, to: 18 * 60 + 30 },   // late afternoon
  { from: 20 * 60 + 30, to: 23 * 60 }    // evening (after maintenance window)
]);

function rand(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function pad(n) {
  return String(n).padStart(2, '0');
}

function toHM(minutes) {
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

// Choose total commits for the day, a human-like random spread from light days
// (~5) to rare marathons (100-160). Every day is different, nothing flat.
function dayCommitTotal() {
  const roll = Math.random();
  if (roll < 0.12) return rand(5, 18);        // light day
  if (roll < 0.45) return rand(14, 45);       // normal day
  if (roll < 0.72) return rand(30, 70);       // active day
  if (roll < 0.90) return rand(55, 100);      // heavy day
  return rand(90, 160);                       // rare marathon day
}

function isWeekend(date) {
  const day = weekdayOf(date);
  return day === 0 || day === 6;
}

function makeDayPlan(userId, accountId, dateStr, settings) {
  // Every day gets commits. The active_day_pct setting only decides whether a
  // day is a full random day or a light "minimum" day, so a zero-commit day
  // never happens.
  const minC = Math.max(1, Number(settings.min_commits) || 1);
  const maxC = Math.max(minC, Number(settings.max_commits) || 200);
  const activeRoll = Math.random() * 100;

  if (activeRoll >= settings.active_day_pct) {
    // Light day: a single small session, still a solid chunk of commits.
    const lightTotal = Math.max(minC, Math.min(14, maxC, rand(minC, 12)));
    const w = pick(WINDOWS);
    const times = [];
    let t = w.from + rand(0, 40);
    for (let c = 0; c < lightTotal; c++) {
      times.push(t);
      t += rand(2, 6);
    }
    const session = {
      label: 'session-1',
      start: toHM(times[0]),
      createBudget: Math.max(1, Math.round(lightTotal / 6)),
      commits: times.map((m) => ({ at: toHM(m), kind: null }))
    };
    return { sessions: [session], active: true, total: lightTotal };
  }

  // Weekend slightly quieter.
  const base = dayCommitTotal();
  const rawTotal = isWeekend(dateStr) ? Math.max(1, Math.round(base * 0.7)) : base;
  const total = Math.min(maxC, Math.max(minC, rawTotal));

  // Build 1-3 sessions based on how much work there is.
  const sessionCount = total <= 3 ? 1 : total <= 20 ? (Math.random() < 0.5 ? 2 : 1) : total <= 60 ? 2 : 3;

  // Respect active hours if the user narrowed them.
  const startH = Number(settings.hourly_start) || 9;
  const endH = Number(settings.hourly_end) || 23;
  const windows = WINDOWS.filter((w) => w.from >= startH * 60 && w.to <= endH * 60 + 5);
  const pool = windows.length ? windows : WINDOWS;

  // Pick distinct windows.
  const chosen = [...pool].sort(() => Math.random() - 0.5).slice(0, sessionCount).sort((a, b) => a.from - b.from);

  // Distribute commits across sessions (earlier sessions get more).
  let remaining = total;
  const per = [];
  for (let i = 0; i < sessionCount; i++) {
    if (i === sessionCount - 1) {
      per.push(remaining);
    } else {
      const share = Math.max(1, Math.round(remaining * 0.55));
      per.push(share);
      remaining -= share;
    }
  }

  const sessions = chosen.map((w, i) => {
    const count = per[i];
    // Cap how many brand-new repos a session creates; the rest are commits
    // that keep building existing repos.
    let createBudget;
    if (count <= 3) createBudget = 1;
    else if (count <= 20) createBudget = Math.min(3, 1 + Math.floor(Math.random() * 2));
    else if (count <= 60) createBudget = Math.min(5, 2 + Math.floor(Math.random() * 2));
    else createBudget = 5 + Math.floor(Math.random() * 3);

    const span = Math.min(count * 4, 260); // commits stay within a few hours
    const start = rand(w.from, Math.max(w.from, w.to - span - 5));
    const times = [];
    let t = start;
    for (let c = 0; c < count; c++) {
      times.push(t);
      t += count <= 20 ? rand(1, 6) : rand(1, 3); // denser on heavy days
    }
    return {
      label: `session-${i + 1}`,
      start: toHM(start),
      createBudget,
      commits: times.map((m) => ({ at: toHM(m), kind: null }))
    };
  });

  return { sessions, active: true, total };
}

function ensurePlans(userId, accountId, days = 14) {
  const settings = db.prepare('SELECT * FROM settings WHERE user_id = ?').get(userId) || {};
  const existing = new Set(
    (db.prepare('SELECT plan_date FROM day_plans WHERE user_id = ? AND account_id = ?').all(userId, accountId) || [])
      .map((r) => r.plan_date)
  );
  const today = new Date();
  const added = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(today.getTime() + i * 86400000);
    const dateStr = bdDateStr(d);
    if (existing.has(dateStr)) continue;
    const plan = makeDayPlan(userId, accountId, dateStr, settings);
    db.prepare(
      'INSERT INTO day_plans (user_id, account_id, plan_date, sessions_json, state_json) VALUES (?,?,?,?,?)'
    ).run(userId, accountId, dateStr, JSON.stringify(plan.sessions), JSON.stringify({ done: false, commitsDone: 0, active: plan.active }));
    added.push(dateStr);
  }
  return added;
}

function sessionState(row) {
  try {
    return JSON.parse(row.state_json || '{"done":false,"commitsDone":0,"active":true}');
  } catch (e) {
    return { done: false, commitsDone: 0, active: true };
  }
}

// Execute any due sessions for all users/accounts.
async function tick() {
  const users = db.prepare('SELECT id FROM users').all() || [];
  for (const userRow of users) {
    await tickUser(userRow.id);
  }
}

const busy = new Set();
// Tracks the most recently created topics per account so new repos mix topics
// instead of draining one category at a time.
const recentTopics = new Map();

// Hard limit on brand-new repos created per account per day. Keeps the profile
// human (a couple of new projects at most) instead of dumping the whole catalog
// in one go, and means a "Run"/"start" click mostly evolves existing repos.
const DAILY_REPO_CAP = Math.max(1, parseInt(process.env.DAILY_REPO_CAP || '2', 10) || 2);

// How many new repos this account has created today (Bangladesh time).
function dailyCreatesCount(userId, accountId, dateStr) {
  return db.prepare(
    `SELECT COUNT(*) AS n FROM activity_log
     WHERE user_id = ? AND account_id = ? AND kind = 'create' AND DATE((created_at/1000) + 21600, 'unixepoch') = ?`
  ).get(userId, accountId, dateStr).n || 0;
}

async function tickUser(userId) {
  const settings = db.prepare('SELECT * FROM settings WHERE user_id = ?').get(userId) || {};
  const autopilot = settings.scheduler_enabled !== 0;
  const accounts = db.prepare('SELECT * FROM accounts WHERE user_id = ? AND is_active = 1').all(userId) || [];
  // Maintenance window: 20:00-22:00 Bangladesh time, no commits for anyone.
  if (isQuietNow()) return;
  for (const account of accounts) {
    if (busy.has(account.id)) continue;
    ensurePlans(userId, account.id, 14);

    busy.add(account.id);
    try {
      // A manual "Run today's task" queue takes over today: the auto-pilot
      // leaves today's day plan alone (it is marked done) and the queue is
      // executed commit-by-commit as each scheduled time arrives.
      const today = todayBDStr();
      const todayQueued = hasPendingQueue(userId, account.id, today);

      if (todayQueued) {
        await processQueue(userId, account);
      }

      if (autopilot) {
        // Look at today and the last 7 days. If the machine was off, sessions from
        // recent past days still run (with backdated timestamps) so the grid never
        // gets a gap. Today is skipped when a manual queue is running it instead.
        const now = bdMinutesNow();
        const rows = db.prepare(
          `SELECT * FROM day_plans
           WHERE user_id = ? AND account_id = ? AND plan_date >= ? AND plan_date <= ?
           ORDER BY plan_date`
        ).all(userId, account.id, daysAgoBDStr(7), today);
        if (rows.length === 0) continue;

        for (const row of rows) {
          if (todayQueued && row.plan_date === today) continue;
          const state = sessionState(row);
          if (state.done || !state.active) continue;

          let sessions = [];
          try { sessions = JSON.parse(row.sessions_json); } catch (e) { sessions = []; }
          if (sessions.length === 0) continue;

          const due = sessions.filter((s) => !(state.sessionDone || []).includes(s.start));
          const ready = due.filter((s) => timeToMin(s.start) <= now);
          if (ready.length === 0) continue;

          for (const session of ready) {
            await runSession(userId, account, session);
            state.sessionDone = state.sessionDone || [];
            state.sessionDone.push(session.start);
          }
          if ((state.sessionDone || []).length === sessions.length) state.done = true;
          db.prepare('UPDATE day_plans SET state_json = ? WHERE id = ?').run(JSON.stringify(state), row.id);
        }
      }

      // Drop old queue rows so the table never grows without bound.
      db.prepare('DELETE FROM run_queue WHERE plan_date < ?').run(daysAgoBDStr(7));
    } catch (err) {
      auth.logActivity(userId, account.id, null, 'error', `Scheduler error: ${err.message}`, 0);
      db.prepare('UPDATE accounts SET last_error = ? WHERE id = ?').run(String(err.message).slice(0, 300), account.id);
    } finally {
      busy.delete(account.id);
    }
  }
}

function timeToMin(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

// Runs one scheduled session: a mix of new repos and incremental commits.
// When dateOverride is given (used by the manual run queue) every commit in the
// session uses that exact timestamp instead of 'now'. New repo creation is
// strictly capped per day so a "Run" mostly evolves existing repos and only
// occasionally (and rarely) spins up a brand-new one.
async function runSession(userId, account, session, dateOverride = null) {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!user) return;

  const commits = session.commits || [];
  let existing = db.prepare(
    'SELECT * FROM projects WHERE user_id = ? AND account_id = ? AND status = ? ORDER BY pushed_at DESC'
  ).all(userId, account.id, 'pushed') || [];

  const createBudget = session.createBudget != null ? session.createBudget : (existing.length === 0 ? 1 : 1);

  // Pick a small set of repos to build up during this session, so several
  // commits land on the same projects (like a real working day).
  const focusCount = Math.min(4, Math.max(1, Math.ceil(commits.length / 12)));
  const focused = [];
  const pool = [...existing].sort(() => Math.random() - 0.5);
  for (let i = 0; i < focusCount && i < pool.length; i++) focused.push(pool[i]);

  // Enforce the daily cap across everything (auto-pilot + manual runs).
  const createsLeftTotal = Math.max(0, DAILY_REPO_CAP - dailyCreatesCount(userId, account.id, todayBDStr()));
  const createsLeft = Math.min(createsLeftTotal, createBudget);
  let focusIdx = 0;
  let commitIdx = 0;

  for (const commit of commits) {
    commitIdx += 1;
    const commitDate = dateOverride ? new Date(dateOverride) : new Date();
    if (commit.at && commit.at !== 'now') {
      const [h, m] = commit.at.split(':').map(Number);
      if (!Number.isNaN(h) && !Number.isNaN(m)) {
        // Timestamps are Bangladesh time. Anything that lands inside the
        // 20:00-22:00 maintenance window is pushed just past it.
        let bdMin = (h * 60 + m) % 1440;
        if (isInQuietWindow(bdMin)) bdMin = 22 * 60;
        bdMinToDate(bdMin, commitDate);
        commitDate.setUTCSeconds(rand(5, 55));
        if (commitDate.getTime() > Date.now()) commitDate.setTime(Date.now());
      }
    }

    const noRepos = existing.length === 0;
    const shouldCreate = noRepos || (createsLeft > 0 && Math.random() < 0.12);

    if (shouldCreate && createsLeft > 0) {
      const topics = recentTopics.get(account.id) || [];
      // Avoid creating a duplicate: skip projects whose base repo already
      // exists on the user's GitHub (e.g. from an earlier failed push).
      let token = null;
      try { token = decrypt(account.token_enc); } catch (e) { token = null; }
      const cat = token
        ? await projects.randomUnused(userId, [], topics, (slug) => github.repoExists(token, account.github_username, slug))
        : projects.randomUnused(userId, [], topics);
      if (!cat) break;
      try {
        await projects.createProject(user, account, cat, commitDate);
        createsLeft -= 1;
        recentTopics.set(account.id, [cat.category, ...topics].slice(0, 5));
        const created = db.prepare('SELECT * FROM projects WHERE user_id = ? AND account_id = ? ORDER BY pushed_at DESC LIMIT 1').get(userId, account.id);
        if (created) {
          existing.unshift(created);
          if (focused.length < focusCount) focused.push(created);
        }
      } catch (err) {
        auth.logActivity(userId, account.id, null, 'error', `Create failed (${cat.title}): ${err.message}`, 0);
      }
    } else {
      if (focused.length === 0) {
        const target = existing[rand(0, Math.min(existing.length, 6) - 1)];
        if (!target) break;
        try {
          await projects.evolveProject(user, account, target, commitDate);
        } catch (err) {
          auth.logActivity(userId, account.id, target.id, 'error', `Commit failed (${target.repo_name}): ${err.message}`, 0);
        }
      } else {
        const target = focused[focusIdx % focused.length];
        focusIdx += 1;
        try {
          await projects.evolveProject(user, account, target, commitDate);
        } catch (err) {
          auth.logActivity(userId, account.id, target.id, 'error', `Commit failed (${target.repo_name}): ${err.message}`, 0);
        }
      }
    }
  }
}

// Manual trigger for UI "run now" button. Blocked during the maintenance window.
async function runNow(userId, accountId, commits = null) {
  if (isQuietNow()) {
    throw new Error('Maintenance window (20:00-22:00 Bangladesh time): commits are paused.');
  }
  const account = db.prepare('SELECT * FROM accounts WHERE id = ? AND user_id = ?').get(accountId, userId);
  if (!account) throw new Error('account not found');
  const session = {
    start: 'now',
    createBudget: Math.max(0, DAILY_REPO_CAP - dailyCreatesCount(userId, accountId, todayBDStr())),
    commits: commits
      ? Array.from({ length: commits }, (_, i) => ({ at: 'now', kind: null }))
      : Array.from({ length: rand(1, 4) }, () => ({ at: 'now', kind: null }))
  };
  await runSession(userId, account, session);
  return session.commits.length;
}

// ---------------------------------------------------------------------------
// "Run today's task" queue
// ---------------------------------------------------------------------------

function hasPendingQueue(userId, accountId, dateStr) {
  return db.prepare(
    'SELECT COUNT(*) AS n FROM run_queue WHERE user_id = ? AND account_id = ? AND plan_date = ? AND executed = 0'
  ).get(userId, accountId, dateStr).n > 0;
}

// Wall-clock ms of a planned commit on a given Bangladesh date, e.g.
// ('2026-08-19', '16:05') -> 16:05 BD.
function planCommitMs(planDate, at) {
  if (!at || at === 'now') return null;
  const d = new Date(`${planDate}T${at}:00+06:00`);
  return isNaN(d.getTime()) ? null : d.getTime();
}

// Split today's total into 1-3 realistic batches, earlier ones carrying more.
function buildBatches(total) {
  let count;
  if (total <= 6) count = 1;
  else if (total <= 20) count = rand(1, 2);
  else if (total <= 60) count = rand(2, 3);
  else count = 3;

  const batches = [];
  let remaining = total;
  for (let i = 0; i < count; i++) {
    if (i === count - 1) { batches.push(remaining); break; }
    const share = Math.max(1, Math.round(remaining * (0.5 + Math.random() * 0.15)));
    batches.push(share);
    remaining -= share;
  }
  return batches.filter((b) => b > 0);
}

// Build today's queue timestamps: the first batch starts a few minutes from
// now, later batches land across the rest of the day, and the whole plan is
// packed to fit before the day ends (so a late trigger never collapses into a
// pile at one time). Returns { times, batches }.
function scheduleQueue(total, nowMs, endMs) {
  const start = nowMs + rand(3, 8) * 60000;
  const availableMs = endMs - start;

  // In-batch spacing: 2-5 minutes, denser on very heavy days.
  const gapFor = (n) => (n <= 25 ? rand(2, 5) : rand(1, 3));

  let batches = buildBatches(total);
  let gaps = batches.map(gapFor);
  let interGap = rand(60, 180); // minutes between batches

  const needed = () => {
    let d = 0;
    for (let i = 0; i < batches.length; i++) {
      d += (batches[i] - 1) * gaps[i] * 60000;
      if (i < batches.length - 1) d += interGap * 60000;
    }
    return d;
  };

  // Shrink inter-batch gaps, then tighten spacing, then merge batches until the
  // whole plan fits in the day that's left.
  let safety = 0;
  while (batches.length > 1 && needed() > availableMs && safety < 80) {
    safety++;
    interGap = Math.max(15, Math.round(interGap * 0.65));
    if (interGap <= 15) {
      gaps = batches.map((n) => Math.max(1, Math.round(gapFor(n) * 0.7)));
      if (needed() > availableMs) {
        let bestI = 0, bestSum = Infinity;
        for (let i = 0; i < batches.length - 1; i++) {
          const s = batches[i] + batches[i + 1];
          if (s < bestSum) { bestSum = s; bestI = i; }
        }
        batches.splice(bestI, 2, batches[bestI] + batches[bestI + 1]);
        gaps.splice(bestI, 1);
        gaps[bestI] = gapFor(batches[bestI]);
        interGap = rand(60, 180);
      }
    }
  }

  // Lay the timeline out: dense commits inside each batch, a long natural break
  // between batches (the "16:00, then again at 20:00" pattern).
  const times = [];
  let cursor = start;
  for (let i = 0; i < batches.length; i++) {
    for (let c = 0; c < batches[i]; c++) {
      times.push(cursor);
      cursor += gaps[i] * 60000 + rand(0, 45) * 1000;
    }
    if (i < batches.length - 1) {
      cursor += interGap * 60000 + rand(0, 20) * 60000;
    }
  }

  // Final safety: if the plan still overruns the day, compress it proportionally
  // so the last commit lands before day end without collapsing to one time.
  const last = times[times.length - 1];
  if (last > endMs) {
    const scale = (endMs - start) / (last - start || 1);
    for (let i = 0; i < times.length; i++) {
      times[i] = Math.min(endMs, Math.round(start + (times[i] - start) * scale));
    }
  }
  return { times, batches: batches.length };
}

// Keep every commit on today's Bangladesh calendar and out of the maintenance
// window (20:00-22:00 BD). Quiet-window commits shift just past 22:00 with a
// jittered offset so they read as a natural late-evening wrap-up.
function sanitizeTimes(times) {
  const dayEnd = new Date(`${todayBDStr()}T23:30:00+06:00`).getTime();
  return times.map((ms) => {
    let d = new Date(ms);
    const bdMin = bdMinutesFromDate(d);
    if (isInQuietWindow(bdMin)) {
      const shifted = new Date(ms);
      bdMinToDate(QUIET_END + rand(0, 18), shifted);
      ms = shifted.getTime();
    }
    return Math.min(ms, dayEnd);
  });
}

// Build and store today's manual run queue. Commits are split into 1-3 batches
// spread across the day, and within a batch they land minutes apart (2-5 when
// there is room), so a single click produces a natural, human-paced day of
// activity instead of a burst. The queue is then executed commit-by-commit by
// the scheduler tick.
async function runToday(userId, accountId) {
  const account = db.prepare('SELECT * FROM accounts WHERE id = ? AND user_id = ?').get(accountId, userId);
  if (!account) throw new Error('account not found');

  const today = todayBDStr();
  ensurePlans(userId, accountId, 14);
  const plan = db.prepare('SELECT * FROM day_plans WHERE user_id = ? AND account_id = ? AND plan_date = ?').get(userId, accountId, today);

  let sessions = [];
  if (plan) { try { sessions = JSON.parse(plan.sessions_json); } catch (e) { sessions = []; } }
  if (!sessions.length) {
    const settings = db.prepare('SELECT * FROM settings WHERE user_id = ?').get(userId) || {};
    sessions = makeDayPlan(userId, accountId, today, settings).sessions;
    if (plan) {
      db.prepare('UPDATE day_plans SET sessions_json = ? WHERE id = ?').run(JSON.stringify(sessions), plan.id);
    }
  }

  const total = sessions.reduce((s, x) => s + (x.commits ? x.commits.length : 0), 0);
  if (total <= 0) throw new Error('no activity planned for today');

  // Respect active hours when choosing the day's end, otherwise 23:30 BD.
  const settings = db.prepare('SELECT * FROM settings WHERE user_id = ?').get(userId) || {};
  const endH = Math.min(23, Number(settings.hourly_end) || 23);
  const dayEndMs = new Date(`${today}T${pad(endH)}:30:00+06:00`).getTime();

  // Replacing any previous queue for today with a fresh schedule.
  db.prepare('DELETE FROM run_queue WHERE user_id = ? AND account_id = ? AND plan_date = ?').run(userId, accountId, today);

  const { times, batches } = scheduleQueue(total, Date.now(), dayEndMs);
  const clean = sanitizeTimes(times).sort((a, b) => a - b);

  let inserted = 0;
  let lastAt = 0;
  for (const t of clean) {
    db.prepare(
      'INSERT INTO run_queue (user_id, account_id, plan_date, batch, scheduled_at, executed, created_at) VALUES (?,?,?,?,?,?,?)'
    ).run(userId, accountId, today, 0, t, 0, auth.now());
    inserted += 1;
    if (t > lastAt) lastAt = t;
  }

  // Mark today's day plan as handled so the auto-pilot does not double-run it.
  db.prepare('UPDATE day_plans SET state_json = ? WHERE user_id = ? AND account_id = ? AND plan_date = ?')
    .run(JSON.stringify({ done: true, commitsDone: total, active: true, manual: true }), userId, accountId, today);

  return { total, inserted, batches, firstAt: clean.length ? clean[0] : null, lastAt: lastAt || null };
}

// Execute the commits in a manual queue that are due now. Runs at most 5 per
// tick so a big manual run still clears within a few minutes; timestamps are
// backdated to the scheduled minute, so even a restart that skips ahead keeps
// the grid looking natural.
async function processQueue(userId, account) {
  const today = todayBDStr();
  const now = Date.now();
  const due = db.prepare(
    `SELECT * FROM run_queue
     WHERE user_id = ? AND account_id = ? AND plan_date = ? AND executed = 0 AND scheduled_at <= ?
     ORDER BY scheduled_at ASC LIMIT 5`
  ).all(userId, account.id, today, now);

  // Cap new repos for the day (shared DAILY_REPO_CAP), so a manual run never
  // dumps the whole catalog at once.
  const createdToday = dailyCreatesCount(userId, account.id, today);
  const createsLeft = Math.max(0, DAILY_REPO_CAP - createdToday);

  let done = 0;
  for (const row of due) {
    const commitDate = new Date(row.scheduled_at);
    commitDate.setUTCSeconds(rand(5, 55));
    try {
      await runSession(userId, account, { start: 'now', createBudget: createsLeft, commits: [{ at: 'now', kind: null }] }, commitDate);
      db.prepare('UPDATE run_queue SET executed = 1 WHERE id = ?').run(row.id);
      done += 1;
    } catch (err) {
      auth.logActivity(userId, account.id, null, 'error', `Queued commit failed: ${err.message}`, 0);
      db.prepare('UPDATE accounts SET last_error = ? WHERE id = ?').run(String(err.message).slice(0, 300), account.id);
      // Skip the failed commit so it never loops forever.
      db.prepare('UPDATE run_queue SET executed = 1 WHERE id = ?').run(row.id);
    }
  }
  return done;
}

// The next commit's estimated wall-clock time for an account, or null. A manual
// queue wins when present; otherwise the nearest future planned session time is
// used, so the dashboard countdown works for both manual and auto modes.
function nextCommitAt(userId, accountId) {
  const today = todayBDStr();
  const queued = db.prepare(
    'SELECT scheduled_at FROM run_queue WHERE user_id = ? AND account_id = ? AND plan_date = ? AND executed = 0 ORDER BY scheduled_at ASC LIMIT 1'
  ).get(userId, accountId, today);
  if (queued) return queued.scheduled_at;

  // No manual queue: only a future auto-pilot session counts, and only if the
  // autopilot is enabled for this user.
  const settings = db.prepare('SELECT * FROM settings WHERE user_id = ?').get(userId) || {};
  if (settings.scheduler_enabled === 0) return null;

  const now = Date.now();
  let best = null;
  const rows = db.prepare(
    'SELECT plan_date, sessions_json FROM day_plans WHERE user_id = ? AND account_id = ? AND plan_date >= ? ORDER BY plan_date LIMIT 14'
  ).all(userId, accountId, today) || [];
  for (const row of rows) {
    let sessions = [];
    try { sessions = JSON.parse(row.sessions_json); } catch (e) { sessions = []; }
    for (const s of sessions) {
      for (const c of s.commits || []) {
        const ms = planCommitMs(row.plan_date, c.at);
        if (ms && ms > now && (best === null || ms < best)) best = ms;
      }
    }
  }
  return best;
}

module.exports = { tick, ensurePlans, runNow, runToday, processQueue, nextCommitAt, hasPendingQueue, makeDayPlan };
