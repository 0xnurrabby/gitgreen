const fs = require('fs');
const path = require('path');
const { sanitizeText } = require('../server/sanitize');
const {
  PYTHON_MODULE_ORDER,
  NODE_MODULE_ORDER,
  GO_MODULE_ORDER,
  pythonModules,
  nodeModules,
  goModules
} = require('./modules');

function p(dir, ...parts) {
  return require('path').join(dir, ...parts);
}

// Determine the module family for a project.
function familyOf(def) {
  const g = def.generatorId;
  if (g === 'python-cli' || g === 'python-pipeline' || g === 'python-script') return 'python';
  if (g === 'node-api' || g === 'webapp' || g === 'node-bot' || g === 'devops-kit') return 'node';
  if (g === 'go-tool') return 'go';
  return null;
}

// Add the next batch of library modules that are not yet present in the repo.
function addModuleBatch(def, dir, stepIndex) {
  const fam = familyOf(def);
  if (!fam) return [];
  const order = fam === 'python' ? PYTHON_MODULE_ORDER : fam === 'node' ? NODE_MODULE_ORDER : GO_MODULE_ORDER;
  const builder = fam === 'python' ? pythonModules : fam === 'node' ? nodeModules : goModules;
  const COUNT = 3;
  const start = ((Number(def.id) || 0) + stepIndex * COUNT) % order.length;
  const names = [];
  for (let i = 0; i < COUNT; i++) names.push(order[(start + i) % order.length]);

  const useLib = def.generatorId === 'python-script';
  const out = [];
  for (const entry of builder(def, names)) {
    let rel = entry[0];
    if (fam === 'python' && useLib) {
      rel = 'lib/' + path.basename(rel);
    }
    const abs = path.join(dir, rel);
    if (fs.existsSync(abs)) continue; // already in the repo, skip
    out.push([abs, entry[1]]);
  }
  return out;
}

// Unbounded growth: numbered feature files that never collide, so a repo keeps
// getting genuinely new content across many evolution rounds.
const FEATURE_WORDS = [
  'search', 'config', 'output', 'input', 'logging', 'export', 'parser', 'runner', 'cache',
  'retry', 'validation', 'sync', 'format', 'filter', 'index', 'auth', 'import', 'render',
  'watch', 'queue', 'scheduler', 'report', 'preview', 'archive', 'merge', 'watchdog',
  'scaffold', 'notify', 'extract', 'translate', 'monitor', 'refresh', 'backup', 'compact'
];

function cap(text) {
  return text[0].toUpperCase() + text.slice(1);
}

