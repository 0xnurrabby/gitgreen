const path = require('path');
const fs = require('fs');
const CATALOG = require('../content/catalog');
const { GENERATORS } = require('../content/generators');
const { STEPS, SEQUENCE, resolveStep } = require('../content/evolve');
const { MESSAGES } = require('../content/commitMessages');
const { slugify } = require('./sanitize');
const db = require('./db');
const { decrypt } = require('./crypto');
const github = require('./github');
const auth = require('./auth');
const { WORK_DIR } = require('./config');

const FEATURE_WORDS = ['search', 'config', 'output', 'input', 'logging', 'export', 'parser', 'runner', 'cache', 'retry', 'validation', 'sync', 'format', 'filter', 'index', 'auth', 'import', 'render', 'watch', 'queue'];

function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function buildFeatureWord(def) {
  const base = FEATURE_WORDS[Math.floor(Math.random() * FEATURE_WORDS.length)];
  return base;
}

function buildMessage(type, def) {
  const pool = MESSAGES[type] || MESSAGES.chore;
  let msg = pick(pool);
  if (msg.includes('{feature}')) msg = msg.replace('{feature}', buildFeatureWord(def));
  return msg;
}

function getCatById(id) {
  return CATALOG.find((c) => c.id === Number(id)) || null;
}

async function randomUnused(userId, excludeIds, recentTopics = [], existsOnGithub = null) {
  const used = new Set(
    (db.prepare('SELECT slug FROM projects WHERE user_id = ?').all(userId) || []).map((r) => r.slug)
  );
  const ex = new Set(excludeIds || []);
  let available = CATALOG.filter((c) => !used.has(c.slug) && !ex.has(c.id));
  if (available.length === 0) return null;
  // Prefer topics that have not been worked on recently, so the whole catalog
  // stays mixed instead of draining one topic at a time.
  const fresh = available.filter((c) => !recentTopics.includes(c.category));
  let pool = fresh.length ? fresh : available;

  // If the caller gave us a way to check GitHub, avoid picking a project whose
  // base repo name already exists there. This prevents duplicate repos like
  // "dicepoker-2", "dicepoker-3" when a repo was created on GitHub but not
  // recorded locally (e.g. after a failed push). Try a handful of candidates.
  if (typeof existsOnGithub === 'function') {
    for (let attempt = 0; attempt < 12 && pool.length > 0; attempt++) {
      const cat = pick(pool);
      let taken = false;
      try { taken = await existsOnGithub(cat.slug); } catch (e) { taken = false; }
      if (!taken) return cat;
      // That project already exists on GitHub, so it's no longer usable.
      pool = pool.filter((c) => c.id !== cat.id);
      used.add(cat.slug);
      const fresh2 = pool.filter((c) => !recentTopics.includes(c.category));
      if (fresh2.length) pool = fresh2;
    }
    return null;
  }

  return pick(pool);
}

function buildProjectDef(cat) {
  return {
    id: cat.id,
    title: cat.title,
    slug: cat.slug,
    module: cat.module,
    jsName: cat.jsName,
    category: cat.category,
    blurb: cat.blurb,
    tagline: cat.blurb,
    stack: cat.stack,
    platform: cat.platform,
    generatorId: cat.generatorId
  };
}

function generateIntoDir(def, dir) {
  const gen = GENERATORS[def.generatorId];
  if (!gen) throw new Error(`no generator for ${def.generatorId}`);
  const files = gen.generator(def, dir);
  fs.mkdirSync(dir, { recursive: true });
  for (const [filePath, content] of files) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content);
  }
  return files.length;
}

function applyEvolution(def, dir, stepKey) {
  const step = STEPS[stepKey];
  if (!step) return 0;
  const files = step.files(def, dir);
  for (const [filePath, content] of files) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content);
  }
  return files.length;
}

