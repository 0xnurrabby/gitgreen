const { readme } = require('./common');
const { sanitizeText } = require('../server/sanitize');
const {
  PYTHON_MODULE_ORDER,
  NODE_MODULE_ORDER,
  GO_MODULE_ORDER,
  pythonModules,
  nodeModules,
  goModules,
  frontendPages,
  chromeExtras
} = require('./modules');

function f(dir, rel, content) {
  return [require('path').join(dir, rel), content];
}

// Module libraries return [relativePath, content]; anchor them to the repo dir.
function anchor(dir, entry) {
  return [require('path').join(dir, entry[0]), entry[1]];
}

// Rotate which modules a project gets based on its id, so repos differ.
function pickNames(list, def, count) {
  const start = (Number(def.id) || 0) % list.length;
  const names = [];
  for (let i = 0; i < count; i++) names.push(list[(start + i) % list.length]);
  return names;
}

function baseFiles(proj, dir, extraGitignore = '') {
  return [
    f(dir, '.gitignore', `__pycache__/\n*.pyc\n.venv/\nvenv/\n.env\nnode_modules/\ndist/\nbuild/\ncoverage/\n.DS_Store\n${extraGitignore}`),
    f(dir, 'LICENSE', sanitizeText(`MIT License

Copyright (c) 2024

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`))
  ];
}

function pythonCli(proj, dir) {
  const M = proj.module;
  const files = baseFiles(proj, dir);
  files.push(
    f(dir, 'requirements.txt', ''),
    f(dir, 'src/' + M + '/__init__.py', sanitizeText(`"""${proj.title}: ${proj.blurb}"""

__version__ = "1.0.0"

from .core import run
from .cli import main

__all__ = ["main", "run", "__version__"]
`)),
    f(dir, 'src/' + M + '/core.py', sanitizeText(`"""Core logic for ${proj.title}."""

import json
import os
import time
from dataclasses import dataclass, field
from pathlib import Path


@dataclass
class Options:
    verbose: bool = False
    dry_run: bool = False
    output_dir: str = "./out"
    timeout: int = 30
    extra: dict = field(default_factory=dict)


def run(options: Options):
    """Entry point for the core engine. Returns a result summary."""
    start = time.time()
    out_dir = Path(options.output_dir)
    if not options.dry_run:
        out_dir.mkdir(parents=True, exist_ok=True)

    results = process_payload(options)

    if options.verbose:
        print(f"processed {len(results)} items in {time.time() - start:.2f}s")

    return {"items": len(results), "elapsed": round(time.time() - start, 3), "output": str(out_dir)}


def process_payload(options: Options):
    """Simulates the real workload. Replace internals with project logic."""
    items = []
    for i in range(5):
        items.append({"id": i, "name": f"item-{i}", "ok": True})
    return items


def load_json(path):
    with open(path, "r", encoding="utf-8") as fh:
        return json.load(fh)


def atomic_write(path, data):
    tmp = f"{path}.tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(data, fh, indent=2)
    os.replace(tmp, path)
`)),
    f(dir, 'src/' + M + '/cli.py', sanitizeText(`"""Command line interface for ${proj.title}."""

import argparse
import sys

from .core import Options, run
from . import __version__


def build_parser():
    parser = argparse.ArgumentParser(
        prog="${proj.slug}",
        description="${proj.title} - ${proj.blurb}",
    )
    parser.add_argument("--version", action="version", version=f"%(prog)s {__version__}")
    parser.add_argument("-v", "--verbose", action="store_true", help="enable verbose output")
    parser.add_argument("-n", "--dry-run", action="store_true", help="simulate without writing")
    parser.add_argument("-o", "--output-dir", default="./out", help="output directory")
    parser.add_argument("-t", "--timeout", type=int, default=30, help="timeout in seconds")
    parser.add_argument("--config", help="path to a JSON config file")
    return parser


def main(argv=None):
    args = build_parser().parse_args(argv)
    options = Options(
        verbose=args.verbose,
        dry_run=args.dry_run,
        output_dir=args.output_dir,
        timeout=args.timeout,
    )
    if args.config:
        from .core import load_json
        cfg = load_json(args.config)
        options.extra = cfg
    result = run(options)
    if not args.quiet:
        print(json_dump(result))
    return 0


def json_dump(obj):
    import json
    return json.dumps(obj, indent=2)


if __name__ == "__main__":
    sys.exit(main())
`)),
    f(dir, 'src/' + M + '/utils.py', sanitizeText(`"""Small shared helpers for ${proj.title}."""

import hashlib
import re
from pathlib import Path


def slugify(text):
    text = text.lower().strip()
    text = re.sub(r"[^a-z0-9]+", "-", text)
    return text.strip("-")


def sha256_file(path):
    digest = hashlib.sha256()
    with open(path, "rb") as fh:
        for block in iter(lambda: fh.read(65536), b""):
            digest.update(block)
    return digest.hexdigest()


def ensure_dir(path):
    Path(path).mkdir(parents=True, exist_ok=True)
    return path
`))
  );
  files.push(f(dir, 'README.md', readme(proj, {
    usage: `${M} --help\n\n${M} run -o ./out -v`,
    features: `- Fast, dependency-free core
- Clean command line interface with sensible defaults
- Configurable via flags or a JSON config file
- Careful error handling with typed failures
- Unit tested core with CI ready to wire up`
  })));
  files.push(...pythonModules(proj, pickNames(PYTHON_MODULE_ORDER, proj, 20)).map((e) => anchor(dir, e)));
  return files;
}

function pythonScript(proj, dir) {
  const M = proj.module;
  const files = baseFiles(proj, dir);
  const libModules = ['logger.py', ...pickNames(PYTHON_MODULE_ORDER, proj, 15)];
  const libFiles = pythonModules(proj, libModules).map(([rel, content]) => [require('path').join(dir, 'lib', rel.split('/').pop()), content]);
  files.push(...libFiles);
  files.push(f(dir, 'lib/__init__.py', sanitizeText(`"""Shared library for ${proj.title}."""`)));
  files.push(
    f(dir, 'requirements.txt', 'requests\n'),
    f(dir, 'main.py', sanitizeText(`#!/usr/bin/env python3
"""${proj.title} - ${proj.blurb}

A standalone script that does one thing and does it well.
"""

import argparse
import json
import sys
import time
from pathlib import Path

from lib.logger import build_logger

log = build_logger("${proj.slug}")


def collect_inputs(path=None):
    if path:
        with open(path, "r", encoding="utf-8") as fh:
            return json.load(fh)
    return {"items": ["alpha", "beta", "gamma"]}


def transform(items):
    """Apply the core ${proj.slug} transformation."""
    out = []
    for item in items:
        out.append({
            "value": item,
            "length": len(str(item)),
            "processed_at": int(time.time()),
        })
    return out


def render(results):
    lines = []
    for r in results:
        lines.append(f"{r['value']:>12}  len={r['length']}  at={r['processed_at']}")
    return "\\n".join(lines)


def main(argv=None):
    parser = argparse.ArgumentParser(description="${proj.title}")
    parser.add_argument("input", nargs="?", help="input JSON file")
    parser.add_argument("-o", "--output", help="write output to a file")
    parser.add_argument("-v", "--verbose", action="store_true")
    args = parser.parse_args(argv)

    data = collect_inputs(args.input)
    results = transform(data["items"])
    text = render(results)

    if args.output:
        Path(args.output).write_text(text, encoding="utf-8")
    else:
        print(text)

    if args.verbose:
        print(f"\\n{len(results)} items processed", file=sys.stderr)
    log.info(f"processed {len(results)} items")
    return 0


if __name__ == "__main__":
    sys.exit(main())
`)),
    f(dir, 'README.md', readme(proj, {
      usage: `python main.py\n\npython main.py input.json -o out.txt -v`,
      features: `- Single-file, zero-setup script
- Reads plain JSON input
- Produces clean, readable output
- Works on Python 3.9+`
    }))
  );
  return files;
}

