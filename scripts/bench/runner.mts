/**
 * The measurement shared by bench, bench:compare, bench:sweep and bench:calibrate: corpora,
 * shards, plugin builds, worker processes, the expected-report check and per-pass statistics.
 */
import { execFileSync, fork, type Serializable } from "node:child_process";
import { once } from "node:events";
import { existsSync, rmSync, symlinkSync } from "node:fs";
import { availableParallelism, cpus } from "node:os";
import { join, relative } from "node:path";
import parserPackage from "@typescript-eslint/parser/package.json" with { type: "json" };
import eslintPackage from "eslint/package.json" with { type: "json" };
import typescriptPackage from "typescript/package.json" with { type: "json" };
import { z } from "zod";
import { CliError } from "./cli.mts";
import { dataFingerprint, oracleRuleOptions, timingRuleOptions } from "./descriptors.mts";
import { BENCH_COMPILER_OPTIONS } from "./eslint-setup.mjs";
import { ensureSynthCorpus } from "./generator.mts";
import { CACHE_DIR, compareText, DIST_PLUGIN, git, ROOT, sha256, writeJson } from "./lib.mts";
import { loadSnippets } from "./snippet-codec.mts";
import { linearFit, mean, median, pairedLogRatio, pooledWithinSd } from "./stats.mts";
import type {
  Build,
  BuildInfo,
  CorpusInfo,
  CostModel,
  EnvironmentInfo,
  FeatureCounts,
  FileStats,
  Job,
  MaterializedRepository,
  OraclePass,
  OracleSide,
  PassComparison,
  PassName,
  PassResult,
  ReportMismatch,
  RuleOptions,
  Side,
  SideSummary,
  SynthFile,
  SynthInputs,
  SynthManifest,
  TimedRun,
  WorkerResult,
} from "./types.mts";

/** create() settles after about 8 calls and drifts lower until about 128; 16 is past the knee. */
export const WARMUP_FILES = 16;
export const DEFAULT_SHARDS = 6;

const WORKER = join(import.meta.dirname, "worker.mjs");
const TSDOWN = join(ROOT, "node_modules", "tsdown", "dist", "run.mjs");
const TSCONFIG_DIR = join(CACHE_DIR, "tsconfig");
const WORKTREE_DIR = join(CACHE_DIR, "worktrees");

/** Each changes what the worker measures: Node flags, ESLint's timing, typescript-eslint's mode. */
const SCRUBBED_ENV = new Set([
  "NODE_OPTIONS",
  "TIMING",
  "TSESTREE_SINGLE_RUN",
  "TYPESCRIPT_ESLINT_PROJECT_SERVICE",
]);

const TYPESCRIPT_FILE = /\.(?:ts|tsx|mts|cts)$/;

function log(message: string): void {
  console.error(`[bench] ${message}`);
}

export function integerOption(flag: string, value: number, min: number): number {
  if (!Number.isInteger(value) || value < min) {
    throw new CliError(`--${flag} expects a whole number of at least ${min}, got ${value}`);
  }

  return value;
}

export function positiveOption(flag: string, value: number): number {
  if (!(value > 0)) throw new CliError(`--${flag} expects a positive number, got ${value}`);

  return value;
}

export interface BenchCorpus {
  info: CorpusInfo;
  dir: string;
  files: Record<PassName, readonly string[]>;
  /** null: the worker counts the nodes. */
  nodes: ReadonlyMap<string, number> | null;
  expected: ReadonlyMap<string, SynthFile["expected"]> | null;
}

export type ManifestView = Pick<SynthManifest, "id" | "files"> & {
  inputs: Pick<SynthInputs, "scale" | "sizeMult">;
};

export function syntheticCorpus(dir: string, manifest: ManifestView): BenchCorpus {
  return {
    info: { id: manifest.id, scale: manifest.inputs.scale, sizeMult: manifest.inputs.sizeMult },
    dir,
    files: {
      untyped: manifest.files.map((file) => file.path),
      "type-aware": manifest.files.filter((file) => file.lang !== "js").map((file) => file.path),
    },
    nodes: new Map(manifest.files.map((file) => [file.path, file.nodes])),
    expected: new Map(manifest.files.map((file) => [file.path, file.expected])),
  };
}

