const { GENERATORS } = require('./generators');
const { slugify } = require('../server/sanitize');

const chunks = [
  require('./catalog/catalog-01.js'),
  require('./catalog/catalog-02.js'),
  require('./catalog/catalog-03.js'),
  require('./catalog/catalog-04.js')
];

const raw = [];
for (const chunk of chunks) {
  for (const entry of chunk) raw.push(entry);
}

// Uniqueness check
const seen = new Set();
for (const e of raw) {
  if (seen.has(e.t)) throw new Error(`Duplicate project title in catalog: ${e.t}`);
  seen.add(e.t);
  if (!GENERATORS[e.g]) throw new Error(`Unknown generator "${e.g}" for ${e.t}`);
}

function toModule(title) {
  return slugify(title).replace(/-/g, '_');
}

function toJsName(title) {
  const parts = slugify(title).split('-').filter(Boolean);
  return parts.map((p, i) => (i === 0 ? p : p[0].toUpperCase() + p.slice(1))).join('');
}

function platformFor(gen) {
  switch (gen) {
    case 'go-tool': return 'Go 1.22+';
    case 'chrome-extension': return 'Chromium';
    case 'react-app': return 'Node 18+';
    default: return 'cross-platform';
  }
}

const CATALOG = raw.map((entry, i) => ({
  id: i + 1,
  title: entry.t,
  category: entry.c,
  blurb: entry.b,
  generatorId: entry.g,
  stack: GENERATORS[entry.g].stack,
  slug: slugify(entry.t),
  module: toModule(entry.t),
  jsName: toJsName(entry.t),
  platform: platformFor(entry.g),
  tagline: `${entry.b}`
}));

module.exports = CATALOG;
