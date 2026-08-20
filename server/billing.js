// Billing module: subscription plans, account limits and OxaPay crypto
// payments. Payments are stored as "orders" in the `payments` table and the
// subscription state lives in the `subscriptions` table.
//
// Plans are fixed in code so prices can never drift between the UI and the
// server. Every plan is a monthly price in USD; customers pay with crypto via
// OxaPay (no cards/banks). OxaPay hosts the payment page, so we just create an
// invoice, redirect the customer to the payment_url, and let the webhook / poll
// activate the plan.
//
// Upgrades only charge the price difference and KEEP the existing expiry date
// ("notun plan kinle new mayad apply hobe na"), renewals extend by 30 days and
// fresh purchases start a new 30-day period.

const crypto = require('crypto');
const db = require('./db');
const auth = require('./auth');
const { APP_BASE_URL } = require('./config');

const OXAPAY_API = 'https://api.oxapay.com/v1';
const OXAPAY_KEY = process.env.OXAPAY_MERCHANT_KEY || '';
const DAY = 86400000;

// Price tiers. 'free' is the trial tier: new users get 30 days / 1 account.
const PLANS = [
  { id: 'free', name: 'Free Trial', accounts: 1, price: 0, tagline: 'Try it free', popular: false },
  { id: 'starter', name: 'Starter', accounts: 5, price: 3, tagline: 'For getting started', popular: false },
  { id: 'pro', name: 'Pro', accounts: 10, price: 5, tagline: 'Most popular', popular: true },
  { id: 'pro_plus', name: 'Pro Plus', accounts: 30, price: 10, tagline: 'For growing teams', popular: false },
  { id: 'max', name: 'Max', accounts: 100, price: 20, tagline: 'For power users', popular: false }
];

function getPlan(id) {
  return PLANS.find((p) => p.id === id) || null;
}

function configured() {
  return !!OXAPAY_KEY;
}

function urls() {
  const base = APP_BASE_URL.replace(/\/$/, '');
  return {
    ipn: `${base}/api/billing/ipn`,
    success: `${base}/app?payment=success`,
    cancel: `${base}/app?payment=cancelled`
  };
}

// ---- Subscription state ---------------------------------------------------

function grantTrial(userId) {
  const count = db.prepare('SELECT COUNT(*) AS n FROM accounts WHERE user_id = ?').get(userId).n;
  // Existing users keep whatever they already have; brand new users get 1 slot.
  const limit = Math.max(1, count);
  const now = Date.now();
  db.prepare(
    'INSERT INTO subscriptions (user_id, plan_id, account_limit, status, started_at, expires_at, source, updated_at, created_at) VALUES (?,?,?,?,?,?,?,?,?)'
  ).run(userId, 'free', limit, 'active', now, now + 30 * DAY, 'trial', now, now);
  return db.prepare('SELECT * FROM subscriptions WHERE user_id = ?').get(userId);
}

// Return the user's subscription. A user with no subscription (brand new, or
// created before billing shipped) transparently gets a free trial.
function getSubscription(userId) {
  let sub = db.prepare('SELECT * FROM subscriptions WHERE user_id = ?').get(userId) || null;
  const now = Date.now();
  if (!sub) sub = grantTrial(userId);
  if (sub.status === 'active' && sub.expires_at && sub.expires_at < now) {
    db.prepare('UPDATE subscriptions SET status = ? WHERE id = ?').run('expired', sub.id);
    sub.status = 'expired';
    db.prepare('UPDATE accounts SET is_active = 0 WHERE user_id = ?').run(userId);
  }
  const plan = getPlan(sub.plan_id) || getPlan('free');
  return { ...sub, plan };
}

// How many accounts this user may have RIGHT NOW (0 when expired/no plan).
function activeAccountLimit(userId) {
  const sub = getSubscription(userId);
  if (!sub || sub.status !== 'active' || (sub.expires_at && sub.expires_at < Date.now())) return 0;
  return Math.max(0, sub.account_limit || 0);
}

// Pause any accounts beyond the limit so the scheduler stops pushing to them.
function applyAccountLimit(userId, limit) {
  const accounts = db.prepare('SELECT * FROM accounts WHERE user_id = ? ORDER BY created_at ASC').all(userId) || [];
  accounts.forEach((a, i) => {
    const active = i < limit ? 1 : 0;
    if (a.is_active !== active) {
      db.prepare('UPDATE accounts SET is_active = ? WHERE id = ?').run(active, a.id);
    }
  });
}

