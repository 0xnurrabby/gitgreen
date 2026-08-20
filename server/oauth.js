const crypto = require('crypto');
const db = require('./db');
const { encrypt, decrypt } = require('./crypto');
const { HOST } = require('./config');

const SCOPES = 'repo';
const AUTHORIZE_URL = 'https://github.com/login/oauth/authorize';
const TOKEN_URL = 'https://github.com/login/oauth/access_token';

function getConfig() {
  const rows = db.prepare('SELECT key, value FROM app_config').all() || [];
  const map = {};
  for (const r of rows) map[r.key] = r.value;
  const secret = decrypt(map.oauth_client_secret_enc);
  return {
    clientId: map.oauth_client_id || '',
    clientSecret: secret || '',
    configured: !!(map.oauth_client_id && secret)
  };
}

function saveConfig(clientId, clientSecret) {
  const secretEnc = encrypt(String(clientSecret).trim());
  db.prepare('INSERT INTO app_config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run('oauth_client_id', String(clientId).trim());
  db.prepare('INSERT INTO app_config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run('oauth_client_secret_enc', secretEnc);
}

function redirectUri() {
  return `${HOST}/api/auth/github/callback`;
}

function buildAuthorizeUrl(state) {
  const p = new URLSearchParams({
    client_id: getConfig().clientId,
    redirect_uri: redirectUri(),
    scope: SCOPES,
    state
  });
  return `${AUTHORIZE_URL}?${p.toString()}`;
}

async function exchangeCode(code) {
  const cfg = getConfig();
  const body = new URLSearchParams({
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    code,
    redirect_uri: redirectUri()
  });
  const res = await fetch(TOKEN_URL, { method: 'POST', body, headers: { Accept: 'application/json' } });
  const data = await res.json();
  if (data.error) throw new Error(data.error_description || data.error);
  if (!data.access_token) throw new Error('no access token returned');
  return data.access_token;
}

function newState() {
  return crypto.randomBytes(16).toString('hex');
}

module.exports = { getConfig, saveConfig, redirectUri, buildAuthorizeUrl, exchangeCode, newState, SCOPES };
