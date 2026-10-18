import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { countNodes, parseSource } from "../../scripts/bench/ast.mts";
import { timingRuleOptions } from "../../scripts/bench/descriptors.mts";
import { DIST_PLUGIN, ROOT } from "../../scripts/bench/lib.mts";
import {
  type BenchCorpus,
  type BuildPair,
  headFirst,
  type ManifestView,
  type PassPlan,
  planPasses,
  runJob,
  runOracle,
  shardFiles,
  summarizePass,
  syntheticCorpus,
  WARMUP_FILES,
} from "../../scripts/bench/runner.mts";
import { loadSnippets } from "../../scripts/bench/snippet-codec.mts";
import type {
  Build,
  FeatureCounts,
  Lang,
  Side,
  SynthFile,
  TimedRun,
  WorkerResult,
} from "../../scripts/bench/types.mts";

const FIXTURE_DIR = join(ROOT, "tests", "bench", "fixtures", "corpus");

/** Three lines from bench/synth-snippets.json; d.js plants the first behind a shadowing parameter. */
const SNIPPET_LINES = ["AbortSignal.any(0);", "new ResizeObserver(0);", "Object.groupBy(0);"];
const DECOY_FILE = "d.js";

const FIXTURE_FILES: Array<[path: string, lang: Lang]> = [
  ["a.js", "js"],
  ["b.js", "js"],
  ["c.js", "js"],
  ["d.js", "js"],
  ["e.js", "js"],
  ["f.js", "js"],
  ["g.tsx", "tsx"],
  ["h.tsx", "tsx"],
];

/** The expected reports of each fixture file, from the snippets that verified those lines. */
function fixtureManifest(): ManifestView {
  const snippets = loadSnippets().untyped;

  const byLine = new Map(
    SNIPPET_LINES.map((line) => {
      const snippet = snippets.find((entry) => entry.code === line);

      if (snippet === undefined) {
        throw new Error(`"${line}" is no longer in bench/synth-snippets.json; pick another line`);
      }

      return [line, snippet];
    }),
  );

  const files = FIXTURE_FILES.map(([path, lang]): SynthFile => {
    const text = readFileSync(join(FIXTURE_DIR, path), "utf8");
    const untyped: FeatureCounts = {};
    const typed: FeatureCounts = {};

    if (path !== DECOY_FILE) {
      for (const line of text.split("\n")) {
        const snippet = [...byLine].find(([code]) => line.includes(code))?.[1];

        if (snippet === undefined) continue;
        untyped[snippet.featureId] = (untyped[snippet.featureId] ?? 0) + 1;
        typed[snippet.featureId] = (typed[snippet.featureId] ?? 0) + snippet.typedReports;
      }
    }

    return {
      path,
      lang,
      nodes: countNodes(parseSource(text, path)),
      expected: { untyped, typed: lang === "js" ? null : typed },
    };
  });

  return { id: "fixture", inputs: { scale: 0, sizeMult: 1 }, files };
}

const dist: Build = {
  ref: ".",
  sha: "0".repeat(40),
  label: "0000000",
  dirty: false,
  pluginPath: DIST_PLUGIN,
  cleanup() {},
};

describe("shardFiles", () => {
  const files = Array.from({ length: 200 }, (_, i) => `f${String(i).padStart(3, "0")}.js`);

  it("reserves every k-th file for warm-up and deals the rest round-robin", () => {
    const { warmup, shards } = shardFiles(files.toReversed(), 6);
    expect(warmup).toHaveLength(WARMUP_FILES);
    expect(warmup.slice(0, 3)).toEqual(["f000.js", "f012.js", "f025.js"]);
    const timed = shards.flat();
    expect(timed).toHaveLength(200 - WARMUP_FILES);
    expect(new Set([...timed, ...warmup]).size).toBe(200);
    expect(timed.some((file) => warmup.includes(file))).toBe(false);
    expect(shards.map((shard) => shard.length)).toEqual([31, 31, 31, 31, 30, 30]);
    expect(shards[1]?.slice(0, 2)).toEqual(["f002.js", "f008.js"]);
  });

  it("gives a tiny corpus at most one shard's share of warm-up files", () => {
    const { warmup, shards } = shardFiles(files.slice(0, 8), 1);
    expect(warmup).toEqual(["f000.js", "f002.js", "f004.js", "f006.js"]);
    expect(shards).toEqual([["f001.js", "f003.js", "f005.js", "f007.js"]]);
  });
});