// Set the user's plan. `opts`:
//   days         - explicit duration (admin manual grants / trial)
//   keepExpiry   - upgrade: keep the existing expiry date
//   extend       - renewal: extend the existing expiry by 30 days
//   source       - where the change came from (trial/purchase/upgrade/admin)
function activatePlan(userId, planId, opts = {}) {
  const plan = getPlan(planId);
  if (!plan) throw new Error('unknown plan: ' + planId);
  const now = Date.now();
  const sub = getSubscription(userId);
  const prevExpiry = sub && sub.expires_at ? sub.expires_at : null;

  let expiresAt;
  if (opts.days != null) {
    expiresAt = now + Math.max(1, Number(opts.days)) * DAY;
  } else if (opts.keepExpiry && prevExpiry && prevExpiry > now) {
    expiresAt = prevExpiry;
  } else if (opts.extend && prevExpiry && prevExpiry > now) {
    expiresAt = prevExpiry + 30 * DAY;
  } else {
    expiresAt = now + 30 * DAY;
  }

  if (sub && sub.id) {
    db.prepare(
      'UPDATE subscriptions SET plan_id = ?, account_limit = ?, status = ?, started_at = ?, expires_at = ?, source = ?, updated_at = ? WHERE id = ?'
    ).run(plan.id, plan.accounts, 'active', now, expiresAt, opts.source || 'purchase', now, sub.id);
  } else {
    db.prepare(
      'INSERT INTO subscriptions (user_id, plan_id, account_limit, status, started_at, expires_at, source, updated_at, created_at) VALUES (?,?,?,?,?,?,?,?,?)'
    ).run(userId, plan.id, plan.accounts, 'active', now, expiresAt, opts.source || 'purchase', now, now);
  }
  applyAccountLimit(userId, plan.accounts);
  auth.logActivity(userId, null, null, 'billing', `Plan set to ${plan.name} (${plan.accounts} accounts)`, 1);
  return getSubscription(userId);
}

// Adjust a subscription manually (admin): +N/-N days and/or a new limit.
function adjustSubscription(userId, { days, limit }) {
  const sub = getSubscription(userId);
  const now = Date.now();
  let expiresAt = sub.expires_at && sub.expires_at > now ? sub.expires_at : now + 30 * DAY;
  if (days != null && Number.isFinite(Number(days)) && Number(days) !== 0) {
    expiresAt = expiresAt + Number(days) * DAY;
    if (expiresAt < now) expiresAt = now; // never go negative
  }
  const newLimit = limit != null && Number.isFinite(Number(limit)) ? Math.max(0, Math.round(Number(limit))) : sub.account_limit;
  const plan = getPlan(sub.plan_id) || getPlan('free');
  const status = expiresAt > now ? 'active' : 'expired';
  db.prepare(
    'UPDATE subscriptions SET account_limit = ?, status = ?, expires_at = ?, updated_at = ? WHERE id = ?'
  ).run(newLimit, status, expiresAt, now, sub.id);
  if (status === 'expired') {
    db.prepare('UPDATE accounts SET is_active = 0 WHERE user_id = ?').run(userId);
  } else {
    applyAccountLimit(userId, newLimit);
  }
  auth.logActivity(userId, null, null, 'billing', `Subscription adjusted by admin (${days != null ? (days > 0 ? '+' : '') + days + ' days' : 'no day change'}, limit ${newLimit})`, 1);
  return getSubscription(userId);
}

// ---- Price math -----------------------------------------------------------