export function prepareSynthetic(options: {
  scale: number;
  seed: number;
  sizeMult?: number;
}): BenchCorpus {
  const { dir, manifest, reused } = ensureSynthCorpus(options);
  const { totals } = manifest;
  log(
    `corpus ${manifest.id} ${reused ? "reused" : "generated"}: ${totals.files} files, ${totals.nodes} nodes`,
  );

  return syntheticCorpus(dir, manifest);
}

export function calibrationCorpus(id: string, repository: MaterializedRepository): BenchCorpus {
  return {
    info: { id, scale: null, sizeMult: null },
    dir: repository.dir,
    files: {
      untyped: repository.files,
      "type-aware": repository.files.filter((file) => TYPESCRIPT_FILE.test(file)),
    },
    nodes: null,
    expected: null,
  };
}

/** The committed snippets were verified against other plugin data than this checkout has. */
export function snippetsStale(): boolean {
  return loadSnippets().inputs.data !== dataFingerprint();
}

export interface ShardedFiles {
  /** Linted by every worker before its clock starts; in no shard. */
  warmup: string[];
  shards: string[][];
}

export interface PassPlan extends ShardedFiles {
  name: PassName;
  typed: boolean;
  iterations: number;
}

/** Every k-th sorted file warms up; the rest are dealt round-robin to mix languages and sizes. */
export function shardFiles(files: readonly string[], count: number): ShardedFiles {
  if (files.length === 0) throw new Error("no files to shard");
  const sorted = files.toSorted(compareText);
  // At most one shard's share, so a tiny corpus still times most files.
  const warmupCount = Math.min(WARMUP_FILES, Math.floor(sorted.length / (count + 1)));

  const picked = new Set(
    Array.from({ length: warmupCount }, (_, i) => Math.floor((i * sorted.length) / warmupCount)),
  );

  const timed = sorted.filter((_, index) => !picked.has(index));
  const shardCount = Math.min(count, timed.length);

  return {
    warmup: sorted.filter((_, index) => picked.has(index)),
    shards: Array.from({ length: shardCount }, (_, shard) =>
      timed.filter((_, index) => index % shardCount === shard),
    ),
  };
}

export function planPasses(
  corpus: BenchCorpus,
  { shards, iterations }: { shards: number; iterations: Record<PassName, number> },
): PassPlan[] {
  const names: PassName[] = ["untyped", "type-aware"];

  return names.flatMap((name) => {
    const files = corpus.files[name];

    if (iterations[name] === 0 || files.length === 0) return [];

    return [
      {
        name,
        typed: name === "type-aware",
        iterations: iterations[name],
        ...shardFiles(files, shards),
      },
    ];
  });
}

/** The file name hashes the whole content, so an existing file is always current. */
export function writeShardTsconfig(corpusDir: string, files: readonly string[]): string {
  const config = {
    compilerOptions: BENCH_COMPILER_OPTIONS,
    files: files.map((file) => join(corpusDir, file)),
  };

  const file = join(TSCONFIG_DIR, `${sha256(JSON.stringify(config)).slice(0, 16)}.json`);
  writeJson(file, config);

  return file;
}

interface JobOptions {
  ruleOptions: RuleOptions;
  countNodes: boolean;
  reportDetails: boolean;
  perFileStats: boolean;
}

function shardJob(
  corpus: BenchCorpus,
  plan: PassPlan,
  files: readonly string[],
  build: Build,
  options: JobOptions,
): Job {
  // The type-aware parser needs the warm-up files in the program too.
  const program = [...new Set([...plan.warmup, ...files])];

  return {
    pluginPath: build.pluginPath,
    cwd: corpus.dir,
    files: [...files],
    warmupFiles: plan.warmup,
    typed: plan.typed,
    tsconfig: plan.typed ? writeShardTsconfig(corpus.dir, program) : null,
    ...options,
  };
}