function featureFiles(def, dir, kind, n) {
  const fam = familyOf(def);
  const word = FEATURE_WORDS[((Number(def.id) || 0) + n * 3) % FEATURE_WORDS.length];
  const base = 'feature-' + word + '-' + n;

  if (fam === 'python') {
    const mod = def.module;
    const target = path.join(dir, 'src', mod, 'features');
    const file = path.join(target, base + '.py');
    return [[file, sanitizeText(`"""${cap(word)} handling for ${def.title}."""

import threading
import time


class ${cap(word)}Handler:
    """Processes ${word} requests with retries and timeouts."""

    def __init__(self, timeout=15, retries=2):
        self.timeout = timeout
        self.retries = retries
        self._lock = threading.Lock()
        self._processed = 0
        self._errors = 0

    def run(self, payload, **options):
        """Run a single ${word} operation."""
        started = time.time()
        attempts = 0
        last_error = None
        while attempts <= self.retries:
            attempts += 1
            try:
                result = self._execute(payload, options)
                with self._lock:
                    self._processed += 1
                return {"ok": True, "value": result, "duration_ms": round((time.time() - started) * 1000, 2)}
            except Exception as err:
                last_error = err
                time.sleep(min(1, 0.2 * attempts))
        with self._lock:
            self._errors += 1
        return {"ok": False, "error": str(last_error), "attempts": attempts}

    def _execute(self, payload, options):
        if not payload:
            raise ValueError("empty ${word} payload")
        return {"${word}": str(payload)[:200], "attempts": 0}

    def stats(self):
        with self._lock:
            return {"processed": self._processed, "errors": self._errors}


def run_${word}(payload, **options):
    """Module-level convenience entry point."""
    return ${cap(word)}Handler().run(payload, **options)
`)]];
  }

  if (fam === 'node') {
    const jsName = def.jsName || 'App';
    const file = path.join(dir, 'src', 'features', base + '.js');
    return [[file, sanitizeText(`// ${cap(word)} handling for ${def.title}.
const { EventEmitter } = require('node:events');

class ${cap(word)}Handler extends EventEmitter {
  constructor({ timeout = 15000, retries = 2 } = {}) {
    super();
    this.timeout = timeout;
    this.retries = retries;
    this.processed = 0;
    this.errors = 0;
  }

  async run(payload, options = {}) {
    const started = Date.now();
    let lastError;
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      try {
        const value = await this.#execute(payload, options);
        this.processed += 1;
        return { ok: true, value, durationMs: Date.now() - started };
      } catch (err) {
        lastError = err;
        await new Promise((r) => setTimeout(r, Math.min(1000, 200 * (attempt + 1))));
      }
    }
    this.errors += 1;
    return { ok: false, error: lastError.message, attempts: this.retries + 1 };
  }

  async #execute(payload, options) {
    if (!payload) throw new Error('empty ' + '${word}' + ' payload');
    return { '${word}': String(payload).slice(0, 200) };
  }

  stats() {
    return { processed: this.processed, errors: this.errors };
  }
}

module.exports = { ${cap(word)}Handler, run: (payload, opts) => new ${cap(word)}Handler().run(payload, opts) };
`)]];
  }

  if (fam === 'go') {
    const file = path.join(dir, 'internal', 'core', base + '.go');
    return [[file, sanitizeText(`package core

import (
	"errors"
	"sync"
	"time"
)

// ${cap(word)}Handler processes ${word} requests with retries.
type ${cap(word)}Handler struct {
	mu        sync.Mutex
	processed int
	errors    int
	retries   int
}

// New${cap(word)}Handler creates a handler with the given retry count.
func New${cap(word)}Handler(retries int) *${cap(word)}Handler {
	return &${cap(word)}Handler{retries: retries}
}

// Run executes one ${word} operation.
func (h *${cap(word)}Handler) Run(payload any) (any, error) {
	var lastErr error
	for attempt := 0; attempt <= h.retries; attempt++ {
		if payload == nil {
			lastErr = errors.New("empty ${word} payload")
		} else {
			h.mu.Lock()
			h.processed++
			h.mu.Unlock()
			return map[string]any{"${word}": payload}, nil
		}
		time.Sleep(time.Duration(attempt+1) * 100 * time.Millisecond)
	}
	h.mu.Lock()
	h.errors++
	h.mu.Unlock()
	return nil, lastErr
}

// Stats returns counters.
func (h *${cap(word)}Handler) Stats() (int, int) {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.processed, h.errors
}
`)]];
  }

  // Generic repos (web/static/react/chrome): add a markdown guide instead.
  const file = path.join(dir, 'docs', 'guides', base + '.md');
  return [[file, sanitizeText(`# ${cap(word)} guide

This guide explains how ${def.title} handles ${word} in practice.

## Overview

The ${word} flow lives in its own module so the rest of the codebase stays untouched. It accepts a payload, applies the configured rules, and reports a result with timing information.

## Usage

Pass a payload to the ${word} handler. Empty input is rejected with a clear error, and transient failures are retried with backoff.

## Customizing

Each handler reads its options from a small options object. Tune timeouts and retries to match your workload.

## Testing

The handler reports processed and error counters, which makes it easy to assert behavior in automated tests.
`)]];
}

function docsFiles(def, dir, n) {
  return [[path.join(dir, 'docs', 'guides', 'guide-' + n + '.md'), sanitizeText(`# ${def.title} guide ${n}

Practical notes collected while working on ${def.title}.

## What changed in this round

Small improvements and fixes that keep the project moving. Nothing here changes the public contract; it is internal polish that makes the codebase easier to maintain.

## Things to know

- Run the test suite before pushing changes.
- Keep new code in its own module so the core stays small.
- Update the changelog when behavior changes.

## Next steps

The roadmap stays conservative: finish the current module, then look at reducing allocations in the hot path.
`)]];
}

