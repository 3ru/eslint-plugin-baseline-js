/**
 * Orchestration shared by the benchmark commands: corpus preparation, sharding, plugin
 * builds for git refs, worker jobs and paired statistics.
 */
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { cpus, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { benchRuleOptions } from "./descriptors.mjs";
import { CACHE_DIR, git, median, ROOT, sha256, signTestP, spread } from "./lib.mjs";
import { ensureSynthCorpus } from "./synth.mjs";

const WORKER = resolve(dirname(fileURLToPath(import.meta.url)), "worker.mjs");
const TSDOWN = join(ROOT, "node_modules", "tsdown", "dist", "run.mjs");
export const TIMING_POLICY = "widely";
export const ORACLE_POLICY = 1900;
export const WARMUP_FILES = 8;

/** Round-robin shards over a sorted file list so every shard mixes languages and sizes. */
export function shardFiles(files, count) {
  const sorted = [...files].sort();
  const shards = Array.from({ length: Math.max(1, Math.min(count, sorted.length)) }, () => []);
  sorted.forEach((f, i) => shards[i % shards.length].push(f));
  return shards;
}

/** Generate or reuse the synthetic corpus and describe it for the runner. */
export function prepareSynthetic(options) {
  const { dir, id, manifest, reused } = ensureSynthCorpus(options);
  const nodesByFile = new Map(manifest.files.map((f) => [f.path, f.nodes]));
  const expectedByFile = new Map(manifest.files.map((f) => [f.path, f.expected]));
  const files = manifest.files.map((f) => f.path);
  const typedFiles = manifest.files.filter((f) => f.lang !== "js").map((f) => f.path);
  return {
    kind: "synthetic",
    dir,
    id,
    manifest,
    reused,
    files,
    typedFiles,
    nodesByFile,
    expectedByFile,
  };
}

/** A tsconfig that covers one shard; written under the cache so paths stay real. */
export function writeShardTsconfig(corpusDir, label, files) {
  const dir = join(CACHE_DIR, "tsconfig");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${label}-${sha256(files.join("\n")).slice(0, 12)}.json`);
  if (!existsSync(file)) {
    writeFileSync(
      file,
      JSON.stringify({
        compilerOptions: {
          target: "ESNext",
          module: "ESNext",
          moduleResolution: "Bundler",
          lib: ["ESNext", "DOM", "DOM.Iterable", "DOM.AsyncIterable"],
          jsx: "preserve",
          allowJs: true,
          checkJs: false,
          noEmit: true,
          skipLibCheck: true,
          strict: false,
          types: [],
        },
        files: files.map((f) => join(corpusDir, f)),
      }),
    );
  }
  return file;
}

/** Run the worker once; returns the parsed measurement line. */
export function runJob(pluginPath, job) {
  const tmp = mkdtempSync(join(tmpdir(), "baseline-bench-job-"));
  const jobFile = join(tmp, "job.json");
  writeFileSync(jobFile, JSON.stringify({ pluginPath, ...job }));
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [WORKER, jobFile], {
      stdio: ["ignore", "pipe", "inherit"],
    });
    let out = "";
    child.stdout.on("data", (chunk) => {
      out += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      rmSync(tmp, { recursive: true, force: true });
      if (code !== 0) return reject(new Error(`worker exited with code ${code}`));
      const line = out.trim().split("\n").at(-1);
      try {
        resolvePromise(JSON.parse(line));
      } catch {
        reject(new Error(`worker produced no JSON: ${line}`));
      }
    });
  });
}

/** Build a job for one shard: timing (`widely`) or oracle (report everything). */
export function shardJob(
  corpus,
  shard,
  { typed, policy, countNodes = false, perFileReports = false },
) {
  return {
    cwd: corpus.dir,
    files: shard,
    warmupFiles: shard.slice(0, Math.min(WARMUP_FILES, shard.length)),
    ruleOptions: benchRuleOptions(policy),
    typed,
    tsconfig: typed
      ? writeShardTsconfig(
          corpus.dir,
          `${corpus.id ?? "corpus"}-${typed ? "typed" : "untyped"}`,
          shard,
        )
      : null,
    countNodes,
    perFileReports,
  };
}

function workingTreeDirty() {
  return git(["status", "--porcelain", "--untracked-files=no"]).length > 0;
}

/**
 * Build the plugin for a git ref in a detached worktree (or in place for ".") and return
 * the bundle path. Call `cleanup()` when done.
 */
export function buildRef(ref, workDir) {
  if (ref === ".") {
    execFileSync(process.execPath, [TSDOWN], { cwd: ROOT, stdio: ["ignore", "ignore", "inherit"] });
    const sha = git(["rev-parse", "--short=12", "HEAD"]);
    const dirty = workingTreeDirty();
    return {
      ref,
      label: `working tree (${sha}${dirty ? ", uncommitted changes" : ""})`,
      sha: dirty ? `${sha}+dirty` : sha,
      pluginPath: join(ROOT, "dist", "index.mjs"),
      cleanup() {},
    };
  }
  const sha = git(["rev-parse", "--verify", `${ref}^{commit}`]);
  const dir = join(workDir, sha.slice(0, 12));
  rmSync(dir, { recursive: true, force: true });
  git(["worktree", "add", "--detach", "--force", dir, sha]);
  if (!existsSync(join(dir, "node_modules"))) {
    symlinkSync(join(ROOT, "node_modules"), join(dir, "node_modules"), "dir");
  }
  execFileSync(process.execPath, [TSDOWN], { cwd: dir, stdio: ["ignore", "ignore", "inherit"] });
  return {
    ref,
    label: `${ref} (${sha.slice(0, 12)})`,
    sha: sha.slice(0, 12),
    pluginPath: join(dir, "dist", "index.mjs"),
    cleanup() {
      try {
        git(["worktree", "remove", "--force", dir]);
      } catch {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  };
}

export function environmentInfo() {
  const version = (name) => {
    try {
      return JSON.parse(
        execFileSync(
          process.execPath,
          ["-p", `JSON.stringify(require("${name}/package.json").version)`],
          { cwd: ROOT, encoding: "utf8" },
        ),
      );
    } catch {
      return "unknown";
    }
  };
  return {
    node: process.version,
    platform: `${process.platform}-${process.arch}`,
    cpu: cpus()[0]?.model ?? "unknown",
    cores: cpus().length,
    eslint: version("eslint"),
    typescriptEslintParser: version("@typescript-eslint/parser"),
    typescript: version("typescript"),
    date: new Date().toISOString(),
  };
}

/** Median over iterations of the per-iteration sum over shards. */
export function medianTotal(iterations, key) {
  return median(iterations.map((shards) => shards.reduce((n, r) => n + (r[key] ?? 0), 0)));
}

/** Median over iterations of the largest shard RSS. */
export function medianMaxRss(iterations) {
  return median(iterations.map((shards) => Math.max(...shards.map((r) => r.max_rss_kb))));
}

/**
 * Paired statistics for one pass. `runs[side][iteration][shard]` are worker results.
 * Totals are per-iteration sums over shards (medians reported); deltas come from the
 * paired (shard, iteration) observations; the sign test says whether head lost or won
 * consistently across pairs rather than on average.
 */
export function summarizePass(runs, { files, nodes }) {
  const iterations = runs.base.length;
  const shardCount = runs.base[0]?.length ?? 0;
  const side = (name) => ({
    rule_ms: medianTotal(runs[name], "rule_ms"),
    lint_ms: medianTotal(runs[name], "lint_ms"),
    parse_ms: medianTotal(runs[name], "parse_ms"),
    cpu_ms: medianTotal(runs[name], "cpu_ms"),
    max_rss_kb: medianMaxRss(runs[name]),
  });
  const pairs = [];
  for (let i = 0; i < iterations; i++) {
    for (let s = 0; s < shardCount; s++)
      pairs.push({ base: runs.base[i][s].rule_ms, head: runs.head[i][s].rule_ms });
  }
  const wins = pairs.filter((p) => p.head < p.base).length;
  const losses = pairs.filter((p) => p.head > p.base).length;
  const ratios = pairs.filter((p) => p.base > 0).map((p) => p.head / p.base);
  const noise = (name) =>
    median(
      Array.from({ length: shardCount }, (_, s) => spread(runs[name].map((it) => it[s].rule_ms))),
    );
  const base = side("base");
  const head = side("head");
  return {
    files,
    nodes,
    iterations,
    shards: shardCount,
    base,
    head,
    perFile: { base: base.rule_ms / files, head: head.rule_ms / files },
    perKNodes: nodes
      ? { base: (base.rule_ms / nodes) * 1000, head: (head.rule_ms / nodes) * 1000 }
      : null,
    pairedRatio: median(ratios),
    wins,
    losses,
    pairs: pairs.length,
    p: signTestP(wins, losses),
    noise: Math.max(noise("base"), noise("head")),
  };
}