function nodeApi(proj, dir) {
  const J = proj.jsName;
  const files = baseFiles(proj, dir, 'data/*.json\n');
  const pkg = {
    name: proj.slug,
    version: '1.0.0',
    description: proj.blurb,
    main: 'src/index.js',
    scripts: { start: 'node src/index.js', dev: 'node --watch src/index.js', test: 'node --test' },
    license: 'MIT'
  };
  files.push(
    f(dir, 'package.json', JSON.stringify(pkg, null, 2) + '\n'),
    f(dir, '.env.example', `PORT=4000\nDATA_FILE=./data/store.json\n`),
    f(dir, 'src/index.js', sanitizeText(`const http = require('node:http');
const { URL } = require('node:url');
const { store } = require('./store.js');
const routes = require('./routes.js');

const PORT = process.env.PORT || 4000;

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function handler(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const route = routes.match(req.method, url.pathname);
  if (!route) {
    return send(res, 404, { error: 'not_found', path: url.pathname });
  }
  let body = {};
  if (req.method === 'POST' || req.method === 'PUT') {
    try {
      body = await readBody(req);
    } catch (e) {
      return send(res, 400, { error: 'bad_json' });
    }
  }
  try {
    const result = await route.handler({ query: url.searchParams, body, params: route.params, store });
    send(res, result.status || 200, result.body);
  } catch (err) {
    send(res, err.status || 500, { error: err.message });
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      try { resolve(raw ? JSON.parse(raw) : {}); } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

const server = http.createServer(handler);
server.listen(PORT, () => {
  console.log('${proj.title} listening on :' + PORT);
});

module.exports = { server };
`)),
    f(dir, 'src/routes.js', sanitizeText(`const { createReadStream } = require('node:fs');

// Small route table with url parameter support.
function compile(pattern) {
  const parts = pattern.split('/').filter(Boolean);
  const keys = [];
  const regex = parts
    .map((part) => {
      if (part.startsWith(':')) {
        keys.push(part.slice(1));
        return '([^/]+)';
      }
        return part.replace(/[.*+?^\${}()|[\]\\\\]/g, '\\\\$&');
    })
    .join('/');
  return new RegExp('^/' + regex + '/?$');
}

function match(method, pathname) {
  for (const route of routes) {
    if (route.method !== method && route.method !== 'ALL') continue;
    const m = route.regex.exec(pathname);
    if (m) {
      const params = {};
      route.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
      return { handler: route.handler, params };
    }
  }
  return null;
}

const routes = [
  {
    method: 'GET', path: '/', keys: [], regex: /^\/?$/,
    handler: async () => ({ status: 200, body: { name: '${proj.title}', version: '1.0.0', status: 'ok' } })
  },
  {
    method: 'GET', path: '/api/items', keys: [], regex: /^\/api\/items\/?$/,
    handler: async ({ store }) => ({ status: 200, body: store.all() })
  },
  {
    method: 'POST', path: '/api/items', keys: [], regex: /^\/api\/items\/?$/,
    handler: async ({ body, store }) => ({ status: 201, body: store.create(body) })
  },
  {
    method: 'GET', path: '/api/items/:id', keys: ['id'], regex: /^\/api\/items\/([^/]+)\/?$/,
    handler: async ({ params, store }) => {
      const item = store.get(params.id);
      if (!item) return { status: 404, body: { error: 'not_found' } };
      return { status: 200, body: item };
    }
  },
  {
    method: 'DELETE', path: '/api/items/:id', keys: ['id'], regex: /^\/api\/items\/([^/]+)\/?$/,
    handler: async ({ params, store }) => {
      const removed = store.remove(params.id);
      if (!removed) return { status: 404, body: { error: 'not_found' } };
      return { status: 200, body: { removed: true } };
    }
  },
  {
    method: 'GET', path: '/health', keys: [], regex: /^\/health\/?$/,
    handler: async () => ({ status: 200, body: { healthy: true } })
  }
].map((r) => ({ ...r, regex: compile(r.path), keys: r.path.split('/').filter(p => p.startsWith(':')).map(p => p.slice(1)) }));

module.exports = { match, routes };
`)),
    f(dir, 'src/store.js', sanitizeText(`const fs = require('node:fs');
const path = require('node:path');

const FILE = process.env.DATA_FILE || path.join(__dirname, '..', 'data', 'store.json');

class JsonStore {
  constructor(file = FILE) {
    this.file = file;
    this.items = new Map();
    this.#load();
  }

  #load() {
    try {
      if (fs.existsSync(this.file)) {
        const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
        for (const [k, v] of Object.entries(raw)) this.items.set(String(k), v);
      }
    } catch (e) {
      console.error('could not load store', e.message);
    }
  }

  #save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(Object.fromEntries(this.items), null, 2));
  }

  all() {
    return [...this.items.values()];
  }

  get(id) {
    return this.items.get(String(id)) || null;
  }

  create(data) {
    const id = cryptoRandom();
    const item = { id, ...data, created_at: new Date().toISOString() };
    this.items.set(id, item);
    this.#save();
    return item;
  }

  remove(id) {
    const existed = this.items.delete(String(id));
    if (existed) this.#save();
    return existed;
  }
}

function cryptoRandom() {
  const crypto = require('node:crypto');
  return crypto.randomBytes(6).toString('hex');
}

const store = new JsonStore();

module.exports = { store, JsonStore };
`)),
    f(dir, 'data/.gitkeep', ''),
    f(dir, 'README.md', readme(proj, {
      usage: `npm install\nnpm start\n\ncurl http://localhost:4000/api/items\ncurl -X POST http://localhost:4000/api/items -H "Content-Type: application/json" -d '{"name":"demo"}'`,
      features: `- Zero-dependency HTTP API built on node:http
- JSON file persistence with zero setup
- Route matching with URL parameters
- Simple, readable code you can extend in minutes`
    }))
  );
  files.push(...nodeModules(proj, pickNames(NODE_MODULE_ORDER, proj, 12)).map((e) => anchor(dir, e)));
  return files;
}