describe("summarizePass", () => {
  const corpus: BenchCorpus = {
    info: { id: "constructed", scale: 1, sizeMult: 1 },
    dir: ROOT,
    files: { untyped: ["x.js", "y.js"], "type-aware": [] },
    nodes: new Map([
      ["x.js", 1000],
      ["y.js", 3000],
    ]),
    expected: null,
  };

  const plan = (iterations: number): PassPlan => ({
    name: "untyped",
    typed: false,
    iterations,
    warmup: [],
    shards: [["x.js"], ["y.js"]],
  });

  /** Per-file rule time = fixed + 0.5 ms per 1k nodes; the head is 10% slower when it goes first, 21% when second. */
  function run(side: Side, shard: number, iteration: number): TimedRun {
    const file = shard === 0 ? "x.js" : "y.js";
    const fixed = side === "base" ? 1 : 2;
    const ruleMs = fixed + (shard === 0 ? 0.5 : 1.5);
    let total = 100;

    if (side === "head") total = headFirst(iteration, shard) ? 110 : 121;

    const result: WorkerResult = {
      files: 1,
      setup_ms: 50,
      warmup_ms: 10,
      lint_ms: total * 2,
      thread_cpu_ms: total * 2,
      parse_ms: 40,
      rule_ms: total,
      nodes: null,
      reports: 0,
      fatals: 0,
      max_rss_kb: 100_000,
      perFile: { [file]: { rule_ms: ruleMs, nodes: null } },
      reportsByFile: null,
    };

    return { side, shard, iteration, result };
  }

  const runs = (iterations: number): TimedRun[] =>
    Array.from({ length: iterations }, (_, iteration) =>
      [0, 1].flatMap((shard) => [run("base", shard, iteration), run("head", shard, iteration)]),
    ).flat();

  it("pairs the runs, fits the cost lines and measures noise and order effect", () => {
    const pass = summarizePass(corpus, plan(2), runs(2), null);
    expect(pass.files).toBe(2);
    expect(pass.nodes).toBe(4000);
    expect(pass.sides.base?.rule_ms).toBe(200);
    expect(pass.sides.base?.cost.fixedMs).toBeCloseTo(1);
    expect(pass.sides.head.cost.fixedMs).toBeCloseTo(2);
    expect(pass.sides.head.cost.perKNodesMs).toBeCloseTo(0.5);
    const ruleTime = pass.comparison?.metrics.rule_ms;
    expect(ruleTime?.n).toBe(4);
    expect(ruleTime?.ratio).toBeCloseTo(1.1 ** 1.5);
    expect(pass.comparison?.orderEffect).toBeCloseTo(-Math.log(1.1) / 2);
    expect(pass.noise).toBeCloseTo(Math.log(1.1) / 2);
  });

  it("reports no noise with one iteration and no comparison for one build", () => {
    const headOnly = runs(1).filter((entry) => entry.side === "head");
    const pass = summarizePass(corpus, plan(1), headOnly, null);
    expect(pass.noise).toBeNull();
    expect(pass.comparison).toBeNull();
    expect(pass.sides.base).toBeNull();
  });
});

describe("the worker", () => {
  it("returns per-file rule time and node counts for the timed files", async () => {
    const result = await runJob({
      pluginPath: DIST_PLUGIN,
      cwd: FIXTURE_DIR,
      files: ["a.js", "c.js", "g.tsx"],
      warmupFiles: ["b.js"],
      ruleOptions: timingRuleOptions(),
      typed: false,
      tsconfig: null,
      countNodes: true,
      reportDetails: false,
      perFileStats: true,
    });

    const manifest = fixtureManifest();
    expect(result.files).toBe(3);
    expect(result.reportsByFile).toBeNull();
    expect(Object.keys(result.perFile ?? {})).toEqual(["a.js", "c.js", "g.tsx"]);

    for (const [file, stats] of Object.entries(result.perFile ?? {})) {
      expect(stats.rule_ms).toBeGreaterThan(0);
      // The worker's `*` count equals the manifest's count by construction.
      expect(stats.nodes).toBe(manifest.files.find((entry) => entry.path === file)?.nodes);
    }

    expect(result.rule_ms).toBeGreaterThan(0);
  });

  it("fails loudly on a file that does not exist", async () => {
    await expect(
      runJob({
        pluginPath: DIST_PLUGIN,
        cwd: FIXTURE_DIR,
        files: ["missing.js"],
        warmupFiles: [],
        ruleOptions: timingRuleOptions(),
        typed: false,
        tsconfig: null,
        countNodes: false,
        reportDetails: false,
        perFileStats: false,
      }),
    ).rejects.toThrow("the worker exited with code 1");
  });
});

describe("runOracle on the fixture corpus", () => {
  it("finds exactly the expected reports in both passes, the decoy silent", async () => {
    const corpus = syntheticCorpus(FIXTURE_DIR, fixtureManifest());
    const builds: BuildPair = { base: dist, head: dist };
    const plans = planPasses(corpus, { shards: 1, iterations: { untyped: 1, "type-aware": 1 } });
    expect(plans.map((plan) => [plan.name, plan.warmup.length, plan.shards.flat().length])).toEqual(
      [
        ["untyped", 4, 4],
        ["type-aware", 1, 1],
      ],
    );

    for (const plan of plans) {
      const check = await runOracle(corpus, plan, builds);
      const files = [...plan.warmup, ...plan.shards.flat()];

      const expected = files
        .flatMap((file) => {
          const entry = corpus.expected?.get(file);

          return Object.values((plan.typed ? entry?.typed : entry?.untyped) ?? {});
        })
        .reduce((sum, count) => sum + count, 0);

      expect(check.expected).toBe(expected);
      expect(check.head).toEqual({ reports: expected, fatals: 0, mismatches: [] });
      expect(check.base).toEqual(check.head);
      expect(check.ruleTime?.n).toBe(1);
    }
  }, 20_000);
});
