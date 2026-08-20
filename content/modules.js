const { sanitizeText } = require('../server/sanitize');

// Rich module libraries. Each module is real, functional code that gets woven
// into a project so repos land in the 1000-10000 line range.

function entry(def, rel, content) {
  return [rel, sanitizeText(content)];
}

// ---------------- Python modules ----------------
const PYTHON_MODULES = {
  'errors.py': (def) => entry(def, 'src/' + def.module + '/errors.py', `"""Typed exceptions for ${def.title}."""


class ${def.jsName}Error(Exception):
    """Base error for the whole package."""

    exit_code = 1


class ConfigurationError(${def.jsName}Error):
    """Raised when configuration is invalid or missing."""

    exit_code = 2


class ValidationError(${def.jsName}Error):
    """Raised when input data fails validation."""

    exit_code = 3


class NotFoundError(${def.jsName}Error):
    """Raised when a requested resource does not exist."""

    exit_code = 4


class ConflictError(${def.jsName}Error):
    """Raised when an operation conflicts with existing state."""

    exit_code = 5


class RateLimitError(${def.jsName}Error):
    """Raised when a rate limit is exceeded."""

    exit_code = 6


class TimeoutError(${def.jsName}Error):
    """Raised when an operation takes too long."""

    exit_code = 7


class UnsupportedError(${def.jsName}Error):
    """Raised for unsupported inputs or platforms."""

    exit_code = 8


class StateError(${def.jsName}Error):
    """Raised when internal state is inconsistent."""

    exit_code = 9


def guard(condition, message, exc=ValidationError):
    """Raise exc(message) when condition is False."""
    if not condition:
        raise exc(message)
`),
  'logger.py': (def) => entry(def, 'src/' + def.module + '/logger.py', `"""Small leveled logger for ${def.title}."""

import logging
import os
import sys
from logging.handlers import RotatingFileHandler

RESET = "\\033[0m"
COLORS = {
    "DEBUG": "\\033[36m",
    "INFO": "\\033[32m",
    "WARNING": "\\033[33m",
    "ERROR": "\\033[31m",
    "CRITICAL": "\\033[35m",
}


class ColorFormatter(logging.Formatter):
    def format(self, record):
        color = COLORS.get(record.levelname, RESET)
        original = record.msg
        record.msg = f"{color}{record.msg}{RESET}"
        try:
            return super().format(record)
        finally:
            record.msg = original


def build_logger(name="${def.slug}", level=None):
    level = level or os.getenv("LOG_LEVEL", "INFO").upper()
    logger = logging.getLogger(name)
    logger.setLevel(getattr(logging, level, logging.INFO))

    if not logger.handlers:
        console = logging.StreamHandler(sys.stderr)
        console.setFormatter(ColorFormatter("%(asctime)s %(levelname)-8s %(name)s: %(message)s", "%H:%M:%S"))
        logger.addHandler(console)

        log_file = os.getenv("LOG_FILE")
        if log_file:
            file_handler = RotatingFileHandler(log_file, maxBytes=2_000_000, backupCount=3)
            file_handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)-8s %(name)s: %(message)s"))
            logger.addHandler(file_handler)

    return logger


log = build_logger()
`),
  'cache.py': (def) => entry(def, 'src/' + def.module + '/cache.py', `"""Simple TTL cache used across ${def.title}."""

import threading
import time


class TTLCache:
    def __init__(self, ttl=300, max_size=1024):
        self.ttl = ttl
        self.max_size = max_size
        self._data = {}
        self._lock = threading.Lock()

    def get(self, key):
        with self._lock:
            item = self._data.get(key)
            if item is None:
                return None
            value, expires = item
            if time.time() > expires:
                del self._data[key]
                return None
            return value

    def set(self, key, value, ttl=None):
        ttl = ttl or self.ttl
        with self._lock:
            if len(self._data) >= self.max_size and key not in self._data:
                self._evict_one()
            self._data[key] = (value, time.time() + ttl)

    def delete(self, key):
        with self._lock:
            self._data.pop(key, None)

    def clear(self):
        with self._lock:
            self._data.clear()

    def _evict_one(self):
        oldest = min(self._data.items(), key=lambda kv: kv[1][1])
        del self._data[oldest[0]]

    def keys(self):
        with self._lock:
            now = time.time()
            return [k for k, (v, e) in self._data.items() if e > now]

    def stats(self):
        with self._lock:
            return {"size": len(self._data), "max": self.max_size, "ttl": self.ttl}
`),
  'models.py': (def) => entry(def, 'src/' + def.module + '/models.py', `"""Core data models for ${def.title}."""

import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone


def now_iso():
    return datetime.now(timezone.utc).isoformat()


@dataclass
class Item:
    id: str = field(default_factory=lambda: uuid.uuid4().hex)
    created_at: str = field(default_factory=now_iso)
    updated_at: str = field(default_factory=now_iso)
    metadata: dict = field(default_factory=dict)

    def to_dict(self):
        return {
            "id": self.id,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "metadata": self.metadata,
        }


@dataclass
class Result:
    ok: bool = True
    value: object = None
    error: str = None
    duration_ms: float = 0.0

    def to_dict(self):
        return {"ok": self.ok, "value": self.value, "error": self.error, "duration_ms": self.duration_ms}


@dataclass
class Event:
    kind: str
    payload: dict = field(default_factory=dict)
    ts: str = field(default_factory=now_iso)
`),
  'validators.py': (def) => entry(def, 'src/' + def.module + '/validators.py', `"""Input validation helpers for ${def.title}."""

import re


def is_required(value, name="value"):
    if value is None or str(value).strip() == "":
        raise ValueError(f"{name} is required")


def is_int(value, name="value"):
    if not str(value).lstrip("-").isdigit():
        raise ValueError(f"{name} must be an integer")
    return int(value)


def is_float(value, name="value"):
    try:
        return float(value)
    except (TypeError, ValueError):
        raise ValueError(f"{name} must be a number")


def is_range(value, low, high, name="value"):
    number = is_int(value, name)
    if not (low <= number <= high):
        raise ValueError(f"{name} must be between {low} and {high}")
    return number


def is_email(value):
    if not re.match(r"^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$", str(value)):
        raise ValueError("not a valid email address")
    return value


def is_url(value):
    if not re.match(r"^https?://", str(value)):
        raise ValueError("not a valid URL")
    return value


def is_slug(value):
    if not re.match(r"^[a-z0-9-]+$", str(value)):
        raise ValueError("must be a lowercase slug")
    return value


def length(value, minimum=0, maximum=1_000_000, name="value"):
    size = len(str(value))
    if not (minimum <= size <= maximum):
        raise ValueError(f"{name} length must be between {minimum} and {maximum}")
    return value
`),
  'plugins.py': (def) => entry(def, 'src/' + def.module + '/plugins.py', `"""Plugin registry for ${def.title}."""

import importlib
import inspect


class Plugin:
    name = "base"
    version = "0.1.0"

    def setup(self, context):
        pass

    def teardown(self):
        pass

    def describe(self):
        return {"name": self.name, "version": self.version}


class PluginRegistry:
    def __init__(self):
        self._plugins = {}

    def register(self, plugin):
        if not inspect.isclass(plugin) or not issubclass(plugin, Plugin):
            raise TypeError("plugins must subclass Plugin")
        instance = plugin()
        self._plugins[instance.name] = instance
        return instance

    def get(self, name):
        return self._plugins.get(name)

    def all(self):
        return list(self._plugins.values())

    def setup_all(self, context):
        for plugin in self._plugins.values():
            plugin.setup(context)

    def load_module(self, module_name):
        mod = importlib.import_module(module_name)
        for _, obj in inspect.getmembers(mod, inspect.isclass):
            if issubclass(obj, Plugin) and obj is not Plugin:
                self.register(obj)
`),
  'scheduler.py': (def) => entry(def, 'src/' + def.module + '/scheduler.py', `"""In-process job scheduler for ${def.title}."""

import heapq
import threading
import time
from dataclasses import dataclass


@dataclass(order=True)
class Job:
    run_at: float
    seq: int
    fn: object
    name: str = ""

    def __hash__(self):
        return hash((self.run_at, self.seq))


class Scheduler:
    def __init__(self):
        self._heap = []
        self._seq = 0
        self._lock = threading.Lock()
        self._cond = threading.Condition(self._lock)
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._run, daemon=True, name="scheduler")

    def start(self):
        self._thread.start()
        return self

    def stop(self):
        self._stop.set()
        with self._cond:
            self._cond.notify_all()
        self._thread.join(timeout=5)

    def at(self, when, fn, name=""):
        with self._lock:
            self._seq += 1
            heapq.heappush(self._heap, Job(when, self._seq, fn, name))
        with self._cond:
            self._cond.notify()

    def every(self, seconds, fn, name=""):
        def loop():
            self.at(time.time() + seconds, loop, name)
            fn()
        self.at(time.time() + seconds, loop, name)
        return self

    def _run(self):
        while not self._stop.is_set():
            with self._cond:
                while self._heap and self._heap[0].run_at > time.time():
                    wait = self._heap[0].run_at - time.time()
                    self._cond.wait(timeout=min(wait, 60))
                if self._stop.is_set():
                    return
                if self._heap:
                    job = heapq.heappop(self._heap)
                else:
                    self._cond.wait(timeout=60)
                    continue
            try:
                job.fn()
            except Exception:
                continue

    def pending(self):
        with self._lock:
            return len(self._heap)
`),
  'watcher.py': (def) => entry(def, 'src/' + def.module + '/watcher.py', `"""File watcher for ${def.title}."""

import hashlib
import os
import threading
import time
from pathlib import Path


def file_hash(path):
    digest = hashlib.sha256()
    with open(path, "rb") as fh:
        for block in iter(lambda: fh.read(65536), b""):
            digest.update(block)
    return digest.hexdigest()


class FileWatcher:
    def __init__(self, paths, interval=1.0, recursive=True):
        self.paths = [Path(p) for p in paths]
        self.interval = interval
        self.recursive = recursive
        self._handlers = []
        self._snap = {}
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._loop, daemon=True)

    def on_change(self, fn):
        self._handlers.append(fn)
        return self

    def start(self):
        self._snap = self._scan()
        self._thread.start()
        return self

    def stop(self):
        self._stop.set()
        self._thread.join(timeout=5)

    def _walk(self):
        for base in self.paths:
            if base.is_file():
                yield base
            elif base.is_dir():
                files = base.rglob("*") if self.recursive else base.glob("*")
                for p in files:
                    if p.is_file():
                        yield p

    def _scan(self):
        snapshot = {}
        for p in self._walk():
            try:
                snapshot[str(p)] = (p.stat().st_size, p.stat().st_mtime)
            except OSError:
                continue
        return snapshot

    def _loop(self):
        while not self._stop.is_set():
            time.sleep(self.interval)
            current = self._scan()
            changed = [Path(k) for k, v in current.items() if self._snap.get(k) != v]
            removed = [Path(k) for k in self._snap if k not in current]
            for p in changed + removed:
                for fn in self._handlers:
                    try:
                        fn(p)
                    except Exception:
                        continue
            self._snap = current
`),
  'exporter.py': (def) => entry(def, 'src/' + def.module + '/exporter.py', `"""Output exporters for ${def.title}."""

import csv
import json
from pathlib import Path


class Exporter:
    def __init__(self, rows):
        self.rows = rows

    def to_json(self, path):
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(self.rows, fh, indent=2, default=str)
        return path

    def to_csv(self, path):
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        if not self.rows:
            Path(path).write_text("", encoding="utf-8")
            return path
        keys = list(self.rows[0].keys())
        with open(path, "w", encoding="utf-8", newline="") as fh:
            writer = csv.DictWriter(fh, fieldnames=keys)
            writer.writeheader()
            writer.writerows(self.rows)
        return path

    def to_markdown(self, path):
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        if not self.rows:
            Path(path).write_text("", encoding="utf-8")
            return path
        keys = list(self.rows[0].keys())
        lines = ["| " + " | ".join(keys) + " |", "| " + " | ".join("---" for _ in keys) + " |"]
        for row in self.rows:
            lines.append("| " + " | ".join(str(row.get(k, "")) for k in keys) + " |")
        Path(path).write_text("\\n".join(lines), encoding="utf-8")
        return path

    def to_text(self, path):
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        lines = [json.dumps(r, default=str) for r in self.rows]
        Path(path).write_text("\\n".join(lines), encoding="utf-8")
        return path
`),
  'stats.py': (def) => entry(def, 'src/' + def.module + '/stats.py', `"""Statistics helpers for ${def.title}."""

import math
from collections import Counter


def mean(values):
    if not values:
        return 0.0
    return sum(values) / len(values)


def median(values):
    if not values:
        return 0.0
    ordered = sorted(values)
    n = len(ordered)
    mid = n // 2
    if n % 2 == 1:
        return float(ordered[mid])
    return (ordered[mid - 1] + ordered[mid]) / 2.0


def stdev(values):
    if len(values) < 2:
        return 0.0
    m = mean(values)
    return math.sqrt(sum((x - m) ** 2 for x in values) / (len(values) - 1))


def percentiles(values):
    if not values:
        return {}
    ordered = sorted(values)
    n = len(ordered)
    out = {}
    for p in (10, 25, 50, 75, 90):
        idx = min(n - 1, max(0, round(n * p / 100)))
        out[p] = ordered[idx]
    return out


def top_counter(values, limit=10):
    return Counter(values).most_common(limit)


def summarize(values):
    return {
        "count": len(values),
        "mean": round(mean(values), 3),
        "median": round(median(values), 3),
        "stdev": round(stdev(values), 3),
        "min": min(values) if values else None,
        "max": max(values) if values else None,
        "percentiles": percentiles(values),
    }
`),
  'api_client.py': (def) => entry(def, 'src/' + def.module + '/api_client.py', `"""HTTP client wrapper for ${def.title}."""

import json
import time
import urllib.error
import urllib.parse
import urllib.request


class ApiClient:
    def __init__(self, base_url, token=None, timeout=30, retries=3):
        self.base_url = base_url.rstrip("/")
        self.token = token
        self.timeout = timeout
        self.retries = retries

    def request(self, method, path, data=None, params=None):
        url = self.base_url + path
        if params:
            url += "?" + urllib.parse.urlencode(params)
        body = json.dumps(data).encode() if data is not None else None
        headers = {"Content-Type": "application/json", "User-Agent": "${def.slug}"}
        if self.token:
            headers["Authorization"] = "Bearer " + self.token

        for attempt in range(self.retries):
            req = urllib.request.Request(url, data=body, headers=headers, method=method)
            try:
                with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                    raw = resp.read()
                    return json.loads(raw) if raw else {}
            except urllib.error.HTTPError as err:
                if err.code in (429, 500, 502, 503, 504) and attempt < self.retries - 1:
                    time.sleep(0.5 * (2 ** attempt))
                    continue
                raise
            except urllib.error.URLError:
                if attempt < self.retries - 1:
                    time.sleep(0.5 * (2 ** attempt))
                    continue
                raise

    def get(self, path, params=None):
        return self.request("GET", path, params=params)

    def post(self, path, data=None):
        return self.request("POST", path, data=data)

    def put(self, path, data=None):
        return self.request("PUT", path, data=data)

    def delete(self, path):
        return self.request("DELETE", path)
`),
  'state.py': (def) => entry(def, 'src/' + def.module + '/state.py', `"""Persistent state store for ${def.title}."""

import json
import os
import tempfile
from pathlib import Path


class StateStore:
    def __init__(self, path=None):
        self.path = Path(path or os.path.join(tempfile.gettempdir(), "${def.slug}-state.json"))
        self._data = {}
        self._load()

    def _load(self):
        if self.path.exists():
            try:
                self._data = json.loads(self.path.read_text(encoding="utf-8"))
            except (ValueError, OSError):
                self._data = {}

    def get(self, key, default=None):
        return self._data.get(key, default)

    def set(self, key, value):
        self._data[key] = value
        self._save()

    def update(self, mapping):
        self._data.update(mapping)
        self._save()

    def delete(self, key):
        self._data.pop(key, None)
        self._save()

    def all(self):
        return dict(self._data)

    def _save(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps(self._data, indent=2), encoding="utf-8")
        os.replace(tmp, self.path)
`),
  'notifier.py': (def) => entry(def, 'src/' + def.module + '/notifier.py', `"""Notification helpers for ${def.title}."""

import os
import subprocess
import sys


class Notifier:
    def __init__(self, enabled=True):
        self.enabled = enabled

    def send(self, title, message, level="info"):
        if not self.enabled:
            return False
        if sys.platform == "win32":
            return self._toast(title, message)
        return self._console(title, message, level)

    def _toast(self, title, message):
        try:
            subprocess.Popen(
                [
                    "powershell",
                    "-NoProfile",
                    "-Command",
                    f"Add-Type -AssemblyName System.Windows.Forms; "
                    f"[System.Windows.Forms.MessageBox]::Show('{message}','{title}')",
                ],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            return True
        except Exception:
            return False

    def _console(self, title, message, level):
        sys.stderr.write(f"[{level.upper()}] {title}: {message}\\n")
        return True

    @classmethod
    def from_env(cls):
        return cls(enabled=os.getenv("NOTIFICATIONS", "1") == "1")
`),
  'extensions.py': (def) => entry(def, 'src/' + def.module + '/extensions.py', `"""Public extension points for ${def.title}.

Third-party code can register behavior without touching the core. This keeps the
project stable while the ecosystem around it grows.
"""


class Extension:
    name = "base-extension"
    priority = 100

    def before_run(self, context):
        pass

    def after_run(self, context):
        pass


class ExtensionManager:
    def __init__(self):
        self._extensions = []

    def add(self, extension):
        if not isinstance(extension, Extension):
            raise TypeError("expected an Extension")
        self._extensions.append(extension)
        self._extensions.sort(key=lambda e: e.priority)
        return self

    def before_run(self, context):
        for ext in self._extensions:
            ext.before_run(context)

    def after_run(self, context):
        for ext in reversed(self._extensions):
            ext.after_run(context)

    def names(self):
        return [ext.name for ext in self._extensions]
`),
  'formatters.py': (def) => entry(def, 'src/' + def.module + '/formatters.py', `"""Output formatters for ${def.title}."""

import json


class Formatter:
    def format(self, data):
        raise NotImplementedError

    def file_suffix(self):
        raise NotImplementedError


class JsonFormatter(Formatter):
    def format(self, data):
        return json.dumps(data, indent=2, default=str)

    def file_suffix(self):
        return ".json"


class CompactJsonFormatter(Formatter):
    def format(self, data):
        return json.dumps(data, separators=(",", ":"), default=str)

    def file_suffix(self):
        return ".json"


class LineFormatter(Formatter):
    def format(self, data):
        if isinstance(data, (list, tuple)):
            return "\\n".join(str(item) for item in data)
        return str(data)

    def file_suffix(self):
        return ".txt"


class KeyValueFormatter(Formatter):
    def format(self, data):
        if isinstance(data, dict):
            return "\\n".join(f"{k}={v}" for k, v in data.items())
        return str(data)

    def file_suffix(self):
        return ".env"


FORMATTERS = {
    "json": JsonFormatter(),
    "json-compact": CompactJsonFormatter(),
    "lines": LineFormatter(),
    "keyvalue": KeyValueFormatter(),
}


def get_formatter(name):
    try:
        return FORMATTERS[name]
    except KeyError:
        raise ValueError(f"unknown formatter: {name}")
`),
  'monitoring.py': (def) => entry(def, 'src/' + def.module + '/monitoring.py', `"""Lightweight runtime monitoring for ${def.title}."""

import threading
import time
from collections import deque


class Monitor:
    def __init__(self, window=300):
        self.window = window
        self._events = deque(maxlen=10000)
        self._started = time.time()
        self._lock = threading.Lock()

    def record(self, name, duration_ms=None, ok=True):
        with self._lock:
            self._events.append({
                "name": name,
                "at": time.time(),
                "duration_ms": duration_ms,
                "ok": ok,
            })

    def uptime(self):
        return round(time.time() - self._started, 2)

    def snapshot(self):
        with self._lock:
            cutoff = time.time() - self.window
            recent = [e for e in self._events if e["at"] >= cutoff]
        counts = {}
        durations = {}
        for e in recent:
            key = e["name"]
            counts[key] = counts.get(key, 0) + 1
            if e["duration_ms"] is not None:
                durations.setdefault(key, []).append(e["duration_ms"])
        return {
            "uptime_s": self.uptime(),
            "window_s": self.window,
            "calls": len(recent),
            "by_name": {
                name: {
                    "count": count,
                    "avg_ms": round(sum(durations[name]) / len(durations[name]), 2)
                    if name in durations and durations[name] else None,
                }
                for name, count in counts.items()
            },
        }
`),
  'hooks.py': (def) => entry(def, 'src/' + def.module + '/hooks.py', `"""Event hooks for ${def.title}.

Hooks let callers run custom code around core operations without modifying the
package. This keeps the core small while remaining fully customizable.
"""


class HookManager:
    def __init__(self):
        self._hooks = {}

    def on(self, event, fn):
        self._hooks.setdefault(event, []).append(fn)
        return self

    def off(self, event, fn):
        self._hooks.setdefault(event, []).remove(fn)

    def fire(self, event, *args, **kwargs):
        for fn in self._hooks.get(event, []):
            fn(*args, **kwargs)

    def fire_until(self, event, *args, **kwargs):
        """Fire hooks until one returns a truthy value."""
        for fn in self._hooks.get(event, []):
            result = fn(*args, **kwargs)
            if result:
                return result
        return None

    def events(self):
        return list(self._hooks.keys())


hooks = HookManager()
`),
  'migrations.py': (def) => entry(def, 'src/' + def.module + '/migrations.py', `"""Simple state migrations for ${def.title}."""

import json
from pathlib import Path


class Migration:
    version = 0

    def up(self, data):
        return data


class MigrationRunner:
    def __init__(self, state_path, migrations):
        self.state_path = Path(state_path)
        self.migrations = sorted(migrations, key=lambda m: m.version)

    def current(self):
        if not self.state_path.exists():
            return 0
        try:
            meta = json.loads(self.state_path.read_text(encoding="utf-8")).get("__meta__", {})
            return int(meta.get("version", 0))
        except (ValueError, OSError):
            return 0

    def run(self):
        version = self.current()
        if not self.state_path.exists():
            data = {}
        else:
            data = json.loads(self.state_path.read_text(encoding="utf-8"))
        applied = []
        for migration in self.migrations:
            if migration.version <= version:
                continue
            data = migration.up(data)
            applied.append(migration.version)
            version = migration.version
        if applied:
            data["__meta__"] = {"version": version}
            self.state_path.parent.mkdir(parents=True, exist_ok=True)
            self.state_path.write_text(json.dumps(data, indent=2), encoding="utf-8")
        return applied
`),
  'git_ops.py': (def) => entry(def, 'src/' + def.module + '/git_ops.py', `"""Git helpers used by ${def.title}."""

import os
import subprocess
from pathlib import Path


class GitError(RuntimeError):
    pass


def run_git(args, cwd=None):
    result = subprocess.run(
        ["git", *args],
        cwd=cwd or str(Path.cwd()),
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        raise GitError(result.stderr.strip() or result.stdout.strip())
    return result.stdout.strip()


def is_repo(path=None):
    try:
        run_git(["rev-parse", "--is-inside-work-tree"], cwd=path)
        return True
    except GitError:
        return False


def current_branch(path=None):
    try:
        return run_git(["rev-parse", "--abbrev-ref", "HEAD"], cwd=path)
    except GitError:
        return ""


def recent_commits(limit=20, path=None):
    try:
        output = run_git(["log", f"-{limit}", "--pretty=format:%h|%an|%s"], cwd=path)
    except GitError:
        return []
    commits = []
    for line in output.splitlines():
        parts = line.split("|", 2)
        if len(parts) == 3:
            commits.append({"hash": parts[0], "author": parts[1], "subject": parts[2]})
    return commits


def dirty_files(path=None):
    try:
        output = run_git(["status", "--porcelain"], cwd=path)
    except GitError:
        return []
    return [line[3:] for line in output.splitlines() if line.strip()]


def ensure_repo(path):
    path = Path(path)
    path.mkdir(parents=True, exist_ok=True)
    if not is_repo(path):
        run_git(["init"], cwd=str(path))
    return path
`),
  'templates.py': (def) => entry(def, 'src/' + def.module + '/templates.py', `"""Tiny string templating for ${def.title}."""

import re


TOKEN_RE = re.compile(r"\\{\\{[ \\t]*(\\w+)[ \\t]*\\}\\}")


class Template:
    def __init__(self, source):
        self.source = source

    def render(self, context):
        def _replace(match):
            key = match.group(1)
            if key not in context:
                return match.group(0)
            value = context[key]
            if isinstance(value, (dict, list)):
                import json
                return json.dumps(value, default=str)
            return str(value)

        return TOKEN_RE.sub(_replace, self.source)

    @classmethod
    def from_file(cls, path):
        return cls(Path(path).read_text(encoding="utf-8"))


def render_string(source, context):
    return Template(source).render(context)


def render_file(path, context):
    from pathlib import Path
    return render_string(Path(path).read_text(encoding="utf-8"), context)
`),
  'cli_helpers.py': (def) => entry(def, 'src/' + def.module + '/cli_helpers.py', `"""Shared CLI building blocks for ${def.title}."""

import argparse
import os
import sys


def add_common_args(parser):
    parser.add_argument("--config", help="path to a JSON or YAML config file")
    parser.add_argument("--verbose", "-v", action="store_true", help="enable verbose output")
    parser.add_argument("--quiet", "-q", action="store_true", help="suppress non-error output")
    parser.add_argument("--output", "-o", help="write output to a file")
    parser.add_argument("--no-color", action="store_true", help="disable colored output")
    return parser


def env_flag(name, default=False):
    value = os.getenv(name)
    if value is None:
        return default
    return value.lower() in ("1", "true", "yes", "on")


def print_error(message):
    sys.stderr.write(f"error: {message}\\n")


def success(message):
    sys.stdout.write(f"{message}\\n")


def bool_arg(value):
    return value.lower() in ("1", "true", "yes", "on")
`),
};