// How much a user must pay to move to `planId`:
//   - Active paid plan + higher target  -> pay the DIFFERENCE, keep expiry (upgrade)
//   - Active paid plan + same target    -> full price, extend by 30 days (renew)
//   - Active paid plan + lower target   -> free switch, keep expiry (downgrade)
//   - No active paid plan (trial/expired) -> full price, fresh 30 days (purchase)
function computeAmount(userId, planId) {
  const target = getPlan(planId);
  if (!target) throw new Error('invalid plan');
  const sub = getSubscription(userId);
  const now = Date.now();
  const activePaid =
    sub && sub.status === 'active' && sub.plan_id !== 'free' && sub.expires_at && sub.expires_at > now ? sub : null;

  if (target.id === 'free') {
    if (sub && sub.plan_id === 'free' && sub.status === 'active' && sub.expires_at && sub.expires_at > now) {
      return { amount: 0, action: 'keep', upgradeFrom: null, keepExpiry: true, extend: false, toFree: false, noop: true };
    }
    return { amount: 0, action: 'downgrade', upgradeFrom: activePaid ? activePaid.plan_id : null, keepExpiry: false, extend: false, toFree: true };
  }
  if (activePaid) {
    const cur = getPlan(activePaid.plan_id);
    if (target.price > cur.price) {
      return { amount: target.price - cur.price, action: 'upgrade', upgradeFrom: activePaid.plan_id, keepExpiry: true, extend: false };
    }
    if (target.id === activePaid.plan_id) {
      return { amount: target.price, action: 'renew', upgradeFrom: activePaid.plan_id, keepExpiry: false, extend: true };
    }
    return { amount: 0, action: 'downgrade', upgradeFrom: activePaid.plan_id, keepExpiry: true, extend: false };
  }
  return { amount: target.price, action: 'purchase', upgradeFrom: null, keepExpiry: false, extend: false };
}

// ---- OxaPay ---------------------------------------------------------------

// Create an invoice at OxaPay. OxaPay hosts the payment page, so the customer
// is redirected to payment_url and picks any supported coin there.
async function createInvoice({ amountUsd, orderId, description }) {
  if (!OXAPAY_KEY) throw new Error('OxaPay is not configured on this server');
  const u = urls();
  const res = await fetch(`${OXAPAY_API}/payment/invoice`, {
    method: 'POST',
    headers: { merchant_api_key: OXAPAY_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      amount: amountUsd,
      currency: 'USD',
      lifetime: 60,
      fee_paid_by_payer: 1,
      under_paid_coverage: 0,
      mixed_payment: 0,
      callback_url: u.ipn,
      return_url: u.success,
      order_id: orderId,
      description
    })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.status !== 200 || !data.data) {
    const err = new Error((data.error && (data.error.message || data.message)) || (data.message || `OxaPay error (${res.status})`));
    err.code = data.error && data.error.type;
    throw err;
  }
  return data.data; // { track_id, payment_url, expired_at, date }
}