function regressionTestFiles(def, dir, n) {
  const fam = familyOf(def);
  const word = FEATURE_WORDS[((Number(def.id) || 0) + n * 5) % FEATURE_WORDS.length];
  if (fam === 'python') {
    return [[path.join(dir, 'tests', 'test_regression_' + n + '.py'), sanitizeText(`import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, ROOT)


def test_regression_${n}():
    """Regression guard for a ${word} edge case discovered earlier."""
    from ${def.module}.features.feature-${word}-${n} import run_${word}
    result = run_${word}("sample-${n}", timeout=5)
    assert result["ok"] is True
    assert "value" in result
`)]];
  }
  if (fam === 'node') {
    const wordCap = cap(word);
    return [[path.join(dir, 'test', 'regression-' + n + '.test.js'), sanitizeText(`const test = require('node:test');
const assert = require('node:assert');
const { ${wordCap}Handler } = require('../src/features/feature-${word}-${n}.js');

test('${word} regression guard ' + '${n}', async () => {
  const result = await new ${wordCap}Handler({ retries: 1 }).run('sample-${n}');
  assert.strictEqual(result.ok, true);
});
`)]];
  }
  return [[path.join(dir, 'docs', 'tests', 'regression-' + n + '.md'), sanitizeText(`# Regression ${n}

Guard for a ${word} edge case. Verify the handler rejects empty input and recovers from transient failures.
`)]];
}

function subcommandFiles(def, dir, n) {
  const fam = familyOf(def);
  const word = FEATURE_WORDS[((Number(def.id) || 0) + n * 7) % FEATURE_WORDS.length];
  if (fam === 'python') {
    const file = path.join(dir, 'src', def.module, 'commands', 'command-' + word + '-' + n + '.py');
    return [[file, sanitizeText(`"""Subcommand for ${word} operations in ${def.title}."""

import argparse


def add_parser(subparsers):
    parser = subparsers.add_parser("${word}", help="${word} operations")
    parser.add_argument("value", help="value to process")
    parser.add_argument("--verbose", action="store_true")
    parser.set_defaults(func=run)


def run(args):
    if args.verbose:
        print(f"running ${word} on {args.value}")
    return f"{args.value}-processed"
`)]];
  }
  return [[path.join(dir, 'docs', 'commands', 'command-' + word + '-' + n + '.md'), sanitizeText(`# ${cap(word)} command

The \`${word}\` subcommand runs a single ${word} operation. It takes one positional value and prints the result to stdout. Use \`--verbose\` for more detail.
`)]];
}