// Create a brand new repo with a fresh generated project.
async function createProject(user, accountRow, cat, commitDate) {
  const token = decrypt(accountRow.token_enc);
  if (!token) throw new Error('token not available for account');

  const def = buildProjectDef(cat);
  const workDir = path.join(WORK_DIR, accountRow.github_username, def.slug);

  let repoName = def.slug;
  if (await github.repoExists(token, accountRow.github_username, repoName)) {
    let n = 2;
    while (await github.repoExists(token, accountRow.github_username, `${def.slug}-${n}`)) n += 1;
    repoName = `${def.slug}-${n}`;
  }

  def.repoCloneUrl = `https://github.com/${accountRow.github_username}/${repoName}.git`;

  // Use the pre-staged copy when available, then regenerate so the README
  // carries the real repo URL.
  const staged = path.join(WORK_DIR, '_catalog', def.slug);
  if (fs.existsSync(staged)) {
    fs.cpSync(staged, workDir, { recursive: true });
  }
  generateIntoDir(def, workDir);

  await github.createRepo(token, {
    name: repoName,
    description: `${def.title}: ${def.blurb}`,
    private: false
  });

  const commitMessage = pick(MESSAGES.create);
  const repoUrl = await github.pushToGitHub({
    token,
    owner: accountRow.github_username,
    repoName,
    dir: workDir,
    branch: 'main',
    authorName: accountRow.github_username,
    authorEmail: `${accountRow.github_username}@users.noreply.github.com`,
    commitMessage,
    commitDate
  });

  const info = db.prepare(`
    INSERT INTO projects (user_id, account_id, slug, title, category, stack, description, status, repo_name, repo_url, default_branch, commits_done, evo_index, work_dir, created_at, pushed_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    user.id, accountRow.id, def.slug, def.title, def.category, def.stack, def.blurb,
    'pushed', repoName, repoUrl, 'main', 1, 0, workDir, auth.now(), auth.now()
  );
  const projectId = Number(info.lastInsertRowid);

  db.prepare('UPDATE accounts SET last_used_at = ?, last_error = NULL WHERE id = ?').run(auth.now(), accountRow.id);
  auth.logActivity(user.id, accountRow.id, projectId, 'create', `Created ${repoName} (${commitMessage}) - https://github.com/${accountRow.github_username}/${repoName}`, 1);

  return { projectId, repoName, repoUrl, commits: 1 };
}

// Add an incremental commit to an existing project repo (evolution step).
async function evolveProject(user, accountRow, projectRow, commitDate) {
  const token = decrypt(accountRow.token_enc);
  if (!token) throw new Error('token not available for account');

  const cat = CATALOG.find((c) => c.slug === projectRow.slug);
  const next = projectRow.evo_index || 0;
  const def = cat
    ? { ...buildProjectDef(cat), evoIndex: next }
    : {
        id: projectRow.id,
        title: projectRow.title,
        slug: projectRow.slug,
        module: slugify(projectRow.title).replace(/-/g, '_'),
        jsName: projectRow.title.replace(/[^A-Za-z]/g, ''),
        category: projectRow.category || 'General',
        blurb: projectRow.description || projectRow.title,
        tagline: projectRow.description || projectRow.title,
        stack: projectRow.stack || 'Python',
        platform: 'cross-platform',
        generatorId: 'python-cli',
        evoIndex: next
      };

  const workDir = path.join(WORK_DIR, accountRow.github_username, projectRow.slug);
  // After a server change the local working copy is gone; restore it from
  // GitHub so evolution continues exactly where it left off.
  await github.ensureClone({
    token,
    owner: accountRow.github_username,
    repoName: projectRow.repo_name,
    dir: workDir,
    branch: projectRow.default_branch || 'main'
  });
  db.prepare('UPDATE projects SET work_dir = ? WHERE id = ?').run(workDir, projectRow.id);

  // Pick the next step that actually produces new content, so every commit
  // adds genuine material and repos grow over many days.
  const resolved = resolveStep(def, workDir, next);
  if (!resolved) return null;
  const { step, files } = resolved;

  for (const [fp, content] of files) {
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    fs.writeFileSync(fp, content);
  }
  const applied = files.length;

  // Module steps get a varied, feature-style message; other steps keep their
  // descriptive default so every repo's history reads naturally.
  const commitMessage = String(resolved.key).startsWith('add-modules') ? buildMessage('feat', def) : step.message;
  await github.pushToGitHub({
    token,
    owner: accountRow.github_username,
    repoName: projectRow.repo_name,
    dir: workDir,
    branch: projectRow.default_branch || 'main',
    authorName: accountRow.github_username,
    authorEmail: `${accountRow.github_username}@users.noreply.github.com`,
    commitMessage,
    commitDate
  });

  db.prepare('UPDATE projects SET commits_done = commits_done + 1, evo_index = ?, pushed_at = ? WHERE id = ?')
    .run(next + 1, auth.now(), projectRow.id);
  db.prepare('UPDATE accounts SET last_used_at = ?, last_error = NULL WHERE id = ?').run(auth.now(), accountRow.id);
      auth.logActivity(user.id, accountRow.id, projectRow.id, 'evolve', `Committed to ${projectRow.repo_name}: ${commitMessage} - ${projectRow.repo_url}`, 1);

  return { projectId: projectRow.id, repoName: projectRow.repo_name, repoUrl: projectRow.repo_url, commits: 1, commitMessage };
}

module.exports = { createProject, evolveProject, randomUnused, getCatById, buildProjectDef, generateIntoDir, buildMessage };
