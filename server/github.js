const { runGit } = require('./git');
const { WORK_DIR } = require('./config');
const path = require('path');
const fs = require('fs');

const API = process.env.GITHUB_API_URL || 'https://api.github.com';

async function gh(pathname, token, options = {}) {
  const res = await fetch(`${API}${pathname}`, {
    method: options.method || 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'gitvibe',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json'
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) {
    const msg = (data.message && (Array.isArray(data.errors) ? data.message + ' ' + data.errors.map(e => e.message).join('; ') : data.message)) || `HTTP ${res.status}`;
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  return data;
}

async function getUser(token) {
  const u = await gh('/user', token);
  return {
    login: u.login,
    avatar_url: u.avatar_url,
    profile_url: u.html_url
  };
}

// Verify a token and return the scopes GitHub grants it. GitHub returns the
// granted scopes in the x-oauth-scopes header of any authenticated request.
async function checkToken(token) {
  const res = await fetch(`${API}/`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      'User-Agent': 'gitvibe',
      'X-GitHub-Api-Version': '2022-11-28'
    }
  });
  const raw = res.headers.get('x-oauth-scopes') || '';
  const scopes = raw ? raw.split(',').map((s) => s.trim()).filter(Boolean) : [];
  if (res.status === 401) {
    const err = new Error('token is invalid or expired');
    err.status = 401;
    throw err;
  }
  if (!res.ok) {
    const err = new Error(`GitHub responded ${res.status}`);
    err.status = res.status;
    throw err;
  }
  const me = await getUser(token);
  return { login: me.login, avatar_url: me.avatar_url, profile_url: me.profile_url, scopes };
}

async function createRepo(token, { name, description, private: isPrivate = false }) {
  return gh('/user/repos', token, {
    method: 'POST',
    body: {
      name,
      description: description || '',
      private: isPrivate,
      auto_init: false,
      has_issues: true,
      has_wiki: true
    }
  });
}

function repoExists(token, owner, name) {
  return gh(`/repos/${owner}/${name}`, token).then(() => true).catch(e => {
    if (e.status === 404) return false;
    throw e;
  });
}

async function pushToGitHub({ token, owner, repoName, dir, branch = 'main', authorName, authorEmail, commitMessage, commitDate, force = false }) {
  fs.mkdirSync(dir, { recursive: true });
  await runGit(['init', '-b', branch], dir);
  await runGit(['add', '-A'], dir);
  let hasHead = false;
  try {
    await runGit(['rev-parse', 'HEAD'], dir);
    hasHead = true;
  } catch (e) { /* no commits yet */ }
  let staged = true;
  try {
    await runGit(['diff', '--cached', '--quiet'], dir);
    staged = false;
  } catch (e) { /* staged changes exist */ }
  if (!hasHead || staged) {
    // Pass author AND committer identity explicitly so a machine without git
    // config (e.g. a fresh Railway container) can never fail with
    // "Committer identity unknown".
    const commitArgs = [
      '-c', `user.name=${authorName}`,
      '-c', `user.email=${authorEmail}`,
      'commit', '-m', commitMessage,
      '--author', `${authorName} <${authorEmail}>`
    ];
    const env = {
      GIT_AUTHOR_NAME: authorName,
      GIT_AUTHOR_EMAIL: authorEmail,
      GIT_COMMITTER_NAME: authorName,
      GIT_COMMITTER_EMAIL: authorEmail
    };
    if (commitDate) {
      const d = new Date(commitDate);
      const iso = d.toISOString();
      commitArgs.push('--date', iso);
      env.GIT_AUTHOR_DATE = iso;
      env.GIT_COMMITTER_DATE = iso;
    }
    await runGit(commitArgs, dir, env);
  }
  const remote = `https://x-access-token:${encodeURIComponent(token)}@github.com/${owner}/${repoName}.git`;
  try {
    await runGit(['remote', 'remove', 'origin'], dir);
  } catch (e) { /* none */ }
  await runGit(['remote', 'add', 'origin', remote], dir);
  const pushArgs = ['push', '-u', 'origin', branch];
  if (force) pushArgs.push('--force');
  try {
    await runGit(pushArgs, dir);
  } catch (err) {
    throw new Error(friendlyGitError(err, repoName));
  }
  return `https://github.com/${owner}/${repoName}`;
}

function projectWorkDir(accountKey, slug) {
  return path.join(WORK_DIR, accountKey, slug);
}

// Turn raw git/GitHub errors into friendly, actionable messages.
function friendlyGitError(err, repoName) {
  const m = String(err && err.message || err);
  if (/workflow scope/i.test(m) || /workflow/i.test(m) && /refusing|scope/i.test(m)) {
    return `Could not push ${repoName}: the token needs the "workflow" scope to change GitHub Actions files. Reconnect the account with a token that has both "repo" and "workflow" ticked.`;
  }
  if (/committer identity unknown/i.test(m)) {
    return `Could not push ${repoName}: git identity not configured. Try reconnecting the account.`;
  }
  if (/authentication failed|invalid username or password|401/i.test(m)) {
    return `Could not push ${repoName}: the token is invalid or expired. Create a fresh token and reconnect.`;
  }
  if (/permission to .* denied/i.test(m)) {
    return `Could not push ${repoName}: the token does not have permission to write to this repo.`;
  }
  if (/repository not found|404/i.test(m)) {
    return `Could not push ${repoName}: repository not found (token may lack access).`;
  }
  return `Could not push ${repoName}: ${m}`;
}

// Make sure a project's working copy exists locally. After a server change the
// work dir is gone, so clone it back from GitHub (all history is already
// pushed). Falls back to a pull when a checkout already exists.
async function ensureClone({ token, owner, repoName, dir, branch = 'main' }) {
  fs.mkdirSync(dir, { recursive: true });
  if (fs.existsSync(path.join(dir, '.git'))) {
    try {
      await runGit(['pull', '--ff-only', 'origin', branch], dir);
      return;
    } catch (e) { /* fall through to a fresh clone */ }
  }
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const remote = `https://x-access-token:${encodeURIComponent(token)}@github.com/${owner}/${repoName}.git`;
  await runGit(['clone', remote, dir]);
  try {
    await runGit(['checkout', branch], dir);
  } catch (e) { /* branch may already be checked out */ }
}

module.exports = { gh, getUser, checkToken, createRepo, repoExists, pushToGitHub, projectWorkDir, ensureClone, friendlyGitError };