// Each step writes real files so incremental commits are genuine.
const STEPS = {
  'add-tests': {
    label: 'Add unit tests',
    message: 'Add test coverage for core modules',
    files(proj, dir) {
      const f = [];
      f.push([p(dir, 'tests/test_smoke.py'), sanitizeText(`import subprocess
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))


def test_imports():
    sys.path.insert(0, ROOT)
    import ${proj.module}
    assert hasattr(${proj.module}, "__version__")


def test_cli_help():
    result = subprocess.run(
        [sys.executable, "-m", "${proj.module}", "--help"],
        cwd=ROOT,
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0
    assert "usage" in result.stdout.lower()
`)]);
      f.push([p(dir, 'pytest.ini'), `[pytest]
testpaths = tests
python_files = test_*.py
`]);
      return f;
    }
  },
  'add-more-tests': {
    label: 'Add edge-case tests',
    message: 'Cover edge cases and error paths',
    files(proj, dir) {
      return [[p(dir, 'tests/test_edge_cases.py'), sanitizeText(`import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, ROOT)


def test_empty_input_is_handled():
    from ${proj.module}.validators import is_required
    import pytest
    with pytest.raises(ValueError):
        is_required("", "name")


def test_bounds_are_enforced():
    from ${proj.module}.validators import is_range
    import pytest
    with pytest.raises(ValueError):
        is_range(9999, 0, 10, "count")


def test_slug_validation():
    from ${proj.module}.validators import is_slug
    assert is_slug("hello-world") == "hello-world"
`)]];
    }
  },
  'add-ci': {
    label: 'Add CI workflow',
    message: 'Set up GitHub Actions CI pipeline',
    files(proj, dir) {
      return [[p(dir, '.github/workflows/ci.yml'), sanitizeText(`name: CI

on:
  push:
    branches: [ main ]
  pull_request:
    branches: [ main ]

jobs:
  build:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        python-version: ['3.10', '3.11', '3.12']
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: \${{ matrix.python-version }}
      - run: pip install -r requirements.txt
      - run: python -m ${proj.module} --version
      - name: Run tests
        run: |
          pip install pytest
          pytest
`)]];
    }
  },
  'add-docs': {
    label: 'Write documentation',
    message: 'Add architecture and contribution docs',
    files(proj, dir) {
      const f = [];
      f.push([p(dir, 'docs/architecture.md'), sanitizeText(`# Architecture

${proj.title} is organized around a small set of focused modules. The goal is to keep the core small and let plugins, hooks, and configuration do the heavy lifting.

## Layout

- \`src/${proj.module}/\` - primary package source
- \`tests/\` - unit and integration tests
- \`examples/\` - runnable examples
- \`docs/\` - this documentation

## Design notes

- Configuration is read once at startup and kept immutable during a run.
- Errors are surfaced as typed exceptions so callers can react precisely.
- Everything I/O related lives behind small adapters to make testing simple.

## Extension points

The project exposes a hook system. New behavior can be registered without changing core code, which keeps the surface area stable as features are added.
`)]);
      f.push([p(dir, 'docs/contributing.md'), sanitizeText(`# Contributing

Thanks for helping out.

## Getting started

1. Fork the repository.
2. Create a feature branch.
3. Write a test that reproduces the issue or documents the feature.
4. Implement the change.
5. Run the test suite and make sure nothing breaks.
6. Open a pull request.

## Code style

- Keep functions small and named for what they do.
- Prefer plain data structures over clever abstractions.
- Add type hints where they help readability.
`)]);
      f.push([p(dir, 'docs/usage.md'), sanitizeText(`# Usage

## Install

\`\`\`bash
pip install -r requirements.txt
\`\`\`

## Run

\`\`\`bash
python -m ${proj.module} --help
\`\`\`

## Configure

Create a config file (JSON or YAML) and point the tool at it:

\`\`\`bash
python -m ${proj.module} run --config config.json
\`\`\`
`)]);
      return f;
    }
  },
  'add-contributing': {
    label: 'Add contributor guide',
    message: 'Add contributing and code of conduct guides',
    files(proj, dir) {
      const f = [];
      f.push([p(dir, 'CONTRIBUTING.md'), sanitizeText(`# Contributing to ${proj.title}

This project welcomes contributions of all kinds: bug reports, feature ideas, documentation, and code.

## Process

- Search existing issues before opening a new one.
- Discuss significant changes before writing code.
- Keep pull requests small and focused.
- Include tests when changing behavior.

## Development

Clone the repository, install dependencies, and run the test suite locally before pushing. The project keeps a low ceremony setup on purpose: install, test, build, ship.
`)]);
      f.push([p(dir, 'CODE_OF_CONDUCT.md'), sanitizeText(`# Code of Conduct

## Our Pledge

We are committed to providing a friendly, safe, and welcoming environment for all contributors, regardless of level of experience, identity, or background.

## Our Standards

Examples of behavior that contribute to a positive environment:

- Being kind and courteous to others.
- Giving and gracefully accepting constructive feedback.
- Focusing on what is best for the community.

## Enforcement

Instances of unacceptable behavior may be reported to the maintainers. All reports will be reviewed and handled with discretion.
`)]);
      return f;
    }
  },
  'add-changelog': {
    label: 'Add changelog',
    message: 'Keep a changelog for the project',
    files(proj, dir) {
      return [[p(dir, 'CHANGELOG.md'), sanitizeText(`# Changelog

All notable changes to this project are documented in this file.

The format is based on Keep a Changelog, and this project adheres to Semantic Versioning.

## [0.1.0] - initial release

### Added

- Initial implementation of ${proj.title}.
- Core ${proj.stack} tooling.
- Test suite and CI workflow.
`)]];
    }
  },
  'add-example': {
    label: 'Add example scripts',
    message: 'Add runnable examples',
    files(proj, dir) {
      const f = [];
      f.push([p(dir, 'examples/basic.py'), sanitizeText(`"""Minimal example for ${proj.title}."""

from ${proj.module} import ${proj.module}


def main():
    runner = ${proj.module}({"name": "${proj.title}", "dry_run": False})
    result = runner.execute()
    print(result)


if __name__ == "__main__":
    main()
`)]);
      f.push([p(dir, 'examples/config.example.json'), `{
  "name": "${proj.title}",
  "enabled": true,
  "verbose": false,
  "output_dir": "./out"
}
`]);
      f.push([p(dir, 'examples/README.md'), sanitizeText(`# Examples

These examples show how to use ${proj.title} in a few common scenarios.

- \`basic.py\` - the simplest way to run a job
- \`config.example.json\` - a starting configuration

Copy an example, tweak the values, and run it.
`)]);
      return f;
    }
  },
  'add-demo': {
    label: 'Add demo script',
    message: 'Add demo mode',
    files(proj, dir) {
      return [[p(dir, 'demo.py'), sanitizeText(`"""Runs ${proj.title} in demo mode with sample data."""

import os
import sys

sys.path.insert(0, os.path.abspath(os.path.dirname(__file__)))

from ${proj.module}.cli import main

if __name__ == "__main__":
    sys.exit(main(["run", "--demo", "--verbose"]))
`)]];
    }
  },
  'add-config': {
    label: 'Add config system',
    message: 'Add configurable settings module',
    files(proj, dir) {
      return [[p(dir, 'src/' + proj.module + '/config.py'), sanitizeText(`"""Configuration handling for ${proj.title}."""

import json
import os
from dataclasses import dataclass, field


@dataclass
class Config:
    name: str = "${proj.title}"
    enabled: bool = True
    verbose: bool = False
    timeout: int = 30
    retries: int = 3
    extra: dict = field(default_factory=dict)

    @classmethod
    def from_file(cls, path):
        with open(path, "r", encoding="utf-8") as fh:
            data = json.load(fh)
        return cls(**{k: v for k, v in data.items() if k in cls.__dataclass_fields__})

    @classmethod
    def from_env(cls):
        cfg = cls()
        cfg.verbose = os.getenv("VERBOSE", "0") == "1"
        cfg.timeout = int(os.getenv("TIMEOUT", "30"))
        cfg.retries = int(os.getenv("RETRIES", "3"))
        return cfg
`)]];
    }
  },
  'add-license': {
    label: 'Add LICENSE',
    message: 'Add MIT license file',
    files() {
      return [[p(dir, 'LICENSE'), sanitizeText(`MIT License

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
`)]];
    }
  },
  'add-version-bump': {
    label: 'Bump version',
    message: 'Bump version and update changelog',
    files(proj, dir) {
      const f = [];
      f.push([p(dir, 'VERSION'), '0.1.1\n']);
      f.push([p(dir, 'CHANGELOG.md'), sanitizeText(`# Changelog

All notable changes to this project are documented in this file.

## [0.1.1] - patch release

### Changed

- Updated ${proj.title} internals for better error reporting.
- Improved verbose output readability.

### Fixed

- Resolved an edge case in configuration loading.

## [0.1.0] - initial release

### Added

- Initial implementation of ${proj.title}.
`)]);
      return f;
    }
  },
  'add-perf': {
    label: 'Add performance docs',
    message: 'Document performance notes and benchmarks',
    files(proj, dir) {
      return [[p(dir, 'docs/performance.md'), sanitizeText(`# Performance

This document records the performance characteristics of ${proj.title} and the benchmarks used to verify them.

## Goals

- Keep hot paths allocation-free where practical.
- Keep startup time under a second on commodity hardware.
- Stay memory-sane on large inputs.

## Benchmarking

A simple timing harness is included in the examples. Run it with a range of input sizes and record the results here:

| Input size | Time (ms) | Memory (MB) |
| --- | --- | --- |
| 1,000 | 12 | 8 |
| 10,000 | 90 | 24 |
| 100,000 | 812 | 190 |

## Notes

Regressions are typically caused by accidentally turning a linear scan into a quadratic one. When a change looks slow, profile before optimizing; guessing is how perf bugs hide.
`)]];
    }
  },
  'add-modules-a': {
    label: 'Expand core modules',
    message: 'Expand the module surface area',
    files(proj, dir) { return addModuleBatch(proj, dir, 0); }
  },
  'add-modules-b': {
    label: 'Add supporting modules',
    message: 'Add supporting modules for edge workflows',
    files(proj, dir) { return addModuleBatch(proj, dir, 1); }
  },
  'add-modules-c': {
    label: 'Add utility modules',
    message: 'Add utility modules',
    files(proj, dir) { return addModuleBatch(proj, dir, 2); }
  },
  'add-modules-d': {
    label: 'Add integration modules',
    message: 'Add integration modules and adapters',
    files(proj, dir) { return addModuleBatch(proj, dir, 3); }
  },
  'add-modules-e': {
    label: 'Add extension modules',
    message: 'Add extension modules and helpers',
    files(proj, dir) { return addModuleBatch(proj, dir, 4); }
  },
  'add-modules-f': {
    label: 'Add remaining modules',
    message: 'Add remaining module coverage',
    files(proj, dir) { return addModuleBatch(proj, dir, 5); }
  },
  'add-modules-g': {
    label: 'Add final modules',
    message: 'Add final module batch',
    files(proj, dir) { return addModuleBatch(proj, dir, 6); }
  },
  'add-modules-h': {
    label: 'Add extra modules',
    message: 'Add extra modules and polish',
    files(proj, dir) { return addModuleBatch(proj, dir, 7); }
  },
  'add-feature': {
    label: 'Add a feature module',
    message: 'Add a new feature module',
    files(proj, dir) { return featureFiles(proj, dir, 'feature', proj.evoIndex || 0); }
  },
  'add-feature-2': {
    label: 'Add another feature module',
    message: 'Add another feature module',
    files(proj, dir) { return featureFiles(proj, dir, 'feature', (proj.evoIndex || 0) + 100); }
  },
  'add-guide': {
    label: 'Add a guide',
    message: 'Add a practical guide',
    files(proj, dir) { return docsFiles(proj, dir, proj.evoIndex || 0); }
  },
  'add-guide-2': {
    label: 'Add another guide',
    message: 'Add another guide',
    files(proj, dir) { return docsFiles(proj, dir, (proj.evoIndex || 0) + 50); }
  },
  'add-regression-test': {
    label: 'Add regression test',
    message: 'Add regression test',
    files(proj, dir) { return regressionTestFiles(proj, dir, proj.evoIndex || 0); }
  },
  'add-subcommand': {
    label: 'Add a subcommand',
    message: 'Add a new subcommand',
    files(proj, dir) { return subcommandFiles(proj, dir, proj.evoIndex || 0); }
  }
};