const PYTHON_MODULE_ORDER = [
  'errors.py', 'logger.py', 'cache.py', 'models.py', 'validators.py',
  'plugins.py', 'scheduler.py', 'watcher.py', 'exporter.py', 'stats.py',
  'api_client.py', 'state.py', 'notifier.py', 'extensions.py',
  'formatters.py', 'monitoring.py', 'hooks.py', 'migrations.py', 'git_ops.py', 'templates.py', 'cli_helpers.py'
];

function pythonModules(def, names) {
  return names.map((n) => PYTHON_MODULES[n](def));
}

// ---------------- Node modules ----------------
const NODE_MODULES = {
  'logger.js': (def) => entry(def, 'src/logger.js', `const fs = require('node:fs');
const path = require('node:path');

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

class Logger {
  constructor({ level = 'info', file = null } = {}) {
    this.level = LEVELS[level] ?? 20;
    this.file = file;
    if (file) fs.mkdirSync(path.dirname(file), { recursive: true });
  }

  #write(line) {
    if (this.file) fs.appendFileSync(this.file, line + '\\n');
    else process.stderr.write(line + '\\n');
  }

  #line(lvl, msg, extra) {
    const ts = new Date().toISOString();
    const suffix = extra ? ' ' + JSON.stringify(extra) : '';
    return '[' + ts + '] ' + lvl.toUpperCase().padEnd(5) + ' ${def.jsName}: ' + msg + suffix;
  }

  log(lvl, msg, extra) {
    if ((LEVELS[lvl] ?? 20) < this.level) return;
    this.#write(this.#line(lvl, msg, extra));
  }

  debug(msg, extra) { this.log('debug', msg, extra); }
  info(msg, extra) { this.log('info', msg, extra); }
  warn(msg, extra) { this.log('warn', msg, extra); }
  error(msg, extra) { this.log('error', msg, extra); }

  child(ns) {
    const self = this;
    return {
      debug: (m, x) => self.debug(ns + ': ' + m, x),
      info: (m, x) => self.info(ns + ': ' + m, x),
      warn: (m, x) => self.warn(ns + ': ' + m, x),
      error: (m, x) => self.error(ns + ': ' + m, x)
    };
  }
}

module.exports = { Logger };
`),
  'cache.js': (def) => entry(def, 'src/cache.js', `class TTLCache {
  constructor({ ttlMs = 300000, maxSize = 1024 } = {}) {
    this.ttlMs = ttlMs;
    this.maxSize = maxSize;
    this.map = new Map();
  }

  get(key) {
    const hit = this.map.get(key);
    if (!hit) return undefined;
    if (Date.now() > hit.expires) {
      this.map.delete(key);
      return undefined;
    }
    return hit.value;
  }

  set(key, value, ttlMs = this.ttlMs) {
    if (this.map.size >= this.maxSize && !this.map.has(key)) {
      this.#evictOne();
    }
    this.map.set(key, { value, expires: Date.now() + ttlMs });
    return value;
  }

  has(key) {
    return this.get(key) !== undefined;
  }

  delete(key) {
    return this.map.delete(key);
  }

  clear() {
    this.map.clear();
  }

  size() {
    return this.map.size;
  }

  #evictOne() {
    let oldest = null;
    for (const [key, entry] of this.map) {
      if (!oldest || entry.expires < oldest.expires) oldest = { key, expires: entry.expires };
    }
    if (oldest) this.map.delete(oldest.key);
  }
}

module.exports = { TTLCache };
`),
  'errors.js': (def) => entry(def, 'src/errors.js', `class AppError extends Error {
  constructor(message, status = 500, code = 'app_error') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

class NotFoundError extends AppError {
  constructor(message = 'not found') {
    super(message, 404, 'not_found');
  }
}

class BadRequestError extends AppError {
  constructor(message = 'bad request') {
    super(message, 400, 'bad_request');
  }
}

class ConflictError extends AppError {
  constructor(message = 'conflict') {
    super(message, 409, 'conflict');
  }
}

class RateLimitError extends AppError {
  constructor(message = 'rate limited') {
    super(message, 429, 'rate_limited');
  }
}

class ConfigError extends AppError {
  constructor(message = 'configuration error') {
    super(message, 500, 'config_error');
  }
}

function toAppError(err) {
  if (err instanceof AppError) return err;
  const wrapped = new AppError(err.message || 'internal error');
  wrapped.cause = err;
  return wrapped;
}

module.exports = { AppError, NotFoundError, BadRequestError, ConflictError, RateLimitError, ConfigError, toAppError };
`),
  'queue.js': (def) => entry(def, 'src/queue.js', `const { EventEmitter } = require('node:events');

class JobQueue extends EventEmitter {
  constructor({ concurrency = 2 } = {}) {
    super();
    this.concurrency = concurrency;
    this.running = 0;
    this.queue = [];
    this.history = [];
  }

  push(task, { priority = 0 } = {}) {
    const job = { id: crypto.randomUUID(), task, priority, at: Date.now() };
    this.queue.push(job);
    this.queue.sort((a, b) => a.priority - b.priority);
    this.emit('enqueued', job);
    this.#pump();
    return job.id;
  }

  size() {
    return this.queue.length + this.running;
  }

  async #pump() {
    if (this.running >= this.concurrency) return;
    const job = this.queue.shift();
    if (!job) return;
    this.running++;
    const start = Date.now();
    this.emit('started', job);
    try {
      const result = await job.task();
      this.emit('done', { job, result, durationMs: Date.now() - start });
      return result;
    } catch (err) {
      this.emit('failed', { job, error: err, durationMs: Date.now() - start });
    } finally {
      this.running--;
      this.history.push({ id: job.id, at: job.at, durationMs: Date.now() - start });
      this.#pump();
    }
  }

  stats() {
    return { pending: this.queue.length, running: this.running, total: this.history.length };
  }
}

module.exports = { JobQueue };
`),
  'events.js': (def) => entry(def, 'src/events.js', `const { EventEmitter } = require('node:events');

class EventBus extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(50);
  }

  onceMany(names, listener) {
    names.forEach((name) => this.once(name, listener));
  }

  emitWith(context, name, payload) {
    return this.emit(name, { ...payload, context, at: new Date().toISOString() });
  }

  spy(name, limit = 100) {
    const events = [];
    const listener = (e) => {
      events.push(e);
      if (events.length > limit) events.shift();
    };
    this.on(name, listener);
    return {
      events,
      stop() {
        this.removeListener(name, listener);
      }
    };
  }
}

const bus = new EventBus();

module.exports = { EventBus, bus };
`),
  'config.js': (def) => entry(def, 'src/config.js', `const fs = require('node:fs');
const path = require('node:path');

const DEFAULTS = {
  port: 4000,
  host: '127.0.0.1',
  verbose: false,
  timeout: 30000,
  retries: 3,
  logLevel: 'info',
  dataDir: './data',
  maxItems: 1000
};

function deepMerge(base, extra) {
  const out = { ...base };
  for (const [k, v] of Object.entries(extra || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object') {
      out[k] = deepMerge(base[k], v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

function loadConfig({ file = null, env = true } = {}) {
  let config = { ...DEFAULTS };

  if (file && fs.existsSync(file)) {
    const raw = fs.readFileSync(file, 'utf8');
    config = deepMerge(config, JSON.parse(raw));
  }

  if (env) {
    if (process.env.PORT) config.port = Number(process.env.PORT);
    if (process.env.HOST) config.host = process.env.HOST;
    if (process.env.VERBOSE === '1') config.verbose = true;
    if (process.env.TIMEOUT) config.timeout = Number(process.env.TIMEOUT);
    if (process.env.RETRIES) config.retries = Number(process.env.RETRIES);
    if (process.env.LOG_LEVEL) config.logLevel = process.env.LOG_LEVEL;
  }

  return config;
}

module.exports = { loadConfig, DEFAULTS };
`),
  'utils.js': (def) => entry(def, 'src/utils.js', `const crypto = require('node:crypto');

function slugify(text) {
  return String(text)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function shortId(bytes = 6) {
  return crypto.randomBytes(bytes).toString('hex');
}

function parseJson(text, fallback = null) {
  try {
    return JSON.parse(text);
  } catch (e) {
    return fallback;
  }
}

function retry(fn, { attempts = 3, delayMs = 200, backoff = 2 } = {}) {
  return async (...args) => {
    let lastErr;
    for (let i = 0; i < attempts; i++) {
      try {
        return await fn(...args);
      } catch (err) {
        lastErr = err;
        if (i < attempts - 1) {
          await new Promise((r) => setTimeout(r, delayMs * Math.pow(backoff, i)));
        }
      }
    }
    throw lastErr;
  };
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function truncate(text, length = 80) {
  if (text.length <= length) return text;
  return text.slice(0, length - 3) + '...';
}

module.exports = { slugify, shortId, parseJson, retry, clamp, truncate };
`),
  'rate-limit.js': (def) => entry(def, 'src/rate-limit.js', `class TokenBucket {
  constructor({ capacity = 60, refillPerSec = 1 } = {}) {
    this.capacity = capacity;
    this.tokens = capacity;
    this.refillPerSec = refillPerSec;
    this.last = Date.now();
  }

  #refill() {
    const now = Date.now();
    const elapsed = (now - this.last) / 1000;
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillPerSec);
    this.last = now;
  }

  take(n = 1) {
    this.#refill();
    if (this.tokens >= n) {
      this.tokens -= n;
      return true;
    }
    return false;
  }

  wait(n = 1, timeoutMs = 30000) {
    return new Promise((resolve, reject) => {
      const started = Date.now();
      const tick = () => {
        if (this.take(n)) return resolve(true);
        if (Date.now() - started > timeoutMs) return reject(new Error('rate limit timeout'));
        setTimeout(tick, 100);
      };
      tick();
    });
  }

  stats() {
    return { available: this.tokens, capacity: this.capacity };
  }
}

module.exports = { TokenBucket };
`),
  'storage.js': (def) => entry(def, 'src/storage.js', `const fs = require('node:fs');
const path = require('node:path');

class JsonStorage {
  constructor(file) {
    this.file = file;
    this.data = this.#load();
  }

  #load() {
    try {
      if (fs.existsSync(this.file)) {
        return JSON.parse(fs.readFileSync(this.file, 'utf8'));
      }
    } catch (e) {
      // corrupted file: start fresh
    }
    return {};
  }

  #save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.file);
  }

  get(key) {
    return this.data[key];
  }

  set(key, value) {
    this.data[key] = value;
    this.#save();
    return value;
  }

  update(key, patch) {
    const current = this.data[key] || {};
    this.data[key] = { ...current, ...patch };
    this.#save();
    return this.data[key];
  }

  delete(key) {
    const existed = key in this.data;
    delete this.data[key];
    if (existed) this.#save();
    return existed;
  }

  list() {
    return Object.entries(this.data).map(([key, value]) => ({ key, value }));
  }

  size() {
    return Object.keys(this.data).length;
  }
}

module.exports = { JsonStorage };
`),
  'metrics.js': (def) => entry(def, 'src/metrics.js', `class Metrics {
  constructor() {
    this.counters = new Map();
    this.gauges = new Map();
    this.timers = new Map();
  }

  incr(name, by = 1) {
    this.counters.set(name, (this.counters.get(name) || 0) + by);
  }

  gauge(name, value) {
    this.gauges.set(name, value);
  }

  time(name, ms) {
    const list = this.timers.get(name) || [];
    list.push(ms);
    this.timers.set(name, list.slice(-1000));
  }

  timer(name, fn) {
    const start = process.hrtime.bigint();
    const result = fn();
    if (result && typeof result.then === 'function') {
      return result.finally(() => {
        const ms = Number(process.hrtime.bigint() - start) / 1e6;
        this.time(name, ms);
      });
    }
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    this.time(name, ms);
    return result;
  }

  snapshot() {
    const out = {};
    for (const [name, value] of this.counters) out['counter_' + name] = value;
    for (const [name, value] of this.gauges) out['gauge_' + name] = value;
    for (const [name, list] of this.timers) {
      if (!list.length) continue;
      const sorted = [...list].sort((a, b) => a - b);
      out['timer_' + name + '_p50'] = sorted[Math.floor(sorted.length / 2)];
      out['timer_' + name + '_max'] = sorted[sorted.length - 1];
    }
    return out;
  }
}

module.exports = { Metrics };
`),
  'formatters.js': (def) => entry(def, 'src/formatters.js', `function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return (bytes / Math.pow(1024, i)).toFixed(1) + ' ' + units[i];
}

function formatDuration(ms) {
  if (ms < 1000) return Math.round(ms) + 'ms';
  if (ms < 60000) return (ms / 1000).toFixed(1) + 's';
  return (ms / 60000).toFixed(1) + 'm';
}

function jsonPretty(data) {
  return JSON.stringify(data, null, 2);
}

function pad(value, width = 2) {
  return String(value).padStart(width, '0');
}

function timeStamp(date = new Date()) {
  return (
    date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()) +
    ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes()) + ':' + pad(date.getSeconds())
  );
}

function table(rows, columns = null) {
  if (!rows.length) return '(empty)';
  const keys = columns || Object.keys(rows[0]);
  const widths = keys.map((k) => Math.max(k.length, ...rows.map((r) => String(r[k] ?? '').length)));
  const border = '+-' + widths.map((w) => '-'.repeat(w)).join('-+-') + '-+';
  const header = '| ' + keys.map((k, i) => k.padEnd(widths[i])).join(' | ') + ' |';
  const body = rows.map((r) => '| ' + keys.map((k, i) => String(r[k] ?? '').padEnd(widths[i])).join(' | ') + ' |');
  return [border, header, border, ...body, border].join('\\n');
}

module.exports = { formatBytes, formatDuration, jsonPretty, pad, timeStamp, table };
`),
  'monitoring.js': (def) => entry(def, 'src/monitoring.js', `class Monitor {
  constructor({ windowMs = 300000 } = {}) {
    this.windowMs = windowMs;
    this.events = [];
    this.started = Date.now();
  }

  record(name, durationMs = null, ok = true) {
    this.events.push({ name, at: Date.now(), durationMs, ok });
    if (this.events.length > 10000) this.events.shift();
  }

  uptimeMs() {
    return Date.now() - this.started;
  }

  snapshot() {
    const cutoff = Date.now() - this.windowMs;
    const recent = this.events.filter((e) => e.at >= cutoff);
    const byName = {};
    for (const e of recent) {
      byName[e.name] = byName[e.name] || { count: 0, totalMs: 0, failures: 0 };
      byName[e.name].count += 1;
      if (e.durationMs !== null) byName[e.name].totalMs += e.durationMs;
      if (!e.ok) byName[e.name].failures += 1;
    }
    const out = {};
    for (const [name, stat] of Object.entries(byName)) {
      out[name] = {
        count: stat.count,
        failures: stat.failures,
        avgMs: stat.count ? Math.round(stat.totalMs / stat.count) : null
      };
    }
    return { uptimeMs: this.uptimeMs(), windowMs: this.windowMs, calls: recent.length, byName: out };
  }
}

module.exports = { Monitor };
`),
  'middleware.js': (def) => entry(def, 'src/middleware.js', `function withLogger(logger) {
  return (req, res, next) => {
    const start = Date.now();
    const { method, url } = req;
    res.on('finish', () => {
      logger.info(method + ' ' + url, { status: res.statusCode, ms: Date.now() - start });
    });
    next();
  };
}

function withCors(allowed = ['*']) {
  return (req, res, next) => {
    const origin = req.headers.origin;
    if (allowed.includes('*') || allowed.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin || '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
    }
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      return res.end();
    }
    next();
  };
}

function withErrorHandler(handle) {
  return (req, res, next) => {
    Promise.resolve(handle(req, res, next)).catch(next);
  };
}

function notFoundHandler(req, res) {
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'not_found', path: req.url }));
}

function jsonBody() {
  return (req, res, next) => {
    if (req.method !== 'POST' && req.method !== 'PUT') return next();
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      try {
        req.body = raw ? JSON.parse(raw) : {};
      } catch (e) {
        req.body = {};
      }
      next();
    });
  };
}

module.exports = { withLogger, withCors, withErrorHandler, notFoundHandler, jsonBody };
`),
  'hooks.js': (def) => entry(def, 'src/hooks.js', `class Hooks {
  constructor() {
    this._handlers = new Map();
  }

  on(event, fn) {
    if (!this._handlers.has(event)) this._handlers.set(event, []);
    this._handlers.get(event).push(fn);
    return this;
  }

  off(event, fn) {
    const list = this._handlers.get(event) || [];
    const idx = list.indexOf(fn);
    if (idx >= 0) list.splice(idx, 1);
  }

  async fire(event, payload = {}) {
    const list = this._handlers.get(event) || [];
    for (const fn of list) {
      await fn(payload);
    }
  }

  names() {
    return [...this._handlers.keys()];
  }
}

const hooks = new Hooks();

module.exports = { Hooks, hooks };
`),
};

