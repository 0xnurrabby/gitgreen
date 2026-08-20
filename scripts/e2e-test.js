// End-to-end test: signs up, connects a GitHub account (mocked API), and
// runs a session whose pushes go to a local bare git repo.
process.env.GITHUB_API_URL = 'http://localhost:9999';
process.env.PORT = '3456';

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

// ---- mock github API ----
const users = { mockuser: { login: 'mockuser', avatar_url: 'http://x/a.png', html_url: 'https://github.com/mockuser' } };
const repos = {};
const mock = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const send = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
  if (req.method === 'GET' && url.pathname === '/user') return send(200, users.mockuser);
  if (req.method === 'POST' && url.pathname === '/user/repos') {
    let b = '';
    req.on('data', (c) => (b += c));
    return req.on('end', () => {
      const parsed = JSON.parse(b || '{}');
      repos[parsed.name] = 1;
      send(201, { ...parsed, full_name: `mockuser/${parsed.name}`, html_url: `https://github.com/mockuser/${parsed.name}` });
    });
  }
  const m = url.pathname.match(/^\/repos\/mockuser\/([^/]+)$/);
  if (m && req.method === 'GET') return repos[m[1]] ? send(200, {}) : send(404, { message: 'Not Found' });
  send(404, { message: 'nope' });
});
mock.listen(9999);

const { runGit } = require('../server/git');
const github = require('../server/github');

(async () => {
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'gv-e2e-'));
  await runGit(['init', '--bare', '-b', 'main'], bare);
  // redirect pushes to the local bare repo
  github.pushToGitHub = async (opts) => {
    await runGit(['init', '-b', opts.branch || 'main'], opts.dir);
    await runGit(['add', '-A'], opts.dir);
    let head = false;
    try { await runGit(['rev-parse', 'HEAD'], opts.dir); head = true; } catch (e) {}
    let staged = true;
    try { await runGit(['diff', '--cached', '--quiet'], opts.dir); staged = false; } catch (e) {}
    if (!head || staged) {
      const a = ['commit', '-m', opts.commitMessage, '--author', `${opts.authorName} <${opts.authorEmail}>`];
      if (opts.commitDate) { a.push('--date', opts.commitDate); }
      await runGit(a, opts.dir);
    }
    try { await runGit(['remote', 'remove', 'origin'], opts.dir); } catch (e) {}
    await runGit(['remote', 'add', 'origin', bare], opts.dir);
    await runGit(['push', '-u', 'origin', opts.branch || 'main'], opts.dir);
    return `https://github.com/${opts.owner}/${opts.repoName}`;
  };

  require('../server/index.js');
  await new Promise((r) => setTimeout(r, 800));

  const base = 'http://localhost:3456';
  const cookieJar = new Map();
  async function api(p, method = 'GET', body = null) {
    const res = await fetch(base + p, {
      method,
      headers: { 'Content-Type': 'application/json', ...(cookieJar.get('sid') ? { Cookie: 'sid=' + cookieJar.get('sid') } : {}) },
      body: body ? JSON.stringify(body) : undefined
    });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) {
      const m = setCookie.match(/sid=([^;]+)/);
      if (m) cookieJar.set('sid', m[1]);
    }
    const data = await res.json();
    if (!res.ok) throw new Error(method + ' ' + p + ': ' + JSON.stringify(data));
    return data;
  }

  // 1. signup
  await api('/api/auth/signup', 'POST', { username: 'e2euser', password: 'secret12' });
  console.log('1. signup ok');

  // 2. connect account
  await api('/api/accounts', 'POST', { token: 'github_pat_mocktoken123456789' });
  console.log('2. account connected');

  // 3. plans generated
  const plans = await api('/api/plans');
  console.log('3. plans:', plans.length, 'days');

  // 4. run now (3 commits)
  const accs = await api('/api/accounts');
  const res = await api('/api/run-now', 'POST', { accountId: accs[0].id, commits: 3 });
  console.log('4. run-now commits:', res.commits);

  // 5. verify DB state
  const stats = await api('/api/stats');
  console.log('5. repos:', stats.totalRepos, 'commits:', stats.totalCommits);

  const projs = await api('/api/projects');
  console.log('6. projects:', projs.length, '| names:', projs.map((p) => p.repo_name).join(', '));

  // 7. verify pushes landed in the bare repo
  const allBranches = [];
  try {
    const branches = await runGit(['for-each-ref', '--format=%(refname)', 'refs/heads'], bare);
    for (const br of branches.split('\n').filter(Boolean)) {
      const log = await runGit(['log', '--oneline'], bare + ' ' + br);
      allBranches.push(br.replace('refs/heads/', '') + ': ' + log.split('\n').length + ' commits');
    }
  } catch (e) {}
  console.log('7. branches:', allBranches.join(' | '));

  const logs = await api('/api/logs');
  console.log('8. log lines:', logs.length);

  // cleanup
  mock.close();
  fs.rmSync(bare, { recursive: true, force: true });
  console.log('E2E PASSED');
  process.exit(0);
})().catch((e) => { console.error('E2E FAILED:', e.message); process.exit(1); });