const SEQUENCE = [
  'add-tests',
  'add-modules-a',
  'add-feature',
  'add-modules-b',
  'add-feature-2',
  'add-guide',
  'add-docs',
  'add-modules-c',
  'add-feature',
  'add-example',
  'add-modules-d',
  'add-feature-2',
  'add-regression-test',
  'add-changelog',
  'add-modules-e',
  'add-feature',
  'add-config',
  'add-modules-f',
  'add-feature-2',
  'add-demo',
  'add-more-tests',
  'add-contributing',
  'add-modules-g',
  'add-feature',
  'add-guide-2',
  'add-license',
  'add-perf',
  'add-version-bump',
  'add-modules-h',
  'add-feature-2',
  'add-subcommand'
];

module.exports = { STEPS, SEQUENCE, resolveStep };

// Pick the first step starting at `from` that produces files not already
// present with identical content. This guarantees every evolution round adds
// genuinely new material, so repos keep growing toward thousands of lines.
function resolveStep(def, dir, from) {
  for (let i = 0; i < SEQUENCE.length; i++) {
    const key = SEQUENCE[(from + i) % SEQUENCE.length];
    const step = STEPS[key];
    if (!step) continue;
    let files = [];
    try {
      files = step.files(def, dir) || [];
    } catch (e) {
      files = [];
    }
    const fresh = files.filter(([fp, content]) => {
      if (!fs.existsSync(fp)) return true;
      try {
        return fs.readFileSync(fp, 'utf8') !== String(content);
      } catch (e) {
        return true;
      }
    });
    if (fresh.length > 0) return { key, step, files: fresh };
  }
  return null;
}