export const FileStatsSchema = z.object({
  rule_ms: z.number(),
  nodes: z.number().nullable(),
});

export const WorkerResultSchema = z.object({
  files: z.number(),
  setup_ms: z.number(),
  warmup_ms: z.number(),
  lint_ms: z.number(),
  thread_cpu_ms: z.number().nullable(),
  parse_ms: z.number(),
  rule_ms: z.number(),
  nodes: z.number().nullable(),
  reports: z.number(),
  fatals: z.number(),
  max_rss_kb: z.number(),
  perFile: z.record(z.string(), FileStatsSchema).nullable(),
  reportsByFile: z.record(z.string(), z.record(z.string(), z.number())).nullable(),
});

/** One shard in a fresh process without Node flags; its stdout goes to stderr, not the report. */
export async function runJob(job: Job): Promise<WorkerResult> {
  const child = fork(WORKER, [], {
    execArgv: [],
    serialization: "json",
    env: Object.fromEntries(Object.entries(process.env).filter(([key]) => !SCRUBBED_ENV.has(key))),
    stdio: ["ignore", 2, 2, "ipc"],
  });

  const messages: Serializable[] = [];
  child.on("message", (message) => messages.push(message));
  // "close" follows "exit" once the IPC channel is drained, so no message can arrive later.
  const closed = once(child, "close");
  child.send(job);
  // SAFETY: a ChildProcess emits "close" with (exit code, signal); once() types them as any[]
  const [code, signal] = (await closed) as [number | null, NodeJS.Signals | null];

  if (signal !== null) throw new Error(`the worker was killed by ${signal}`);

  if (code !== 0) throw new Error(`the worker exited with code ${code}`);
  const [message, ...extra] = messages;

  if (message === undefined || extra.length > 0) {
    throw new Error(`the worker sent ${messages.length} messages instead of one result`);
  }

  return WorkerResultSchema.parse(message);
}

export interface BuildPair {
  base: Build | null;
  head: Build;
}

function tsdown(cwd: string): void {
  execFileSync(process.execPath, [TSDOWN], { cwd, stdio: ["ignore", "ignore", "inherit"] });
}

function workingTree(ref: string, pluginPath: string): Omit<Build, "cleanup"> {
  const sha = git(["rev-parse", "HEAD"]);
  const dirty = git(["status", "--porcelain", "--untracked-files=no"]) !== "";

  return { ref, sha, label: sha.slice(0, 7), dirty, pluginPath };
}

/** "." builds the working tree in place; other refs build in a worktree sharing node_modules. */
export function buildRef(ref: string, slot: Side): Build {
  if (ref === ".") {
    tsdown(ROOT);

    return { ...workingTree(ref, DIST_PLUGIN), cleanup() {} };
  }

  const sha = git(["rev-parse", "--verify", `${ref}^{commit}`]);
  const dir = join(WORKTREE_DIR, slot);

  const remove = (): void => {
    rmSync(dir, { recursive: true, force: true });
    // Also deregisters any worktree an aborted run left behind.
    git(["worktree", "prune"]);
  };

  remove();
  git(["worktree", "add", "--detach", dir, sha]);
  symlinkSync(join(ROOT, "node_modules"), join(dir, "node_modules"), "dir");
  tsdown(dir);

  return {
    ref,
    sha,
    label: sha.slice(0, 7),
    dirty: false,
    pluginPath: join(dir, "dist", "index.mjs"),
    cleanup: remove,
  };
}

export function distBuild(): Build {
  if (!existsSync(DIST_PLUGIN)) {
    throw new Error(`${relative(ROOT, DIST_PLUGIN)} is missing: run \`pnpm build\` first`);
  }

  return { ...workingTree(".", DIST_PLUGIN), cleanup() {} };
}

/** Removes the worktrees whatever `measure` does. */
export async function withBuilds<T>(
  refs: { base: string | null; head: string },
  measure: (builds: BuildPair) => Promise<T>,
): Promise<T> {
  const built: Build[] = [];

  const build = (ref: string, slot: Side): Build => {
    log(`building ${slot} ${ref}`);
    const result = buildRef(ref, slot);
    built.push(result);

    return result;
  };

  try {
    const base = refs.base === null ? null : build(refs.base, "base");

    return await measure({ base, head: build(refs.head, "head") });
  } finally {
    for (const result of built) result.cleanup();
  }
}