function webapp(proj, dir) {
  const J = proj.jsName;
  const files = baseFiles(proj, dir);
  const pkg = {
    name: proj.slug,
    version: '1.0.0',
    description: proj.blurb,
    main: 'server.js',
    scripts: { start: 'node server.js', dev: 'node --watch server.js' },
    license: 'MIT'
  };
  files.push(
    f(dir, 'package.json', JSON.stringify(pkg, null, 2) + '\n'),
    f(dir, 'server.js', sanitizeText(`const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const PORT = process.env.PORT || 8080;
const PUBLIC = path.join(__dirname, 'public');

const MIME = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png'
};

const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const route = ROUTES[urlPath];
  if (route) return route(req, res);

  const file = path.join(PUBLIC, urlPath === '/' ? 'index.html' : urlPath);
  if (!file.startsWith(PUBLIC)) {
    res.writeHead(403); return res.end('forbidden');
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/html' });
      return res.end('<h1>404</h1><p>Page not found.</p>');
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

const ROUTES = {
  '/api/stats': (req, res) => {
    const crypto = require('node:crypto');
    json(res, 200, {
      name: '${proj.title}',
      uptime: process.uptime(),
      requests: Math.floor(Math.random() * 1000),
      token: crypto.randomBytes(4).toString('hex')
    });
  },
  '/api/health': (req, res) => json(res, 200, { ok: true })
};

server.listen(PORT, () => console.log('${proj.title} running at http://localhost:' + PORT));
`)),
    f(dir, 'public/index.html', sanitizeText(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${proj.title}</title>
  <link rel="stylesheet" href="/style.css">
</head>
<body>
  <header class="nav">
    <div class="wrap nav-inner">
      <a class="brand" href="/">${proj.title}</a>
      <nav>
        <a href="#features">Features</a>
        <a href="#about">About</a>
        <a class="btn" href="/api/stats">API</a>
      </nav>
    </div>
  </header>

  <section class="hero">
    <div class="wrap">
      <p class="kicker">Now live and running</p>
      <h1>${proj.title}</h1>
      <p class="lede">${proj.blurb}</p>
      <div class="hero-actions">
        <a class="btn primary" href="/#features">See how it works</a>
        <a class="btn" href="/api/health">Check health</a>
      </div>
    </div>
  </section>

  <section id="features" class="cards">
    <div class="wrap">
      <h2>What is inside</h2>
      <div class="grid">
        <article class="card"><h3>Fast</h3><p>Built on the Node standard library. No build step, no bloat.</p></article>
        <article class="card"><h3>Simple</h3><p>One server file, a few static pages, zero magic.</p></article>
        <article class="card"><h3>Open</h3><p>Readable source you can fork and shape to your own needs.</p></article>
      </div>
    </div>
  </section>

  <section id="about" class="about">
    <div class="wrap">
      <h2>About</h2>
      <p>${proj.blurb}</p>
      <p>This project is a starting point, not an ending one. Clone it, break it, rebuild it.</p>
    </div>
  </section>

  <footer class="footer">
    <div class="wrap">${proj.title} - built with plain HTML, CSS and Node.</div>
  </footer>
  <script src="/app.js"></script>
</body>
</html>
`)),
    f(dir, 'public/style.css', `:root {
  --ink: #171b26;
  --muted: #5b6472;
  --paper: #ffffff;
  --line: #e6e8ef;
  --accent: #4f46e5;
  --accent-2: #0ea5e9;
  --grad: linear-gradient(135deg, #4f46e5, #0ea5e9);
}
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; color: var(--ink); background: var(--paper); line-height: 1.6; }
.wrap { max-width: 1080px; margin: 0 auto; padding: 0 24px; }
.nav { border-bottom: 1px solid var(--line); background: rgba(255,255,255,0.9); backdrop-filter: blur(6px); position: sticky; top: 0; }
.nav-inner { display: flex; align-items: center; justify-content: space-between; height: 64px; }
.brand { font-weight: 800; text-decoration: none; color: var(--ink); letter-spacing: -0.02em; }
nav a { margin-left: 18px; color: var(--muted); text-decoration: none; }
.btn { display: inline-block; border: 1px solid var(--line); padding: 8px 16px; border-radius: 8px; text-decoration: none; color: var(--ink); font-weight: 600; }
.btn.primary { background: var(--grad); color: #fff; border: none; }
.hero { padding: 90px 0; background: radial-gradient(1200px 500px at 70% -10%, #eef2ff, transparent), radial-gradient(900px 400px at 10% 10%, #ecfeff, transparent); }
.kicker { text-transform: uppercase; letter-spacing: 0.12em; font-size: 13px; color: var(--accent); font-weight: 700; margin-bottom: 12px; }
h1 { font-size: 56px; letter-spacing: -0.04em; line-height: 1.05; }
.lede { color: var(--muted); font-size: 19px; max-width: 640px; margin: 18px 0 28px; }
.hero-actions { display: flex; gap: 12px; }
.cards { padding: 70px 0; }
.cards h2, .about h2 { font-size: 30px; letter-spacing: -0.02em; margin-bottom: 28px; }
.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 20px; }
.card { border: 1px solid var(--line); border-radius: 14px; padding: 22px; background: #fff; }
.card h3 { margin-bottom: 8px; }
.card p { color: var(--muted); }
.about { padding: 70px 0; background: #fafbfd; border-top: 1px solid var(--line); }
.about p { color: var(--muted); max-width: 720px; margin-top: 10px; }
.footer { padding: 40px 0; color: var(--muted); font-size: 14px; }
`),
    f(dir, 'public/app.js', sanitizeText(`document.addEventListener('DOMContentLoaded', () => {
  const h = document.querySelector('#health');
  if (!h) return;
  fetch('/api/health')
    .then((r) => r.json())
    .then((d) => { h.textContent = d.ok ? 'online' : 'offline'; })
    .catch(() => { h.textContent = 'offline'; });
});
`)),
    f(dir, 'README.md', readme(proj, {
      usage: `npm start\n\nopen http://localhost:8080`,
      features: `- Dependency-free Node server
- Responsive, hand-written frontend
- Live API endpoints for stats and health
- Easy to restyle and extend`
    }))
  );
  files.push(...frontendPages(proj).map((e) => anchor(dir, e)));
  files.push(...nodeModules(proj, pickNames(NODE_MODULE_ORDER, proj, 10)).map(([rel, content]) => {
    const base = require('path').basename(rel);
    return [require('path').join(dir, 'src', base), content];
  }));
  return files;
}

function reactApp(proj, dir) {
  const J = proj.jsName;
  const files = baseFiles(proj, dir, 'node_modules/\n');
  const pkg = {
    name: proj.slug,
    version: '1.0.0',
    description: proj.blurb,
    type: 'module',
    scripts: { dev: 'vite', build: 'vite build', preview: 'vite preview' },
    dependencies: { react: '^18.3.1', 'react-dom': '^18.3.1' },
    devDependencies: { vite: '^5.4.0', '@vitejs/plugin-react': '^4.3.1' }
  };
  files.push(
    f(dir, 'package.json', JSON.stringify(pkg, null, 2) + '\n'),
    f(dir, 'index.html', sanitizeText(`<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${proj.title}</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
`)),
    f(dir, 'vite.config.js', sanitizeText(`import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { port: 5173 }
});
`)),
    f(dir, 'src/main.jsx', sanitizeText(`import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles.css';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
`)),
    f(dir, 'src/App.jsx', sanitizeText(`import { useMemo, useState } from 'react';

function useItems() {
  const [items, setItems] = useState(() =>
    Array.from({ length: 12 }, (_, i) => ({ id: i, value: Math.round(Math.random() * 100), active: i % 3 === 0 }))
  );
  const toggle = (id) => setItems((prev) => prev.map((it) => (it.id === id ? { ...it, active: !it.active } : it)));
  return { items, toggle };
}

export default function App() {
  const { items, toggle } = useItems();
  const total = useMemo(() => items.reduce((sum, it) => sum + it.value, 0), [items]);
  const active = items.filter((it) => it.active).length;

  return (
    <main className="shell">
      <header>
        <h1>${proj.title}</h1>
        <p>${proj.blurb}</p>
      </header>

      <section className="stats">
        <div className="stat"><span className="num">{items.length}</span><span>items</span></div>
        <div className="stat"><span className="num">{active}</span><span>active</span></div>
        <div className="stat"><span className="num">{total}</span><span>total</span></div>
      </section>

      <section className="list">
        {items.map((it) => (
          <button key={it.id} className={'row' + (it.active ? ' on' : '')} onClick={() => toggle(it.id)}>
            <span className="dot" />
            <span>Item {it.id + 1}</span>
            <span className="val">{it.value}</span>
          </button>
        ))}
      </section>
    </main>
  );
}
`)),
    f(dir, 'src/styles.css', `* { box-sizing: border-box; }
body { margin: 0; font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; background: #0f1222; color: #e7e9f4; }
.shell { max-width: 760px; margin: 0 auto; padding: 48px 24px; }
header h1 { font-size: 40px; letter-spacing: -0.03em; margin: 0 0 6px; background: linear-gradient(90deg, #a5b4fc, #22d3ee); -webkit-background-clip: text; background-clip: text; color: transparent; }
header p { color: #8b93b0; margin: 0 0 28px; }
.stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; margin-bottom: 28px; }
.stat { background: #171a30; border: 1px solid #232849; border-radius: 14px; padding: 18px; display: flex; flex-direction: column; }
.stat .num { font-size: 30px; font-weight: 700; }
.stat span:last-child { color: #8b93b0; font-size: 13px; }
.list { display: flex; flex-direction: column; gap: 10px; }
.row { display: flex; align-items: center; gap: 12px; width: 100%; background: #171a30; border: 1px solid #232849; color: #e7e9f4; border-radius: 10px; padding: 14px 16px; cursor: pointer; font-size: 15px; text-align: left; }
.row .dot { width: 10px; height: 10px; border-radius: 50%; background: #3b4268; }
.row.on .dot { background: #34d399; box-shadow: 0 0 10px #34d399; }
.row.on { border-color: #2f3d5f; }
.val { margin-left: auto; color: #8b93b0; }
`),
    f(dir, 'README.md', readme(proj, {
      usage: `npm install\nnpm run dev\n\n# production build\nnpm run build\nnpm run preview`,
      features: `- React 18 with Vite for instant dev builds
- Clean component structure, no state library needed
- Dark UI with subtle gradients
- Ready to extend with routing and data layers`
    }))
  );
  files.push(
    f(dir, 'src/components/Stat.jsx', sanitizeText(`export default function Stat({ label, value }) {
  return (
    <div className="stat">
      <span className="num">{value}</span>
      <span>{label}</span>
    </div>
  );
}
`)),
    f(dir, 'src/components/Toggle.jsx', sanitizeText(`export default function Toggle({ checked, onChange, label }) {
  return (
    <button
      className={'toggle' + (checked ? ' on' : '')}
      onClick={() => onChange(!checked)}
      aria-pressed={checked}
    >
      <span className="knob" />
      <span>{label}</span>
    </button>
  );
}
`)),
    f(dir, 'src/components/ProgressBar.jsx', sanitizeText(`export default function ProgressBar({ value, max = 100 }) {
  const pct = Math.min(100, Math.max(0, (value / max) * 100));
  return (
    <div className="bar">
      <div className="bar-fill" style={{ width: pct + '%' }} />
    </div>
  );
}
`)),
    f(dir, 'src/components/EmptyState.jsx', sanitizeText(`export default function EmptyState({ title, hint, action }) {
  return (
    <div className="empty-state">
      <div className="empty-icon">âˆ…</div>
      <h3>{title}</h3>
      {hint ? <p>{hint}</p> : null}
      {action ? <button className="ghost-btn" onClick={action}>Add one</button> : null}
    </div>
  );
}
`)),
    f(dir, 'src/hooks/useLocalStorage.js', sanitizeText(`import { useEffect, useState } from 'react';

export default function useLocalStorage(key, initial) {
  const [value, setValue] = useState(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw !== null ? JSON.parse(raw) : initial;
    } catch (e) {
      return initial;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      // storage unavailable, ignore
    }
  }, [key, value]);

  return [value, setValue];
}
`)),
    f(dir, 'src/hooks/useDebounce.js', sanitizeText(`import { useEffect, useState } from 'react';

export default function useDebounce(value, delay = 250) {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debounced;
}
`)),
    f(dir, 'src/lib/api.js', sanitizeText(`// Small API helpers for ${proj.title}.
export async function getItems() {
  const res = await fetch('/api/items');
  if (!res.ok) throw new Error('failed to load items');
  return res.json();
}

export async function createItem(payload) {
  const res = await fetch('/api/items', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!res.ok) throw new Error('failed to create item');
  return res.json();
}

export async function deleteItem(id) {
  const res = await fetch('/api/items/' + id, { method: 'DELETE' });
  if (!res.ok) throw new Error('failed to delete item');
  return res.json();
}
`)),
    f(dir, 'src/lib/utils.js', sanitizeText(`export function formatCount(n) {
  return new Intl.NumberFormat().format(n);
}

export function formatTime(iso) {
  if (!iso) return '-';
  return new Date(iso).toLocaleString();
}

export function cls(...parts) {
  return parts.filter(Boolean).join(' ');
}

export function sample(arr, n) {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, n);
}

export function debounce(fn, ms = 250) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}
`))
  );
  return files;
}

function chromeExtension(proj, dir) {
  const files = baseFiles(proj, dir);
  files.push(
    f(dir, 'manifest.json', JSON.stringify({
      manifest_version: 3,
      name: proj.title,
      version: '1.0.0',
      description: proj.blurb,
      action: { default_popup: 'popup.html', default_icon: 'icons/icon.png' },
      background: { service_worker: 'background.js' },
      permissions: ['storage', 'tabs'],
      host_permissions: ['<all_urls>'],
      content_scripts: [{ matches: ['<all_urls>'], js: ['content.js'] }]
    }, null, 2) + '\n'),
    f(dir, 'background.js', sanitizeText(`chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({ installedAt: Date.now() });
});

chrome.action.onClicked.addListener((tab) => {
  chrome.tabs.sendMessage(tab.id, { type: 'PING' }).catch(() => {});
});
`)),
    f(dir, 'content.js', sanitizeText(`(() => {
  if (window.__${proj.module}) return;
  window.__${proj.module} = true;

  const mark = document.createElement('div');
  mark.style.cssText = 'position:fixed;right:12px;bottom:12px;z-index:999999;background:#171b26;color:#fff;font:12px/1.4 monospace;padding:8px 12px;border-radius:8px;opacity:.92;box-shadow:0 4px 14px rgba(0,0,0,.25);';
  mark.textContent = '${proj.title} ready';
  document.documentElement.appendChild(mark);

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'PING') {
      mark.textContent = '${proj.title} pong ' + new Date().toLocaleTimeString();
      sendResponse({ ok: true });
    }
  });
})();
`)),
    f(dir, 'popup.html', sanitizeText(`<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>${proj.title}</title><link rel="stylesheet" href="popup.css"></head>
<body>
  <main class="box">
    <h1>${proj.title}</h1>
    <p class="sub">${proj.blurb}</p>
    <div class="row"><span>Status</span><strong id="status">checking...</strong></div>
    <button id="refresh">Refresh</button>
    <p class="hint">This extension runs on the current page.</p>
  </main>
  <script src="popup.js"></script>
</body>
</html>
`)),
    f(dir, 'popup.css', `body { width: 280px; margin: 0; font-family: system-ui, sans-serif; background: #0f1222; color: #e7e9f4; }
.box { padding: 18px; }
h1 { font-size: 18px; margin: 0 0 4px; }
.sub { color: #8b93b0; font-size: 13px; margin: 0 0 14px; }
.row { display: flex; justify-content: space-between; font-size: 14px; padding: 8px 0; border-top: 1px solid #232849; }
button { width: 100%; margin-top: 12px; padding: 10px; border: 0; border-radius: 8px; background: linear-gradient(135deg, #6366f1, #0ea5e9); color: #fff; font-weight: 700; cursor: pointer; }
.hint { color: #6b7391; font-size: 11px; margin-top: 12px; }
`),
    f(dir, 'popup.js', sanitizeText(`const status = document.getElementById('status');
function tick() {
  status.textContent = new Date().toLocaleString();
}
tick();
setInterval(tick, 1000);
document.getElementById('refresh').addEventListener('click', tick);
`)),
    f(dir, 'icons/README.txt', 'Add icon.png (128x128) here. A generated placeholder is fine for local use.\n'),
    f(dir, 'README.md', readme(proj, {
      usage: `Open chrome://extensions\nEnable Developer mode\nClick "Load unpacked" and select this folder`,
      features: `- Manifest V3, modern extension API
- Popup with live status
- Content script with safe DOM injection
- Storage-backed configuration`
    }))
  );
  files.push(
    f(dir, 'utils.js', sanitizeText(`const DEFAULT_STATE = {
  enabled: true,
  interval: 60,
  mode: 'auto',
  lastRun: null
};

async function getState() {
  const data = await chrome.storage.local.get(DEFAULT_STATE);
  return { ...DEFAULT_STATE, ...data };
}

async function setState(patch) {
  const current = await getState();
  await chrome.storage.local.set({ ...current, ...patch });
  return getState();
}

function debounce(fn, ms = 300) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

function clampInt(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function tabUrl(tab) {
  return tab && tab.url ? new URL(tab.url).hostname : 'unknown';
}
`)),
    f(dir, 'content2.js', sanitizeText(`// Second content script: highlights and actions on the active page.
(() => {
  if (window.__${proj.module}2) return;
  window.__${proj.module}2 = true;

  document.addEventListener('mouseup', () => {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) return;
    const text = selection.toString().trim();
    if (!text || text.length > 500) return;
    chrome.runtime.sendMessage({ type: 'SELECTION', text, at: Date.now() });
  });
})();
`)),
    f(dir, 'icons/icon.svg', `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">
  <rect width="128" height="128" rx="24" fill="#5b4dff"/>
  <circle cx="64" cy="64" r="34" fill="#ffffff" opacity="0.9"/>
  <circle cx="64" cy="64" r="18" fill="#5b4dff"/>
</svg>
`),
    f(dir, 'manifest.icons.note', 'Icons: icon.svg is a generated placeholder. Use it or replace with a branded icon.\n')
  );
  files.push(...chromeExtras(proj).map((e) => anchor(dir, e)));
  return files;
}

function goTool(proj, dir) {
  const files = baseFiles(proj, dir, 'bin/\n');
  files.push(
    f(dir, 'go.mod', sanitizeText(`module ${proj.slug}

go 1.22
`)),
    f(dir, 'main.go', sanitizeText(`package main

import (
	"flag"
	"fmt"
	"log"
	"os"

	"${proj.slug}/internal/core"
)

func main() {
	verbose := flag.Bool("v", false, "verbose output")
	dry := flag.Bool("dry-run", false, "print without writing")
	output := flag.String("o", "./out", "output directory")
	flag.Parse()

	cfg := core.Config{
		Verbose: *verbose,
		DryRun:  *dry,
		Output:  *output,
	}

	if err := core.Run(cfg); err != nil {
		log.Fatalf("%v", err)
	}

	if cfg.Verbose {
		fmt.Fprintln(os.Stderr, "${proj.title}: done")
	}
}
`)),
    f(dir, 'internal/core/core.go', sanitizeText(`package core

import (
	"fmt"
	"os"
	"path/filepath"
	"time"
)

// Config holds the options for a run.
type Config struct {
	Verbose bool
	DryRun  bool
	Output  string
}

// Result summarizes one run.
type Result struct {
	Files int       ` + "`json:\"files\"`" + `
	Elapsed time.Duration ` + "`json:\"elapsed_ms\"`" + `
}

// Run executes the ${proj.slug} workload.
func Run(cfg Config) error {
	start := time.Now()

	if !cfg.DryRun {
		if err := os.MkdirAll(cfg.Output, 0o755); err != nil {
			return fmt.Errorf("create output: %w", err)
		}
	}

	for i := 0; i < 4; i++ {
		name := filepath.Join(cfg.Output, fmt.Sprintf("result-%d.txt", i))
		content := fmt.Sprintf("${proj.title}\\nitem %d\\n", i)
		if cfg.DryRun {
			if cfg.Verbose {
				fmt.Printf("would write %s\\n", name)
			}
			continue
		}
		if err := os.WriteFile(name, []byte(content), 0o644); err != nil {
			return fmt.Errorf("write %s: %w", name, err)
		}
	}

	if cfg.Verbose {
		fmt.Printf("wrote files in %s\\n", time.Since(start))
	}
	return nil
}
`)),
    f(dir, 'README.md', readme(proj, {
      usage: `go build -o ${proj.slug} .\n./${proj.slug} -v -o ./out`,
      features: `- Single static binary
- Standard library only, zero dependencies
- Flags for verbose and dry-run modes
- Clean package layout ready to grow`
    }))
  );
  files.push(...goModules(proj, pickNames(GO_MODULE_ORDER, proj, 8)).map((e) => anchor(dir, e)));
  return files;
}

function pythonPipeline(proj, dir) {
  const M = proj.module;
  const files = baseFiles(proj, dir);
  files.push(
    f(dir, 'requirements.txt', ''),
    f(dir, 'src/' + M + '/__init__.py', sanitizeText(`"""${proj.title}: ${proj.blurb}"""

__version__ = "1.0.0"
`)),
    f(dir, 'src/' + M + '/reader.py', sanitizeText(`"""Input readers for ${proj.title}."""

import csv
import json
from pathlib import Path


class Reader:
    def __init__(self, path):
        self.path = Path(path)

    def read(self):
        suffix = self.path.suffix.lower()
        if suffix == ".json":
            return self._json()
        if suffix == ".csv":
            return self._csv()
        if suffix in (".txt", ".log"):
            return self._lines()
        raise ValueError(f"unsupported format: {suffix}")

    def _json(self):
        with open(self.path, "r", encoding="utf-8") as fh:
            return json.load(fh)

    def _csv(self):
        with open(self.path, "r", encoding="utf-8", newline="") as fh:
            return list(csv.DictReader(fh))

    def _lines(self):
        with open(self.path, "r", encoding="utf-8") as fh:
            return [line.rstrip("\\n") for line in fh if line.strip()]
`)),
    f(dir, 'src/' + M + '/processor.py', sanitizeText(`"""Transformation steps for ${proj.title}."""


def normalize(rows):
    """Normalize mixed records into a consistent shape."""
    normalized = []
    for row in rows:
        if isinstance(row, str):
            normalized.append({"value": row})
        elif isinstance(row, dict):
            normalized.append({"value": row.get("value", row.get("name", ""))})
        else:
            normalized.append({"value": str(row)})
    return normalized


def enrich(rows):
    for row in rows:
        row["length"] = len(str(row["value"]))
        row["processed"] = True
    return rows
`)),
    f(dir, 'src/' + M + '/writer.py', sanitizeText(`"""Output writers for ${proj.title}."""

import csv
import json
from pathlib import Path


class Writer:
    def __init__(self, path):
        self.path = Path(path)

    def write(self, rows):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        suffix = self.path.suffix.lower()
        if suffix == ".json":
            self._json(rows)
        elif suffix == ".csv":
            self._csv(rows)
        else:
            self._text(rows)

    def _json(self, rows):
        self.path.write_text(json.dumps(rows, indent=2), encoding="utf-8")

    def _csv(self, rows):
        keys = list(rows[0].keys()) if rows else []
        with open(self.path, "w", encoding="utf-8", newline="") as fh:
            writer = csv.DictWriter(fh, fieldnames=keys)
            writer.writeheader()
            writer.writerows(rows)

    def _text(self, rows):
        lines = [str(r) for r in rows]
        self.path.write_text("\\n".join(lines), encoding="utf-8")
`)),
    f(dir, 'src/' + M + '/pipeline.py', sanitizeText(`"""Orchestrates read, transform, write for ${proj.title}."""

from .reader import Reader
from .processor import normalize, enrich
from .writer import Writer


def run_pipeline(source, target):
    rows = Reader(source).read()
    rows = enrich(normalize(rows))
    Writer(target).write(rows)
    return len(rows)
`)),
    f(dir, 'main.py', sanitizeText(`#!/usr/bin/env python3
"""Entry point for the ${proj.slug} data pipeline."""

import argparse
import sys

from ${M}.pipeline import run_pipeline
from ${M} import __version__


def main(argv=None):
    parser = argparse.ArgumentParser(description="${proj.title}")
    parser.add_argument("source", help="input file (json, csv or txt)")
    parser.add_argument("target", help="output file")
    parser.add_argument("--version", action="version", version=__version__)
    args = parser.parse_args(argv)

    count = run_pipeline(args.source, args.target)
    print(f"processed {count} records")
    return 0


if __name__ == "__main__":
    sys.exit(main())
`)),
    f(dir, 'sample.json', JSON.stringify({ items: [{ value: 'alpha' }, { value: 'beta' }, { value: 'gamma' }] }, null, 2) + '\n'),
    f(dir, 'README.md', readme(proj, {
      usage: `python main.py sample.json out.json\n\npython main.py sample.json out.csv`,
      features: `- Reader / processor / writer pipeline
- Supports JSON, CSV and plain text input
- Streaming-friendly, memory-safe for large files
- Easy to add custom transforms`
    }))
  );
  files.push(...pythonModules(proj, pickNames(PYTHON_MODULE_ORDER, proj, 15)).map((e) => anchor(dir, e)));
  return files;
}

function staticSite(proj, dir) {
  const files = baseFiles(proj, dir);
  files.push(
    f(dir, 'index.html', sanitizeText(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${proj.title}</title>
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <div class="bg-glow" aria-hidden="true"></div>
  <header class="site-head">
    <a class="logo" href="#">${proj.title}</a>
    <nav>
      <a href="#features">Features</a>
      <a href="#docs">Docs</a>
      <a class="cta" href="#start">Get started</a>
    </nav>
  </header>

  <main>
    <section class="hero">
      <div class="badge">Open source</div>
      <h1>${proj.title}</h1>
      <p class="lede">${proj.blurb}</p>
      <div class="actions">
        <a class="btn primary" href="#start">Get started</a>
        <a class="btn ghost" href="https://github.com/" target="_blank">GitHub</a>
      </div>
    </section>

    <section id="features" class="features">
      <article>
        <h3>1. Focus</h3>
        <p>${proj.title} solves one problem cleanly, with no feature sprawl.</p>
      </article>
      <article>
        <h3>2. Speed</h3>
        <p>Static by default. No runtime, no server, instant loads.</p>
      </article>
      <article>
        <h3>3. Open</h3>
        <p>MIT licensed. Read it, fork it, improve it.</p>
      </article>
    </section>

    <section id="docs" class="docs">
      <h2>Docs</h2>
      <pre><code>$ git clone &lt;repo-url&gt;
$ cd ${proj.slug}
$ open index.html</code></pre>
    </section>

    <section id="start" class="start">
      <h2>Start now</h2>
      <p>Clone the repository and open index.html in any browser.</p>
      <a class="btn primary" href="https://github.com/" target="_blank">View source</a>
    </section>
  </main>

  <footer>${proj.title} - built for the open web.</footer>
  <script src="app.js"></script>
</body>
</html>
`)),
    f(dir, 'styles.css', `:root { --bg: #080b16; --panel: #0f1424; --line: #1d2540; --text: #e7e9f4; --muted: #8b93b0; --violet: #8b5cf6; --cyan: #22d3ee; }
* { box-sizing: border-box; }
body { margin: 0; font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; background: var(--bg); color: var(--text); line-height: 1.6; }
.bg-glow { position: fixed; inset: 0; z-index: 0; background: radial-gradient(700px 380px at 20% 0%, rgba(139,92,246,.25), transparent), radial-gradient(700px 380px at 85% 10%, rgba(34,211,238,.18), transparent); pointer-events: none; }
.site-head, main, footer { position: relative; z-index: 1; }
.site-head { display: flex; align-items: center; justify-content: space-between; max-width: 1080px; margin: 0 auto; padding: 22px 24px; }
.logo { font-weight: 800; letter-spacing: -0.02em; text-decoration: none; color: var(--text); font-size: 19px; }
nav a { margin-left: 22px; color: var(--muted); text-decoration: none; font-size: 15px; }
.cta { color: var(--cyan) !important; }
main { max-width: 1080px; margin: 0 auto; padding: 0 24px; }
.hero { text-align: center; padding: 90px 0 70px; }
.badge { display: inline-block; font-size: 13px; letter-spacing: .04em; border: 1px solid var(--line); color: var(--cyan); padding: 6px 14px; border-radius: 999px; margin-bottom: 22px; }
h1 { font-size: 64px; letter-spacing: -0.045em; margin: 0 0 14px; background: linear-gradient(90deg, var(--violet), var(--cyan)); -webkit-background-clip: text; background-clip: text; color: transparent; }
.lede { color: var(--muted); font-size: 19px; max-width: 620px; margin: 0 auto 32px; }
.actions { display: flex; gap: 14px; justify-content: center; }
.btn { display: inline-block; padding: 12px 24px; border-radius: 10px; text-decoration: none; font-weight: 700; }
.btn.primary { background: linear-gradient(135deg, var(--violet), var(--cyan)); color: #fff; }
.btn.ghost { border: 1px solid var(--line); color: var(--text); }
.features { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 18px; padding: 30px 0 70px; }
.features article { background: var(--panel); border: 1px solid var(--line); border-radius: 14px; padding: 24px; }
.features h3 { margin: 0 0 8px; }
.features p { color: var(--muted); margin: 0; }
.docs, .start { background: var(--panel); border: 1px solid var(--line); border-radius: 16px; padding: 34px; margin-bottom: 40px; }
.docs pre { background: #0a0e1c; padding: 18px; border-radius: 10px; overflow-x: auto; color: #a5f3fc; font-size: 14px; }
.start { text-align: center; }
.start p { color: var(--muted); }
footer { text-align: center; color: var(--muted); padding: 40px 0; font-size: 14px; }
`),
    f(dir, 'app.js', sanitizeText(`document.querySelectorAll('a[href^="#"]').forEach((a) => {
  a.addEventListener('click', (e) => {
    e.preventDefault();
    const el = document.querySelector(a.getAttribute('href'));
    if (el) el.scrollIntoView({ behavior: 'smooth' });
  });
});

const counters = document.querySelectorAll('[data-count]');
counters.forEach((el) => {
  const target = Number(el.dataset.count);
  const dur = 900;
  const start = performance.now();
  const step = (t) => {
    const p = Math.min(1, (t - start) / dur);
    el.textContent = Math.round(target * (1 - Math.pow(1 - p, 3))).toLocaleString();
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
});
`)),
    f(dir, 'features.html', sanitizeText(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Features - ${proj.title}</title>
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <header class="site-head">
    <a class="logo" href="index.html">${proj.title}</a>
    <nav>
      <a href="index.html">Home</a>
      <a href="features.html">Features</a>
      <a href="docs.html">Docs</a>
      <a class="cta" href="index.html#start">Get started</a>
    </nav>
  </header>
  <main>
    <section class="hero">
      <div class="badge">Feature overview</div>
      <h1>Everything you need</h1>
      <p class="lede">A clear set of features that do their job without getting in the way.</p>
    </section>
    <section class="features">
      <article><h3>Fast</h3><p>Static files and instant loads. No server round trips for content.</p></article>
      <article><h3>Private</h3><p>Runs entirely on your machine. Nothing leaves your browser.</p></article>
      <article><h3>Open</h3><p>MIT licensed source. Read every line, change what you need.</p></article>
      <article><h3>Portable</h3><p>Copy the folder anywhere and it still works.</p></article>
      <article><h3>Focus</h3><p>One clear purpose, no feature sprawl.</p></article>
      <article><h3>Simple</h3><p>Plain HTML, CSS and a touch of JavaScript.</p></article>
    </section>
  </main>
  <footer>${proj.title} - feature overview.</footer>
  <script src="app.js"></script>
</body>
</html>
`)),
    f(dir, 'docs.html', sanitizeText(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Docs - ${proj.title}</title>
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <header class="site-head">
    <a class="logo" href="index.html">${proj.title}</a>
    <nav>
      <a href="index.html">Home</a>
      <a href="features.html">Features</a>
      <a href="docs.html">Docs</a>
    </nav>
  </header>
  <main>
    <section class="docs">
      <h1>Documentation</h1>
      <h2>Quick start</h2>
      <pre><code>$ git clone &lt;repo-url&gt;
$ cd ${proj.slug}
$ open index.html</code></pre>
      <h2>Layout</h2>
      <p>Everything lives in the project root. The main page is index.html. Styling lives in styles.css and small helpers in app.js.</p>
      <h2>Customizing</h2>
      <p>Change the colors in the CSS variables at the top of styles.css. Add pages as new HTML files and link them from the header.</p>
      <h2>Deploying</h2>
      <p>Upload the folder to any static host, or open it directly from disk. No build step required.</p>
    </section>
  </main>
  <footer>${proj.title} - docs.</footer>
  <script src="app.js"></script>
</body>
</html>
`)),
    f(dir, 'contact.html', sanitizeText(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Contact - ${proj.title}</title>
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <header class="site-head">
    <a class="logo" href="index.html">${proj.title}</a>
    <nav>
      <a href="index.html">Home</a>
      <a href="features.html">Features</a>
      <a href="contact.html">Contact</a>
    </nav>
  </header>
  <main>
    <section class="hero">
      <div class="badge">Get in touch</div>
      <h1>Say hello</h1>
      <p class="lede">Questions, ideas or feedback are always welcome.</p>
    </section>
    <section class="start" style="max-width:640px;margin:0 auto 60px;">
      <form onsubmit="event.preventDefault(); document.getElementById('sent').textContent = 'Thanks. This demo form does not send anything.';">
        <label style="display:block;margin-bottom:12px;">Message<textarea rows="5" style="width:100%;background:#0a0e1c;border:1px solid #1d2540;color:#e7e9f4;border-radius:10px;padding:12px;font-family:inherit;margin-top:6px;" placeholder="Write something..."></textarea></label>
        <button class="btn primary" type="submit">Send</button>
        <p id="sent" style="color:var(--cyan);margin-top:12px;"></p>
      </form>
    </section>
  </main>
  <footer>${proj.title} - contact.</footer>
  <script src="app.js"></script>
</body>
</html>
`)),
    f(dir, 'blog.html', sanitizeText(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Blog - ${proj.title}</title>
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <header class="site-head">
    <a class="logo" href="index.html">${proj.title}</a>
    <nav>
      <a href="index.html">Home</a>
      <a href="features.html">Features</a>
      <a href="blog.html">Blog</a>
    </nav>
  </header>
  <main>
    <section class="hero">
      <div class="badge">Journal</div>
      <h1>Notes from the build</h1>
      <p class="lede">Short posts about how ${proj.title} is designed and why.</p>
    </section>
    <section class="features">
      <article><h3>Why a small core</h3><p>Keeping the core tiny means fewer bugs and easier reviews. Everything else hangs off hooks and plugins.</p><p class="byline">week 1</p></article>
      <article><h3>Errors are data</h3><p>Every failure carries a code and context. Logs become searchable and debugging stops being guesswork.</p><p class="byline">week 2</p></article>
      <article><h3>Measuring what matters</h3><p>A handful of metrics beats a dashboard full of noise. We track the ones that change decisions.</p><p class="byline">week 3</p></article>
    </section>
  </main>
  <footer>${proj.title} - blog.</footer>
  <script src="app.js"></script>
</body>
</html>
`)),
    f(dir, 'gallery.html', sanitizeText(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Gallery - ${proj.title}</title>
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <header class="site-head">
    <a class="logo" href="index.html">${proj.title}</a>
    <nav>
      <a href="index.html">Home</a>
      <a href="features.html">Features</a>
      <a href="gallery.html">Gallery</a>
    </nav>
  </header>
  <main>
    <section class="hero">
      <div class="badge">Gallery</div>
      <h1>See it in action</h1>
      <p class="lede">A quick tour of ${proj.title} in different setups.</p>
    </section>
    <section class="features">
      <article><div class="shot">▦</div><h3>Default layout</h3><p>The out-of-the-box experience, tuned for clarity.</p></article>
      <article><div class="shot">▤</div><h3>Compact mode</h3><p>For dense screens where every pixel counts.</p></article>
      <article><div class="shot">◈</div><h3>Dark theme</h3><p>Easy on the eyes late at night.</p></article>
    </section>
  </main>
  <footer>${proj.title} - gallery.</footer>
  <script src="app.js"></script>
</body>
</html>
`)),
    f(dir, 'styles-extra.css', `.byline { color: var(--dim); font-size: 12px; margin-top: 10px; font-family: var(--mono, monospace); }
.shot { font-size: 48px; color: var(--violet); margin-bottom: 10px; }
.stats-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 14px; margin: 40px 0; }
.stats-row .stat { background: var(--panel); border: 1px solid var(--line); border-radius: 12px; padding: 18px; text-align: center; }
.stats-row .stat b { display: block; font-size: 26px; font-family: var(--mono, monospace); }
`),
    f(dir, 'README.md', readme(proj, {
      usage: `open index.html`,
      features: `- Pure HTML, CSS and JavaScript
- Responsive dark design with gradient accents
- No build tools, no dependencies
- Easy to host anywhere`
    }))
  );
  return files;
}

function nodeBot(proj, dir) {
  const files = baseFiles(proj, dir, '.env\n');
  const pkg = {
    name: proj.slug,
    version: '1.0.0',
    description: proj.blurb,
    main: 'src/index.js',
    scripts: { start: 'node src/index.js', test: 'node --test' },
    license: 'MIT'
  };
  files.push(
    f(dir, 'package.json', JSON.stringify(pkg, null, 2) + '\n'),
    f(dir, '.env.example', `BOT_TOKEN=your-token-here\nDEBUG=false\n`),
    f(dir, 'src/index.js', sanitizeText(`const { EventEmitter } = require('node:events');

class ${proj.jsName}Bot extends EventEmitter {
  constructor({ token, debug = false } = {}) {
    super();
    this.token = token;
    this.debug = debug;
    this.handlers = new Map();
    this.started = false;
  }

  onCommand(name, handler) {
    this.handlers.set(name, handler);
    return this;
  }

  start() {
    if (this.started) return this;
    this.started = true;
    this.emit('ready');
    this.#pump();
    return this;
  }

  async #pump() {
    // In production this polls a platform API. Here we simulate events.
    const ticker = setInterval(async () => {
      if (!this.started) return clearInterval(ticker);
      const sample = this.#sample();
      await this.#handle(sample);
    }, 5000);
  }

  #sample() {
    const commands = [...this.handlers.keys()];
    const name = commands[Math.floor(Math.random() * commands.length)] || 'ping';
    return { id: String(Date.now()), user: 'tester', text: '/' + name, at: new Date().toISOString() };
  }

  async #handle(msg) {
    const first = msg.text.split(/\\s+/)[0].toLowerCase();
    const handler = this.handlers.get(first.replace(/^\\//, ''));
    if (!handler) return;
    this.emit('message', msg);
    if (this.debug) console.log('handled', first);
    try {
      await handler(msg);
    } catch (err) {
      this.emit('error', err);
    }
  }
}

module.exports = { ${proj.jsName}Bot };
`)),
    f(dir, 'src/bot.js', sanitizeText(`require('node:dotenv/config');

const { ${proj.jsName}Bot } = require('./index.js');

const bot = new ${proj.jsName}Bot({
  token: process.env.BOT_TOKEN,
  debug: process.env.DEBUG === 'true'
});

bot.onCommand('ping', (msg) => console.log('pong', msg.id));
bot.onCommand('status', (msg) => console.log('status ok at', msg.at));

bot.on('error', (err) => console.error(err.message));
bot.start();
`)),
    f(dir, 'README.md', readme(proj, {
      usage: `npm install\ncp .env.example .env\nnpm start`,
      features: `- Event-driven bot core with a clean command registry
- Built on node:events, no framework required
- Debug logging and typed events
- Drop-in adapters for any messaging API`
    }))
  );
  files.push(...nodeModules(proj, pickNames(NODE_MODULE_ORDER, proj, 10)).map(([rel, content]) => {
    const base = require('path').basename(rel);
    return [require('path').join(dir, 'src', base), content];
  }));
  return files;
}

function devopsKit(proj, dir) {
  const files = baseFiles(proj, dir, '.env\n');
  files.push(
    f(dir, 'Dockerfile', `FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev || npm install --omit=dev

COPY . .

EXPOSE 8080
CMD ["node", "server.js"]
`),
    f(dir, 'docker-compose.yml', `services:
  app:
    build: .
    ports:
      - "8080:8080"
    environment:
      - NODE_ENV=production
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://localhost:8080/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
      interval: 30s
      timeout: 5s
      retries: 3
    restart: unless-stopped
`),
    f(dir, 'package.json', JSON.stringify({
      name: proj.slug,
      version: '1.0.0',
      description: proj.blurb,
      main: 'server.js',
      scripts: { start: 'node server.js' },
      license: 'MIT'
    }, null, 2) + '\n'),
    f(dir, 'server.js', sanitizeText(`const http = require('node:http');

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ service: '${proj.title}', healthy: true, at: new Date().toISOString() }));
});

server.listen(process.env.PORT || 8080, () => {
  console.log('${proj.title} service up');
});
`)),
    f(dir, '.env.example', `PORT=8080\nNODE_ENV=production\n`),
    f(dir, 'scripts/backup.sh', sanitizeText(`#!/usr/bin/env bash
set -euo pipefail

echo "backup starting: $(date -u +%FT%TZ)"
mkdir -p ./backups
cp -r ./data ./backups/data-$(date +%s) 2>/dev/null || echo "no data dir yet"
echo "backup complete"
`)),
    f(dir, 'README.md', readme(proj, {
      usage: `docker compose up --build\n\n# or run the script locally\nnpm start`,
      features: `- Reproducible Docker image with health checks
- Compose setup with restart policy
- Minimal Node service with a JSON API
- Shell backup script included`
    }))
  );
  files.push(...nodeModules(proj, pickNames(NODE_MODULE_ORDER, proj, 10)).map(([rel, content]) => {
    const base = require('path').basename(rel);
    return [require('path').join(dir, 'src', base), content];
  }));
  return files;
}

// Registry of generators.
const GENERATORS = {
  'python-cli': { label: 'Python CLI tool', stack: 'Python', generator: pythonCli },
  'python-script': { label: 'Python script', stack: 'Python', generator: pythonScript },
  'node-api': { label: 'Node.js API', stack: 'Node.js', generator: nodeApi },
  'webapp': { label: 'Web app', stack: 'Node.js + HTML/CSS', generator: webapp },
  'react-app': { label: 'React dashboard', stack: 'React + Vite', generator: reactApp },
  'chrome-extension': { label: 'Chrome extension', stack: 'JavaScript (MV3)', generator: chromeExtension },
  'go-tool': { label: 'Go CLI tool', stack: 'Go', generator: goTool },
  'python-pipeline': { label: 'Data pipeline', stack: 'Python', generator: pythonPipeline },
  'static-site': { label: 'Static site', stack: 'HTML/CSS/JS', generator: staticSite },
  'node-bot': { label: 'Node bot', stack: 'Node.js', generator: nodeBot },
  'devops-kit': { label: 'DevOps kit', stack: 'Docker + Node', generator: devopsKit }
};

module.exports = { GENERATORS };
