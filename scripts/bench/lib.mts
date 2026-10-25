/** Paths, JSON files, hashing, git and a seeded PRNG for the bench scripts. */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { z } from "zod";

export const ROOT = resolve(import.meta.dirname, "..", "..");
export const BENCH_DIR = join(ROOT, "bench");
export const CACHE_DIR = join(ROOT, ".bench-cache");

/** Type-aware lint must see real paths inside the repository, never the OS tmpdir. */
export const TMP_DIR = join(CACHE_DIR, "tmp");
export const PROFILE_FILE = join(BENCH_DIR, "profile.json");
export const SNIPPETS_FILE = join(BENCH_DIR, "synth-snippets.json");
export const LOCAL_CORPUS_FILE = join(BENCH_DIR, "corpus.local.json");
export const TRIGGERS_FILE = join(BENCH_DIR, "perf-triggers.json");
export const DIST_PLUGIN = join(ROOT, "dist", "index.mjs");

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

/** Zod schemas satisfy this structurally. */
export interface Parser<T> {
  parse(input: JsonValue): T;
}

/** `T` itself when it serialises to JSON; unlike `JsonValue` it admits interfaces. */
export type Json<T> = T extends string | number | boolean | null | undefined
  ? T
  : T extends bigint | symbol | ((...args: never[]) => void)
    ? never
    : T extends readonly (infer Item)[]
      ? readonly Json<Item>[]
      : { readonly [K in keyof T]: Json<T[K]> };

export function parseJson<T>(text: string, schema: Parser<T>): T {
  const value: JsonValue = JSON.parse(text);

  return schema.parse(value);
}

export function readJsonFile<T>(file: string, schema: Parser<T>): T {
  const text = readFileSync(file, "utf8");

  try {
    return parseJson(text, schema);
  } catch (error) {
    const detail = error instanceof z.ZodError ? z.prettifyError(error) : String(error);

    throw new Error(`${file}: ${detail}`, { cause: error });
  }
}

export function writeJson<T>(file: string, value: T & Json<T>): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function sortKeys(_key: string, value: JsonValue): JsonValue {
  if (!(value instanceof Object) || Array.isArray(value)) return value;

  return Object.fromEntries(Object.entries(value).sort(([a], [b]) => compareText(a, b)));
}

export function canonicalJson<T>(value: T & Json<T>, indent = 0): string {
  return JSON.stringify(value, sortKeys, indent);
}

export function sha256(input: string | Uint8Array): string {
  return createHash("sha256").update(input).digest("hex");
}

/** CRLF is normalised so a Windows checkout gives the same hash. */
export function sha256File(file: string): string {
  return sha256(readFileSync(file, "utf8").replaceAll("\r\n", "\n"));
}

/** Code-unit order, independent of the locale. */
export function compareText(a: string, b: string): number {
  if (a < b) return -1;

  return a > b ? 1 : 0;
}

export function git(args: readonly string[], { cwd = ROOT }: { cwd?: string } = {}): string {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (result.error) throw result.error;

  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr.trim()}`);
  }

  return result.stdout.trim();
}

export interface Rng {
  /** Uniform in [0, 1). */
  next(): number;
  /** Uniform integer in [0, n). */
  int(n: number): number;
  chance(p: number): boolean;
  pick<T>(items: readonly T[]): T;
  normal(): number;
}

/** FNV-1a over the UTF-16 code units of the seed. */
function hashSeed(seed: string): number {
  let hash = 0x811c9dc5;

  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }

  return hash >>> 0;
}

/** mulberry32: tiny and identical on every engine, so corpora are reproducible. */
export function createRng(seed: string): Rng {
  let state = hashSeed(seed);

  const next = (): number => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;

    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const int = (n: number): number => {
    if (!Number.isInteger(n) || n < 1) {
      throw new RangeError(`int() needs a positive integer, got ${n}`);
    }

    return Math.floor(next() * n);
  };

  return {
    next,
    int,
    chance: (p) => next() < p,
    pick<T>(items: readonly T[]): T {
      if (items.length === 0) throw new RangeError("pick() needs a non-empty list");

      // SAFETY: int(length) is in range; T may include undefined, so no check can replace this.
      return items[int(items.length)] as T;
    },
    normal() {
      const u = 1 - next();
      const v = next();

      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    },
  };
}

/** An integer whose mean is exactly `expected`: the fraction is the chance of rounding up. */
export function drawCount(rng: Rng, expected: number): number {
  if (!Number.isFinite(expected) || expected < 0) {
    throw new RangeError(`drawCount() needs a finite non-negative expectation, got ${expected}`);
  }

  return Math.floor(expected + rng.next());
}

export type Sampler<T> = (rng: Rng) => T;

interface SamplerRow<T> {
  item: T;
  upTo: number;
}

/** Draws follow the entries' order, so sort object keys first; zero weights never draw. */
export function createSampler<T>(entries: ReadonlyArray<readonly [T, number]>): Sampler<T> {
  const rows: Array<SamplerRow<T>> = [];
  let total = 0;

  for (const [item, weight] of entries) {
    if (!Number.isFinite(weight) || weight < 0) {
      throw new RangeError(`sampler weights must be finite and non-negative, got ${weight}`);
    }

    total += weight;
    rows.push({ item, upTo: total });
  }

  if (total <= 0) throw new RangeError("sampler needs at least one positive weight");

  const row = (index: number): SamplerRow<T> => {
    const found = rows[index];

    if (found === undefined) throw new RangeError(`sampler row ${index} out of range`);

    return found;
  };

  return (rng) => {
    const r = rng.next() * total;
    let lo = 0;
    let hi = rows.length - 1;

    while (lo < hi) {
      const mid = (lo + hi) >>> 1;

      if (row(mid).upTo <= r) lo = mid + 1;
      else hi = mid;
    }

    return row(lo).item;
  };
}