export function buildInfo({ ref, sha, label, dirty }: Build): BuildInfo {
  return { ref, sha, label, dirty };
}

/** Both builds run with the head's node_modules, so a dependency change goes unmeasured. */
export function dependencyCaveat(base: BuildInfo, head: BuildInfo): boolean {
  // "." is the working tree, which `git diff <commit>` compares against.
  const commits = [base, head].flatMap((build) => (build.ref === "." ? [] : [build.sha]));

  if (commits.length === 0) return false;

  return git(["diff", "--name-only", ...commits, "--", "package.json", "pnpm-lock.yaml"]) !== "";
}

export function environmentInfo(): EnvironmentInfo {
  return {
    node: process.versions.node,
    platform: `${process.platform}-${process.arch}`,
    // os.cpus() is empty on some platforms.
    cpu: cpus()[0]?.model ?? "unknown CPU",
    cores: availableParallelism(),
    eslint: eslintPackage.version,
    typescriptEslintParser: parserPackage.version,
    typescript: typescriptPackage.version,
    date: new Date().toISOString(),
  };
}

/** Each build goes first in half of the pairs. */
export function headFirst(iteration: number, shard: number): boolean {
  return (iteration + shard) % 2 === 1;
}

function runOrder(builds: BuildPair, iteration: number, shard: number): Array<[Side, Build]> {
  if (builds.base === null) return [["head", builds.head]];

  return headFirst(iteration, shard)
    ? [
        ["head", builds.head],
        ["base", builds.base],
      ]
    : [
        ["base", builds.base],
        ["head", builds.head],
      ];
}

function expectedReports(corpus: BenchCorpus, plan: PassPlan, file: string): FeatureCounts {
  const entry = corpus.expected?.get(file);

  if (entry === undefined) throw new Error(`${file}: no expected reports in the manifest`);
  const counts = plan.typed ? entry.typed : entry.untyped;

  if (counts === null) throw new Error(`${file}: no type-aware expected reports`);

  return counts;
}