const NODE_MODULE_ORDER = [
  'errors.js', 'logger.js', 'config.js', 'utils.js', 'cache.js', 'queue.js',
  'events.js', 'storage.js', 'rate-limit.js', 'metrics.js', 'formatters.js', 'monitoring.js', 'middleware.js', 'hooks.js'
];

function nodeModules(def, names) {
  return names.map((n) => NODE_MODULES[n](def));
}

// ---------------- Go modules ----------------
const GO_MODULES = {
  'config.go': (def) => entry(def, 'internal/core/config.go', `package core

import (
	"os"
	"strconv"
	"strings"
)

// Config is loaded once at startup and stays immutable during a run.
type Config struct {
	Port      int
	Host      string
	Verbose   bool
	TimeoutS  int
	Retries   int
	LogLevel  string
	DataDir   string
}

// LoadConfig reads configuration from environment variables.
func LoadConfig() Config {
	return Config{
		Port:     envInt("PORT", 8080),
		Host:     envStr("HOST", "127.0.0.1"),
		Verbose:  envBool("VERBOSE"),
		TimeoutS: envInt("TIMEOUT_S", 30),
		Retries:  envInt("RETRIES", 3),
		LogLevel: strings.ToLower(envStr("LOG_LEVEL", "info")),
		DataDir:  envStr("DATA_DIR", "./data"),
	}
}

func envInt(key string, fallback int) int {
	raw := os.Getenv(key)
	if raw == "" {
		return fallback
	}
	if v, err := strconv.Atoi(raw); err == nil {
		return v
	}
	return fallback
}

func envBool(key string) bool {
	return os.Getenv(key) == "1" || os.Getenv(key) == "true"
}

func envStr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
`),
  'logger.go': (def) => entry(def, 'internal/core/logger.go', `package core

import (
	"fmt"
	"log"
	"os"
	"strings"
	"time"
)

// Logger is a tiny leveled logger.
type Logger struct {
	level int
	out   *log.Logger
}

const (
	LevelDebug = iota
	LevelInfo
	LevelWarn
	LevelError
)

// NewLogger builds a logger at the given level name.
func NewLogger(level string) *Logger {
	lvl := LevelInfo
	switch strings.ToLower(level) {
	case "debug":
		lvl = LevelDebug
	case "warn", "warning":
		lvl = LevelWarn
	case "error":
		lvl = LevelError
	}
	return &Logger{level: lvl, out: log.New(os.Stderr, "", 0)}
}

func (l *Logger) log(lvl int, tag string, format string, args ...any) {
	if lvl < l.level {
		return
	}
	ts := time.Now().Format("15:04:05")
	msg := fmt.Sprintf(format, args...)
	l.out.Printf("[%s] %-5s %s", ts, tag, msg)
}

func (l *Logger) Debugf(format string, args ...any) { l.log(LevelDebug, "DEBUG", format, args...) }
func (l *Logger) Infof(format string, args ...any)  { l.log(LevelInfo, "INFO", format, args...) }
func (l *Logger) Warnf(format string, args ...any)  { l.log(LevelWarn, "WARN", format, args...) }
func (l *Logger) Errorf(format string, args ...any) { l.log(LevelError, "ERROR", format, args...) }
`),
  'cache.go': (def) => entry(def, 'internal/core/cache.go', `package core

import (
	"sync"
	"time"
)

type cacheEntry struct {
	value     any
	expiresAt time.Time
}

// Cache is a small thread-safe TTL cache.
type Cache struct {
	mu    sync.RWMutex
	items map[string]cacheEntry
	ttl   time.Duration
}

// NewCache creates a cache with the given TTL.
func NewCache(ttl time.Duration) *Cache {
	return &Cache{items: make(map[string]cacheEntry), ttl: ttl}
}

func (c *Cache) Get(key string) (any, bool) {
	c.mu.RLock()
	entry, ok := c.items[key]
	c.mu.RUnlock()
	if !ok {
		return nil, false
	}
	if time.Now().After(entry.expiresAt) {
		c.mu.Lock()
		delete(c.items, key)
		c.mu.Unlock()
		return nil, false
	}
	return entry.value, true
}

func (c *Cache) Set(key string, value any) {
	c.mu.Lock()
	c.items[key] = cacheEntry{value: value, expiresAt: time.Now().Add(c.ttl)}
	c.mu.Unlock()
}

func (c *Cache) Delete(key string) {
	c.mu.Lock()
	delete(c.items, key)
	c.mu.Unlock()
}

func (c *Cache) Size() int {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return len(c.items)
}
`),
  'http.go': (def) => entry(def, 'internal/core/http.go', `package core

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

// Client is a small HTTP wrapper with retries and timeouts.
type Client struct {
	base    string
	token   string
	timeout time.Duration
	retries int
	client  *http.Client
}

// NewClient builds an HTTP client.
func NewClient(base, token string, timeout time.Duration, retries int) *Client {
	return &Client{
		base:    base,
		token:   token,
		timeout: timeout,
		retries: retries,
		client:  &http.Client{Timeout: timeout},
	}
}

func (c *Client) request(ctx context.Context, method, path string, body io.Reader, out any) error {
	var lastErr error
	for attempt := 0; attempt <= c.retries; attempt++ {
		req, err := http.NewRequestWithContext(ctx, method, c.base+path, body)
		if err != nil {
			return err
		}
		req.Header.Set("Content-Type", "application/json")
		if c.token != "" {
			req.Header.Set("Authorization", "Bearer "+c.token)
		}
		resp, err := c.client.Do(req)
		if err != nil {
			lastErr = err
			time.Sleep(time.Duration(attempt+1) * 200 * time.Millisecond)
			continue
		}
		defer resp.Body.Close()
		if resp.StatusCode >= 400 {
			lastErr = fmt.Errorf("http %d", resp.StatusCode)
			time.Sleep(time.Duration(attempt+1) * 200 * time.Millisecond)
			continue
		}
		if out == nil {
			return nil
		}
		return json.NewDecoder(resp.Body).Decode(out)
	}
	return lastErr
}

func (c *Client) Get(ctx context.Context, path string, out any) error {
	return c.request(ctx, http.MethodGet, path, nil, out)
}

func (c *Client) Post(ctx context.Context, path string, payload, out any) error {
	body, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	return c.request(ctx, http.MethodPost, path, bytesReader(body), out)
}
`),
  'metrics.go': (def) => entry(def, 'internal/core/metrics.go', `package core

import (
	"fmt"
	"sync"
)

// Metrics tracks counters and gauges for the process.
type Metrics struct {
	mu       sync.RWMutex
	counters map[string]int64
	gauges   map[string]float64
}

// NewMetrics creates an empty metrics registry.
func NewMetrics() *Metrics {
	return &Metrics{counters: make(map[string]int64), gauges: make(map[string]float64)}
}

func (m *Metrics) Incr(name string, by int64) {
	m.mu.Lock()
	m.counters[name] += by
	m.mu.Unlock()
}

func (m *Metrics) Set(name string, value float64) {
	m.mu.Lock()
	m.gauges[name] = value
	m.mu.Unlock()
}

// Snapshot returns a stable copy of all metrics.
func (m *Metrics) Snapshot() map[string]string {
	m.mu.RLock()
	defer m.mu.RUnlock()
	out := make(map[string]string, len(m.counters)+len(m.gauges))
	for k, v := range m.counters {
		out["counter_"+k] = fmt.Sprint(v)
	}
	for k, v := range m.gauges {
		out["gauge_"+k] = fmt.Sprintf("%.3f", v)
	}
	return out
}
`),
  'worker.go': (def) => entry(def, 'internal/core/worker.go', `package core

import (
	"context"
	"sync"
	"sync/atomic"
)

// Task is a unit of work for the worker pool.
type Task struct {
	ID     int64
	Handle func(ctx context.Context) error
}

// WorkerPool runs tasks with a fixed concurrency.
type WorkerPool struct {
	ctx       context.Context
	cancel    context.CancelFunc
	jobs      chan Task
	wg        sync.WaitGroup
	processed atomic.Int64
	failed    atomic.Int64
}

// NewWorkerPool creates a pool with n workers.
func NewWorkerPool(n int) *WorkerPool {
	ctx, cancel := context.WithCancel(context.Background())
	pool := &WorkerPool{
		ctx:    ctx,
		cancel: cancel,
		jobs:   make(chan Task, 64),
	}
	for i := 0; i < n; i++ {
		pool.wg.Add(1)
		go pool.worker(i)
	}
	return pool
}

func (p *WorkerPool) worker(id int) {
	defer p.wg.Done()
	for {
		select {
		case <-p.ctx.Done():
			return
		case task, ok := <-p.jobs:
			if !ok {
				return
			}
			if err := task.Handle(p.ctx); err != nil {
				p.failed.Add(1)
			} else {
				p.processed.Add(1)
			}
		}
	}
}

// Submit queues a task.
func (p *WorkerPool) Submit(task Task) {
	select {
	case p.jobs <- task:
	case <-p.ctx.Done():
	}
}

// Stop cancels the pool and waits for workers.
func (p *WorkerPool) Stop() {
	p.cancel()
	p.wg.Wait()
}

// Stats returns processed and failed counts.
func (p *WorkerPool) Stats() (int64, int64) {
	return p.processed.Load(), p.failed.Load()
}
`),
  'runner.go': (def) => entry(def, 'internal/core/runner.go', `package core

import (
	"context"
	"time"
)

// Runner executes a series of steps with timing and failure reporting.
type Runner struct {
	logger *Logger
	steps  []func(ctx context.Context) error
}

// NewRunner builds a runner bound to a logger.
func NewRunner(logger *Logger) *Runner {
	return &Runner{logger: logger}
}

// Add appends a step to the runner.
func (r *Runner) Add(step func(ctx context.Context) error) *Runner {
	r.steps = append(r.steps, step)
	return r
}

// Run executes every step, returning the first error encountered.
func (r *Runner) Run(ctx context.Context) error {
	for i, step := range r.steps {
		start := time.Now()
		if err := step(ctx); err != nil {
			r.logger.Errorf("step %d failed after %s: %v", i+1, time.Since(start), err)
			return err
		}
		if ctx.Err() != nil {
			return ctx.Err()
		}
		r.logger.Infof("step %d done in %s", i+1, time.Since(start))
	}
	return nil
}
`),
  'validator.go': (def) => entry(def, 'internal/core/validator.go', `package core

import (
	"fmt"
	"regexp"
	"strings"
)

// Validator checks values against rules and collects errors.
type Validator struct {
	errors []string
}

// NewValidator creates an empty validator.
func NewValidator() *Validator {
	return &Validator{}
}

func (v *Validator) add(err string) {
	v.errors = append(v.errors, err)
}

// Required ensures the value is not empty.
func (v *Validator) Required(name, value string) *Validator {
	if strings.TrimSpace(value) == "" {
		v.add(fmt.Sprintf("%s is required", name))
	}
	return v
}

// MinLength ensures the value is long enough.
func (v *Validator) MinLength(name, value string, min int) *Validator {
	if len(value) < min {
		v.add(fmt.Sprintf("%s must be at least %d characters", name, min))
	}
	return v
}

// MaxLength ensures the value is short enough.
func (v *Validator) MaxLength(name, value string, max int) *Validator {
	if len(value) > max {
		v.add(fmt.Sprintf("%s must be at most %d characters", name, max))
	}
	return v
}

// Slug ensures the value is a valid slug.
func (v *Validator) Slug(name, value string) *Validator {
	re := regexp.MustCompile(` + "`^[a-z0-9-]+$`" + `)
	if !re.MatchString(value) {
		v.add(fmt.Sprintf("%s must be a lowercase slug", name))
	}
	return v
}

// Valid returns true when no errors were collected.
func (v *Validator) Valid() bool {
	return len(v.errors) == 0
}

// Errors returns the collected errors.
func (v *Validator) Errors() []string {
	return v.errors
}
`),
};

