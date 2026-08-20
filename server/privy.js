const { PrivyClient } = require('@privy-io/server-auth');
const db = require('./db');
const { encrypt, decrypt } = require('./crypto');

// Privy credentials come from the environment (PRIVY_APP_ID,
// PRIVY_APP_SECRET, PRIVY_CLIENT_ID). Keep them in a .env file - never in
// the UI or the database.
function getConfig() {
  return {
    appId: process.env.PRIVY_APP_ID || '',
    clientId: process.env.PRIVY_CLIENT_ID || '',
    appSecret: process.env.PRIVY_APP_SECRET || '',
    configured: !!(process.env.PRIVY_APP_ID && process.env.PRIVY_APP_SECRET)
  };
}

function makeClient() {
  const cfg = getConfig();
  if (!cfg.configured) throw new Error('privy not configured');
  return new PrivyClient(cfg.appId, cfg.appSecret);
}

async function verifyToken(accessToken) {
  const client = makeClient();
  const claims = await client.verifyAuthToken(accessToken);
  return claims;
}

// Derive a friendly handle + the user's real email from the Privy user object.
function displayNameFor(user, did) {
  const accounts = (user && user.linkedAccounts) || [];
  for (const la of accounts) {
    if (la.type === 'github_oauth' && la.username) return String(la.username);
  }
  for (const la of accounts) {
    const mail = la.email || la.email_address || la.address;
    if (mail) return String(mail).split('@')[0];
  }
  const short = String(did).replace(/^did:privy:/, '').slice(0, 8);
  return 'user_' + short;
}

function emailFor(user) {
  const accounts = (user && user.linkedAccounts) || [];
  for (const la of accounts) {
    const mail = la.email || la.email_address || la.address;
    if (mail && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(mail))) return String(mail);
  }
  return null;
}

async function getUserInfo(claims) {
  const userId = claims.userId || claims.sub || '';
  let user = null;
  try {
    user = await makeClient().getUser(userId);
  } catch (e) {
    user = null;
  }
  return {
    did: userId,
    displayName: displayNameFor(user, userId),
    email: emailFor(user)
  };
}

module.exports = { getConfig, verifyToken, getUserInfo, displayNameFor, emailFor };