function diffReports(
  file: string,
  expected: FeatureCounts,
  actual: FeatureCounts,
): ReportMismatch[] {
  const featureIds = new Set([...Object.keys(expected), ...Object.keys(actual)]);

  return [...featureIds].toSorted(compareText).flatMap((featureId) => {
    const want = expected[featureId] ?? 0;
    const got = actual[featureId] ?? 0;

    return want === got ? [] : [{ file, featureId, expected: want, actual: got }];
  });
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

/** Every file once per build under the expected-report options; base and head runs form pairs. */
export async function runOracle(
  corpus: BenchCorpus,
  plan: PassPlan,
  builds: BuildPair,
): Promise<OraclePass> {
  const tally = { base: newTally(), head: newTally() };
  let expected = 0;

  for (const [index, shard] of plan.shards.entries()) {
    // The check must see every file, so the first shard also checks the warm-up files.
    const files = index === 0 ? [...plan.warmup, ...shard] : shard;
    const want = new Map(files.map((file) => [file, expectedReports(corpus, plan, file)]));
    expected += sum([...want.values()].map((counts) => sum(Object.values(counts))));

    for (const [side, build] of runOrder(builds, 0, index)) {
      const result = await runJob(
        shardJob(corpus, plan, files, build, {
          ruleOptions: oracleRuleOptions(),
          countNodes: false,
          reportDetails: true,
          perFileStats: false,
        }),
      );

      const { reportsByFile } = result;

      if (reportsByFile === null) throw new Error("the worker returned no report details");
      const sideTally = tally[side];
      sideTally.reports += result.reports;
      sideTally.fatals += result.fatals;
      sideTally.ruleMs.push(result.rule_ms);

      for (const [file, counts] of want) {
        const actual = reportsByFile[file];

        if (actual === undefined) throw new Error(`the worker returned no reports for ${file}`);
        sideTally.mismatches.push(...diffReports(file, counts, actual));
      }
    }
  }

  const head = oracleSide(tally.head);
  log(`report check ${plan.name}: expected ${expected}, head ${head.reports}`);

  return {
    expected,
    base: builds.base === null ? null : oracleSide(tally.base),
    head,
    ruleTime:
      builds.base === null
        ? null
        : pairedLogRatio(
            tally.base.ruleMs.map((base, i) => ({ base, head: at(tally.head.ruleMs, i) })),
          ),
  };
}

interface Tally extends OracleSide {
  ruleMs: number[];
}

function newTally(): Tally {
  return { reports: 0, fatals: 0, mismatches: [], ruleMs: [] };
}

function oracleSide({ reports, fatals, mismatches }: Tally): OracleSide {
  return { reports, fatals, mismatches };
}

function at<T>(items: readonly T[], index: number): T {
  const item = items[index];

  if (item === undefined) throw new Error(`index ${index} out of range`);

  return item;
}

export async function runTiming(
  corpus: BenchCorpus,
  plan: PassPlan,
  builds: BuildPair,
  { countNodes }: { countNodes: boolean },
): Promise<TimedRun[]> {
  const runs: TimedRun[] = [];

  for (let iteration = 0; iteration < plan.iterations; iteration++) {
    for (const [shard, files] of plan.shards.entries()) {
      for (const [side, build] of runOrder(builds, iteration, shard)) {
        const result = await runJob(
          shardJob(corpus, plan, files, build, {
            ruleOptions: timingRuleOptions(),
            countNodes,
            reportDetails: false,
            perFileStats: true,
          }),
        );

        runs.push({ side, shard, iteration, result });
      }
    }

    log(`${plan.name} iteration ${iteration + 1}/${plan.iterations} done`);
  }

  return runs;
}

function threadCpu(result: WorkerResult): number {
  if (result.thread_cpu_ms === null) throw new Error("the worker measured no thread CPU time");

  return result.thread_cpu_ms;
}

function perFileOf(run: TimedRun): Record<string, FileStats> {
  if (run.result.perFile === null) throw new Error("the worker returned no per-file stats");

  return run.result.perFile;
}

/** The worker's count wins when the job asked for one, so calibration counts both sides alike. */
function fileNodes(corpus: BenchCorpus, runs: readonly TimedRun[]): ReadonlyMap<string, number> {
  const counted = new Map<string, number>();

  for (const run of runs) {
    for (const [file, stats] of Object.entries(perFileOf(run))) {
      if (stats.nodes !== null) counted.set(file, stats.nodes);
    }
  }

  if (counted.size > 0) return counted;

  if (corpus.nodes === null) throw new Error(`${corpus.info.id}: no node counts for the files`);

  return corpus.nodes;
}

function nodesOf(nodes: ReadonlyMap<string, number>, file: string): number {
  const count = nodes.get(file);

  if (count === undefined) throw new Error(`${file}: unknown node count`);

  return count;
}

/** (nodes / 1000, rule ms) for every timed file of every run. */
export function costPoints(
  corpus: BenchCorpus,
  runs: readonly TimedRun[],
): Array<[number, number]> {
  const nodes = fileNodes(corpus, runs);

  return runs.flatMap((run) =>
    Object.entries(perFileOf(run)).map(([file, stats]): [number, number] => [
      nodesOf(nodes, file) / 1000,
      stats.rule_ms,
    ]),
  );
}

export function fitCost(points: ReadonlyArray<readonly [number, number]>): CostModel {
  const { intercept, slope } = linearFit(points);

  return { fixedMs: intercept, perKNodesMs: slope };
}

function sideSummary(corpus: BenchCorpus, runs: readonly TimedRun[]): SideSummary {
  const iterations = [...Map.groupBy(runs, (run) => run.iteration).values()];

  const total = (metric: (result: WorkerResult) => number): number =>
    median(iterations.map((shards) => sum(shards.map((run) => metric(run.result)))));

  const cpu = runs.map((run) => run.result.thread_cpu_ms);

  return {
    rule_ms: total((result) => result.rule_ms),
    lint_ms: total((result) => result.lint_ms),
    parse_ms: total((result) => result.parse_ms),
    thread_cpu_ms: cpu.includes(null) ? null : total(threadCpu),
    max_rss_kb: median(
      iterations.map((shards) => Math.max(...shards.map((run) => run.result.max_rss_kb))),
    ),
    cost: fitCost(costPoints(corpus, runs)),
  };
}

interface Pair {
  base: WorkerResult;
  head: WorkerResult;
  headFirst: boolean;
}

function pairsOf(runs: readonly TimedRun[]): Pair[] {
  const bySlot = Map.groupBy(runs, (run) => `${run.shard}:${run.iteration}`);

  return [...bySlot.values()].map((slot) => {
    const base = slot.find((run) => run.side === "base");
    const head = slot.find((run) => run.side === "head");

    if (base === undefined || head === undefined || slot.length !== 2) {
      throw new Error("every shard and iteration needs one base and one head run");
    }

    return {
      base: base.result,
      head: head.result,
      headFirst: headFirst(head.iteration, head.shard),
    };
  });
}

function compareSides(pairs: readonly Pair[]): PassComparison {
  const estimate = (metric: (result: WorkerResult) => number) =>
    pairedLogRatio(pairs.map((pair) => ({ base: metric(pair.base), head: metric(pair.head) })));

  const cpuMeasured = pairs.every(
    (pair) => pair.base.thread_cpu_ms !== null && pair.head.thread_cpu_ms !== null,
  );

  const d = (pair: Pair): number => Math.log(pair.head.rule_ms / pair.base.rule_ms);

  return {
    metrics: {
      rule_ms: estimate((result) => result.rule_ms),
      lint_ms: estimate((result) => result.lint_ms),
      max_rss_kb: estimate((result) => result.max_rss_kb),
      thread_cpu_ms: cpuMeasured ? estimate(threadCpu) : null,
    },
    orderEffect:
      (mean(
        pairs
          .values()
          .filter((pair) => pair.headFirst)
          .map(d)
          .toArray(),
      ) -
        mean(
          pairs
            .values()
            .filter((pair) => !pair.headFirst)
            .map(d)
            .toArray(),
        )) /
      2,
  };
}

export function summarizePass(
  corpus: BenchCorpus,
  plan: PassPlan,
  runs: readonly TimedRun[],
  oracle: OraclePass | null,
): PassResult {
  const timed = plan.shards.flat();
  const nodes = fileNodes(corpus, runs);
  const bySide = (side: Side): TimedRun[] => runs.filter((run) => run.side === side);
  const baseRuns = bySide("base");
  const groups = Map.groupBy(runs, (run) => `${run.side}:${run.shard}`);

  return {
    corpus: corpus.info,
    name: plan.name,
    files: timed.length,
    nodes: sum(timed.map((file) => nodesOf(nodes, file))),
    warmupFiles: plan.warmup.length,
    shards: plan.shards.length,
    iterations: plan.iterations,
    sides: {
      base: baseRuns.length === 0 ? null : sideSummary(corpus, baseRuns),
      head: sideSummary(corpus, bySide("head")),
    },
    noise: pooledWithinSd(
      [...groups.values()].map((group) => group.map((run) => Math.log(run.result.rule_ms))),
    ),
    comparison: baseRuns.length === 0 ? null : compareSides(pairsOf(runs)),
    oracle,
    runs: [...runs],
  };
}

export async function measurePasses(
  corpus: BenchCorpus,
  plans: readonly PassPlan[],
  builds: BuildPair,
  { oracle, countNodes }: { oracle: boolean; countNodes: boolean },
): Promise<PassResult[]> {
  const passes: PassResult[] = [];

  for (const plan of plans) {
    const check = oracle ? await runOracle(corpus, plan, builds) : null;
    const runs = await runTiming(corpus, plan, builds, { countNodes });
    passes.push(summarizePass(corpus, plan, runs, check));
  }

  return passes;
}