const GO_MODULE_ORDER = ['config.go', 'logger.go', 'cache.go', 'http.go', 'metrics.go', 'worker.go', 'runner.go', 'validator.go'];

function goModules(def, names) {
  return names.map((n) => GO_MODULES[n](def));
}

// ---------------- Frontend extra pages ----------------
function frontendPages(def) {
  return [
    entry(def, 'public/about.html', `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>About - ${def.title}</title>
  <link rel="stylesheet" href="/style.css">
</head>
<body>
  <header class="nav"><div class="wrap nav-inner">
    <a class="brand" href="/">${def.title}</a>
    <nav><a href="/">Home</a><a href="/about.html">About</a><a href="/docs.html">Docs</a><a class="btn" href="/api/stats">API</a></nav>
  </div></header>
  <main class="wrap page">
    <h1>About ${def.title}</h1>
    <p>${def.blurb}</p>
    <h2>Why this exists</h2>
    <p>The project started as a small tool to solve one specific problem. Over time it grew into a dependable utility that stays focused and easy to extend. The goal is simple: do the core job well and get out of the way.</p>
    <h2>Design principles</h2>
    <ul>
      <li>Small core, rich ecosystem.</li>
      <li>Plain data over clever abstractions.</li>
      <li>Clear errors over silent failures.</li>
      <li>Fast by default, tunable when needed.</li>
    </ul>
  </main>
  <footer class="footer"><div class="wrap">${def.title} - built with plain HTML, CSS and Node.</div></footer>
</body>
</html>
`),
    entry(def, 'public/docs.html', `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Docs - ${def.title}</title>
  <link rel="stylesheet" href="/style.css">
</head>
<body>
  <header class="nav"><div class="wrap nav-inner">
    <a class="brand" href="/">${def.title}</a>
    <nav><a href="/">Home</a><a href="/about.html">About</a><a href="/docs.html">Docs</a></nav>
  </div></header>
  <main class="wrap page">
    <h1>Documentation</h1>
    <h2>Getting started</h2>
    <p>Clone the repository and run it with <code>npm start</code>. The server listens on <code>PORT</code> (default 8080).</p>
    <h2>Configuration</h2>
    <p>All options are environment variables:</p>
    <ul>
      <li><code>PORT</code> - server port</li>
      <li><code>HOST</code> - bind address</li>
      <li><code>VERBOSE</code> - enable verbose logging</li>
      <li><code>DATA_DIR</code> - where state is stored</li>
    </ul>
    <h2>API</h2>
    <ul>
      <li><code>GET /api/stats</code> - runtime statistics</li>
      <li><code>GET /api/health</code> - health check</li>
      <li><code>GET /api/items</code> - list items</li>
      <li><code>POST /api/items</code> - create an item</li>
    </ul>
  </main>
  <footer class="footer"><div class="wrap">${def.title} docs.</div></footer>
</body>
</html>
`),
    entry(def, 'public/api.js', `// Client helpers for ${def.title}.
async function apiGet(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error('request failed: ' + res.status);
  return res.json();
}

async function apiPost(path, body) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error('request failed: ' + res.status);
  return res.json();
}

function fmtTime(ts) {
  return new Date(ts).toLocaleString();
}

function fmtNumber(n) {
  return new Intl.NumberFormat().format(n);
}

window.api = { get: apiGet, post: apiPost, time: fmtTime, number: fmtNumber };
`),
    entry(def, 'public/theme.js', `// Minimal theme helper for ${def.title}.
(function () {
  const saved = localStorage.getItem('theme');
  if (saved === 'dark') document.documentElement.classList.add('dark');

  const toggle = document.createElement('button');
  toggle.textContent = saved === 'dark' ? 'Light' : 'Dark';
  toggle.className = 'theme-toggle';
  toggle.addEventListener('click', () => {
    const isDark = document.documentElement.classList.toggle('dark');
    localStorage.setItem('theme', isDark ? 'dark' : 'light');
    toggle.textContent = isDark ? 'Light' : 'Dark';
  });
  document.addEventListener('DOMContentLoaded', () => {
    const nav = document.querySelector('.nav-inner');
    if (nav) nav.appendChild(toggle);
  });
})();
`),
    entry(def, 'public/app2.js', `// Secondary interactivity for ${def.title}.
document.addEventListener('DOMContentLoaded', () => {
  const forms = document.querySelectorAll('form[data-ajax]');
  forms.forEach((form) => {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const data = Object.fromEntries(new FormData(form));
      const res = await fetch(form.action || '/api/items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      const result = await res.json();
      const msg = document.getElementById('form-result');
      if (msg) msg.textContent = res.ok ? 'Saved.' : result.error || 'Failed.';
    });
  });
});
`),
    entry(def, 'public/theme.css', `/* Theme support for ${def.title} */
:root {
  --paper: #ffffff;
  --ink: #171b26;
  --line: #e6e8ef;
  --accent: #5b4dff;
  --muted: #5b6472;
}
.dark {
  --paper: #0f1222;
  --ink: #e7e9f4;
  --line: #232849;
  --muted: #8b93b0;
}
.theme-toggle {
  margin-left: 16px;
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 6px 12px;
  background: transparent;
  color: var(--ink);
  cursor: pointer;
}
.page { padding: 48px 0 70px; max-width: 760px; }
.page h1 { font-size: 34px; letter-spacing: -.02em; }
.page h2 { margin-top: 28px; font-size: 20px; }
.page p, .page li { color: var(--muted); }
`)
  ];
}

