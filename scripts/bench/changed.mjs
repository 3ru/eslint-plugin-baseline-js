#!/usr/bin/env node
/**
 * Decide whether a change set needs the perf benchmark, using bench/perf-triggers.json.
 *
 *   node scripts/bench/changed.mjs --base origin/main            # files changed vs a ref
 *   node scripts/bench/changed.mjs --base <sha> --head <sha>
 *   node scripts/bench/changed.mjs --files docs/a.md,src/x.ts   # explicit list, for testing
 *   node scripts/bench/changed.mjs ... --github-output "$GITHUB_OUTPUT"
 *
 * A changed file triggers the benchmark unless it sits under an ignored directory, has an
 * ignored extension or is an ignored file; paths listed under `alwaysRun` trigger it even
 * when a rule would ignore them. The decision and the triggering files are printed, and
 * written as `run` and `reason` outputs when --github-output is given.
 */
import { appendFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { BENCH_DIR, git, parseArgs, readJson } from "./lib.mjs";

const USAGE = `usage: node scripts/bench/changed.mjs [--base <ref>] [--head <ref>] [--files a,b] [--config <file>] [--github-output <file>]`;
const args = parseArgs(
  process.argv.slice(2),
  {
    base: "",
    head: "HEAD",
    files: "",
    config: join(BENCH_DIR, "perf-triggers.json"),
    githubOutput: "",
  },
  { usage: USAGE },
);

const config = readJson(resolve(args.config));
const norm = (p) => p.replace(/\\/g, "/").replace(/^\.\//, "");
const dirs = (config.ignoreDirectories ?? []).map(norm);
const exts = (config.ignoreExtensions ?? []).map((e) => e.toLowerCase());
const files = new Set((config.ignoreFiles ?? []).map(norm));
const always = (config.alwaysRun ?? []).map(norm);

/** Why a file triggers the benchmark, or null when it is ignored. */
export function classify(path) {
  const p = norm(path);
  const lower = p.toLowerCase();
  const alwaysHit = always.find((a) => (a.endsWith("/") ? p.startsWith(a) : p === a));
  if (alwaysHit) return `always runs for ${alwaysHit}`;
  if (files.has(p)) return null;
  if (dirs.some((d) => p.startsWith(d))) return null;
  if (exts.some((e) => lower.endsWith(e))) return null;
  return "code or build input";
}

let changed;
if (args.files) {
  changed = args.files
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
} else if (args.base) {
  changed = git(["diff", "--name-only", "--diff-filter=ACMRD", args.base, args.head])
    .split("\n")
    .filter(Boolean);
} else {
  console.error(USAGE);
  process.exit(2);
}

const triggering = changed.map((f) => [f, classify(f)]).filter(([, why]) => why);
const run = triggering.length > 0;
const reason = run
  ? `${triggering.length} of ${changed.length} changed file${changed.length === 1 ? "" : "s"} affect the rule or its build (first: ${triggering
      .slice(0, 5)
      .map(([f]) => f)
      .join(", ")}${triggering.length > 5 ? ", …" : ""})`
  : changed.length
    ? `all ${changed.length} changed file${changed.length === 1 ? "" : "s"} are documentation, tests or other ignored paths`
    : "no changed files";

console.log(`run=${run}`);
console.log(reason);
for (const [f, why] of triggering.slice(0, 20)) console.log(`  ${f}  (${why})`);
if (args.githubOutput) {
  appendFileSync(
    resolve(args.githubOutput),
    `run=${run}\nreason=${reason.replace(/\r?\n/g, " ")}\n`,
  );
}
