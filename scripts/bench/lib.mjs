/**
 * Shared helpers for the benchmark scripts: paths, argument parsing, a seeded PRNG,
 * hashing, robust statistics and formatting. Nothing here touches the network.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const BENCH_DIR = join(ROOT, "bench");
export const CACHE_DIR = join(ROOT, ".bench-cache");
export const PROFILE_FILE = join(BENCH_DIR, "profile.json");
export const SNIPPETS_FILE = join(BENCH_DIR, "synth-snippets.json");
export const LOCAL_CORPUS_FILE = join(BENCH_DIR, "corpus.local.json");
export const RULE_ID = "baseline-js/use-baseline";

/**
 * Parse `--name value` and `--flag` arguments against defaults; the default's type
 * decides how a value is parsed (`--no-flag` clears a boolean).
 */
export function parseArgs(argv, defaults, { usage } = {}) {
  const out = { ...defaults, _: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      if (usage) console.log(usage);
      process.exit(0);
    }
    if (!arg.startsWith("--")) {
      out._.push(arg);
      continue;
    }
    let key = arg.slice(2);
    let value;
    const eq = key.indexOf("=");
    if (eq !== -1) {
      value = key.slice(eq + 1);
      key = key.slice(0, eq);
    }
    const camel = key.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    if (camel.startsWith("no") && camel.length > 2 && camel[2] === camel[2].toUpperCase()) {
      const target = camel[2].toLowerCase() + camel.slice(3);
      if (typeof defaults[target] === "boolean") {
        out[target] = false;
        continue;
      }
    }
    if (!(camel in defaults)) throw new Error(`unknown option: ${arg}`);
    if (typeof defaults[camel] === "boolean") {
      out[camel] = value === undefined ? true : value !== "false";
      continue;
    }
    if (value === undefined) value = argv[++i];
    if (value === undefined) throw new Error(`missing value for ${arg}`);
    out[camel] = typeof defaults[camel] === "number" ? Number(value) : value;
  }
  return out;
}

export function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

export function writeJson(file, data) {
  writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
}

export function sha256(data) {
  return createHash("sha256").update(data).digest("hex");
}

export function sha256File(file) {
  return sha256(readFileSync(file));
}

/** Sort object keys recursively so that JSON output and hashes are stable. */
export function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((k) => [k, stable(value[k])]),
    );
  }
  return value;
}

function hashSeed(seed) {
  let h = 0x811c9dc5;
  for (const ch of String(seed)) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Deterministic PRNG (mulberry32) with the sampling helpers the generator needs. */
export function createRng(seed) {
  let a = typeof seed === "number" ? seed >>> 0 : hashSeed(seed);
  const next = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const rng = {
    next,
    int: (maxExclusive) => Math.floor(next() * maxExclusive),
    chance: (p) => next() < p,
    pick: (items) => items[Math.floor(next() * items.length)],
    normal() {
      const u = 1 - next();
      const v = next();
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    },
    logNormal(mu, sigma) {
      return Math.exp(mu + sigma * rng.normal());
    },
  };
  return rng;
}

/** Weighted sampler over `{ item: weight }`; keys are sorted so results are stable. */
export function createSampler(weights) {
  const items = Object.keys(weights).sort();
  const cumulative = [];
  let total = 0;
  for (const item of items) {
    total += weights[item];
    cumulative.push(total);
  }
  if (!items.length || total <= 0) return () => null;
  return (rng) => {
    const r = rng.next() * total;
    let lo = 0;
    let hi = cumulative.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cumulative[mid] < r) lo = mid + 1;
      else hi = mid;
    }
    return items[lo];
  };
}

export function mean(values) {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : Number.NaN;
}

export function quantile(values, q) {
  if (!values.length) return Number.NaN;
  const s = [...values].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

export function median(values) {
  return quantile(values, 0.5);
}

/** Relative run-to-run spread: (max − min) / median. */
export function spread(values) {
  if (values.length < 2) return 0;
  const m = median(values);
  return m ? (Math.max(...values) - Math.min(...values)) / m : 0;
}

/**
 * Two-sided sign test p-value for paired observations: the probability of a split at
 * least this lopsided if head and base were equally likely to win each pair.
 */
export function signTestP(wins, losses) {
  const n = wins + losses;
  if (n === 0) return 1;
  const k = Math.min(wins, losses);
  let coefficient = 1;
  let tail = 0;
  for (let i = 0; i <= k; i++) {
    if (i > 0) coefficient = (coefficient * (n - i + 1)) / i;
    tail += coefficient;
  }
  return Math.min(1, (2 * tail) / 2 ** n);
}

export function fmtMs(ms) {
  if (!Number.isFinite(ms)) return "n/a";
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${ms.toFixed(1)} ms`;
}

export function fmtMsFine(ms) {
  if (!Number.isFinite(ms)) return "n/a";
  if (ms >= 100) return `${ms.toFixed(0)} ms`;
  return ms >= 10 ? `${ms.toFixed(1)} ms` : `${ms.toFixed(3)} ms`;
}

export function fmtMb(kb) {
  return Number.isFinite(kb) ? `${(kb / 1024).toFixed(0)} MB` : "n/a";
}

export function deltaPct(base, head) {
  if (!Number.isFinite(base) || !Number.isFinite(head) || base === 0) return Number.NaN;
  return ((head - base) / base) * 100;
}

export function fmtDelta(base, head) {
  const pct = deltaPct(base, head);
  if (!Number.isFinite(pct)) return "n/a";
  const magnitude = Math.abs(pct).toFixed(1);
  return `${pct > 0 ? "+" : pct < 0 ? "−" : "±"}${magnitude}%`;
}

export function fmtInt(n) {
  return Number.isFinite(n) ? n.toLocaleString("en-US") : "n/a";
}

export function fmtP(p) {
  return p < 0.001 ? "p < 0.001" : `p = ${p.toFixed(2)}`;
}

export function git(args, opts = {}) {
  const result = spawnSync("git", args, {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...opts,
  });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${(result.stderr ?? "").trim()}`);
  }
  return result.stdout.trim();
}