function chromeExtras(def) {
  return [
    entry(def, 'options.html', `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Options - ${def.title}</title><link rel="stylesheet" href="popup.css"></head>
<body>
  <main class="box">
    <h1>${def.title} options</h1>
    <label>Interval (seconds)<input id="interval" type="number" min="1" value="60"></label>
    <label>Show badge<input id="badge" type="checkbox"></label>
    <button id="save">Save</button>
    <p class="hint" id="status"></p>
  </main>
  <script src="options.js"></script>
</body>
</html>
`),
    entry(def, 'options.js', `const interval = document.getElementById('interval');
const badge = document.getElementById('badge');
const status = document.getElementById('status');

function load() {
  chrome.storage.sync.get({ interval: 60, badge: true }, (opts) => {
    interval.value = opts.interval;
    badge.checked = opts.badge;
  });
}

function save() {
  chrome.storage.sync.set({
    interval: Math.max(1, Number(interval.value) || 60),
    badge: badge.checked
  }, () => {
    status.textContent = 'Saved at ' + new Date().toLocaleTimeString();
    chrome.runtime.sendMessage({ type: 'OPTIONS_CHANGED' });
  });
}

load();
document.getElementById('save').addEventListener('click', save);
`),
    entry(def, 'background2.js', `// Background worker additions for ${def.title}.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'OPTIONS_CHANGED') {
    refreshBadge();
  }
  sendResponse({ ok: true });
});

async function refreshBadge() {
  const opts = await chrome.storage.sync.get({ badge: true, interval: 60 });
  if (!opts.badge) {
    chrome.action.setBadgeText({ text: '' });
    return;
  }
  const now = new Date();
  const text = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
  chrome.action.setBadgeText({ text });
  chrome.action.setBadgeBackgroundColor({ color: '#5b4dff' });
}

setInterval(refreshBadge, 15000);
refreshBadge();
`)
  ];
}

module.exports = {
  PYTHON_MODULE_ORDER,
  NODE_MODULE_ORDER,
  GO_MODULE_ORDER,
  pythonModules,
  nodeModules,
  goModules,
  frontendPages,
  chromeExtras
};