// Query the current status of an invoice by its track_id.
async function getInvoice(trackId) {
  if (!OXAPAY_KEY) throw new Error('OxaPay is not configured on this server');
  const res = await fetch(`${OXAPAY_API}/payment/${trackId}`, { headers: { merchant_api_key: OXAPAY_KEY } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.data) throw new Error((data.message) || `OxaPay status error (${res.status})`);
  return data.data;
}

function orderRow(orderId) {
  return db.prepare('SELECT * FROM payments WHERE order_id = ?').get(orderId) || null;
}

// Create a payment order for the given plan. Returns { applied, order, amount,
// plan, action, upgradeFrom } - when the amount is 0 (free downgrade) the plan
// is switched instantly and no crypto order is created.
async function createPayment(userId, planId) {
  const plan = getPlan(planId);
  if (!plan) throw new Error('invalid plan');
  const { amount, action, upgradeFrom, keepExpiry, extend, toFree, noop } = computeAmount(userId, planId);

  if (amount <= 0) {
    if (noop) {
      return { applied: true, amount: 0, action, upgradeFrom, plan, order: null };
    }
    if (toFree) {
      // Switching back to the free plan cancels the paid subscription immediately.
      const sub = getSubscription(userId);
      const now = Date.now();
      if (sub && sub.id) {
        db.prepare('UPDATE subscriptions SET plan_id = ?, status = ?, expires_at = ?, account_limit = 0, updated_at = ? WHERE id = ?')
          .run('free', 'expired', now, now, sub.id);
      }
      db.prepare('UPDATE accounts SET is_active = 0 WHERE user_id = ?').run(userId);
    } else {
      activatePlan(userId, planId, { keepExpiry: true, source: 'switch' });
    }
    return { applied: true, amount: 0, action, upgradeFrom, plan, order: null };
  }

  const orderId = 'GG-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).slice(2, 8).toUpperCase();
  const created = Date.now();
  db.prepare(
    'INSERT INTO payments (user_id, order_id, plan_id, action, amount_usd, upgrade_from, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)'
  ).run(userId, orderId, plan.id, action, amount, upgradeFrom || null, 'waiting', created, created);

  const invoice = await createInvoice({ amountUsd: amount, orderId, description: `${plan.name} plan - GitGreen` });
  db.prepare(
    'UPDATE payments SET np_payment_id = ?, pay_url = ?, status = ?, updated_at = ? WHERE order_id = ?'
  ).run(
    invoice.track_id ? Number(invoice.track_id) || invoice.track_id : null,
    invoice.payment_url || null,
    'waiting',
    Date.now(),
    orderId
  );

  const order = orderRow(orderId);
  return { applied: false, amount, action, upgradeFrom, plan, order };
}

// Activate the subscription for a paid order once, and only once.
function applyOrder(order) {
  if (!order || order.applied) return false;
  const st = String(order.status || '').toLowerCase();
  if (st === 'paid' || st === 'manual_accept') {
    const keepExpiry = order.action === 'upgrade';
    activatePlan(order.user_id, order.plan_id, { keepExpiry, source: order.action });
    db.prepare('UPDATE payments SET applied = 1, updated_at = ? WHERE id = ?').run(Date.now(), order.id);
    auth.logActivity(order.user_id, null, null, 'billing', `${order.action === 'upgrade' ? 'Upgraded' : 'Paid'} plan ($${order.amount_usd}) via crypto`, 1);
    return true;
  }
  return false;
}

// Re-query OxaPay for the live status of an order, then apply if paid. This is
// the safety net for customers who pay but never come back to the site.
async function syncOrder(orderId) {
  const order = orderRow(orderId);
  if (!order) throw new Error('order not found');
  if (order.np_payment_id && !order.applied) {
    try {
      const inv = await getInvoice(order.np_payment_id);
      if (inv.status && String(inv.status).toLowerCase() !== String(order.status).toLowerCase()) {
        db.prepare('UPDATE payments SET status = ?, updated_at = ? WHERE id = ?').run(inv.status, Date.now(), order.id);
      }
    } catch (e) {
      // keep the last known status; the webhook or next poll will fix it
    }
  }
  const updated = orderRow(orderId);
  applyOrder(updated);
  return updated;
}

// OxaPay webhook. The HMAC-SHA512 signature is computed over the raw POST body
// using the merchant API key as the secret, and sent in the "HMAC" header.
async function handleIpn(rawBody, hmacHeader, payload) {
  if (!OXAPAY_KEY) throw new Error('OxaPay is not configured');
  if (!rawBody || !hmacHeader) throw new Error('missing webhook signature');
  const calculated = crypto.createHmac('sha512', OXAPAY_KEY).update(rawBody).digest('hex');
  if (calculated !== hmacHeader) throw new Error('bad hmac signature');

  const orderId = payload.order_id || payload.orderId || null;
  const trackId = payload.track_id != null ? payload.track_id : payload.trackId != null ? payload.trackId : null;
  let order = null;
  if (orderId) order = orderRow(orderId);
  if (!order && trackId) order = db.prepare('SELECT * FROM payments WHERE np_payment_id = ?').get(trackId) || null;
  if (!order) throw new Error('order not found for webhook');

  const status = payload.status || order.status;
  db.prepare(
    'UPDATE payments SET status = ?, ipn_payload = ?, np_payment_id = COALESCE(?, np_payment_id), updated_at = ? WHERE id = ?'
  ).run(status, JSON.stringify(payload), trackId != null ? trackId : null, Date.now(), order.id);

  const updated = orderRow(order.order_id);
  applyOrder(updated);
  return updated;
}

function serializeSub(userId) {
  const sub = getSubscription(userId);
  const used = db.prepare('SELECT COUNT(*) AS n FROM accounts WHERE user_id = ?').get(userId).n;
  const now = Date.now();
  const active = sub.status === 'active' && sub.expires_at && sub.expires_at > now;
  return {
    plan: sub.plan,
    plan_id: sub.plan_id,
    status: sub.status,
    source: sub.source,
    active,
    account_limit: active ? sub.account_limit : 0,
    accounts_used: used,
    started_at: sub.started_at || null,
    expires_at: active ? sub.expires_at : null,
    days_left: active && sub.expires_at ? Math.max(0, Math.ceil((sub.expires_at - now) / DAY)) : 0
  };
}

module.exports = {
  PLANS,
  getPlan,
  configured,
  getSubscription,
  activeAccountLimit,
  applyAccountLimit,
  activatePlan,
  adjustSubscription,
  computeAmount,
  createPayment,
  syncOrder,
  handleIpn,
  serializeSub,
  urls
};