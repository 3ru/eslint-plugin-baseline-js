/** bench: measure one build on the synthetic corpus and check its reports. */
import { resolve } from "node:path";
import { option, parseCli } from "./cli.mts";
import { type Column, fmtInt, fmtMb, fmtMs, fmtMsFine, markdownTable } from "./format.mts";
import { writeJson } from "./lib.mts";
import { buildLabel, STALE_SNIPPETS, sideMatches } from "./report.mts";
import {
  buildInfo,
  DEFAULT_SHARDS,
  environmentInfo,
  integerOption,
  measurePasses,
  planPasses,
  positiveOption,
  prepareSynthetic,
  snippetsStale,
  withBuilds,
} from "./runner.mts";
import { median } from "./stats.mts";
import type { BenchResults, PassResult, TimedRun } from "./types.mts";

const USAGE = `usage: pnpm bench [options]

Lints the synthetic corpus with one build and prints rule time, lint total, peak RSS and
the report check.

  --ref <ref>               build to measure (default: .); "." builds the working tree in place,
                            any other ref builds in a detached worktree
  --scale <n>               corpus size: about n × 1,000 files (default: 3)
  --seed <n>                generator seed (default: 1)
  --shards <n>              shards per pass (default: ${DEFAULT_SHARDS})
  --iterations <n>          untyped iterations; each lints every shard once (default: 3)
  --typed                   run the type-aware pass over TypeScript files (slow)
  --typed-iterations <n>    type-aware iterations with --typed; 0 skips the pass (default: 2)
  --no-oracle               skip the report check
  --out <file>              write the JSON results
  --help                    print this help`;

const OPTIONS = {
  ref: option.text("."),
  scale: option.number(3),
  seed: option.number(1),
  shards: option.number(DEFAULT_SHARDS),
  iterations: option.number(3),
  typed: option.flag(false),
  typedIterations: option.number(2),
  oracle: option.flag(true),
  out: option.text(""),
};

const options = parseCli(process.argv.slice(2), OPTIONS, USAGE, (parsed) => ({
  ...parsed,
  scale: positiveOption("scale", parsed.scale),
  shards: integerOption("shards", parsed.shards, 1),
  iterations: integerOption("iterations", parsed.iterations, 1),
  typedIterations: integerOption("typed-iterations", parsed.typedIterations, 0),
}));

function perRun(pass: PassResult, metric: (run: TimedRun) => number): number {
  return median(pass.runs.map(metric));
}

function reportsCell({ oracle }: PassResult): string {
  if (oracle === null) return "n/a";

  return `${fmtInt(oracle.expected)} → ${fmtInt(oracle.head.reports)} ${sideMatches(oracle.head) ? "✅" : "❌"}`;
}

const COLUMNS: ReadonlyArray<Column<PassResult>> = [
  { title: "pass", cell: (pass) => pass.name },
  { title: "files", align: "right", cell: (pass) => fmtInt(pass.files) },
  { title: "rule time", align: "right", cell: (pass) => fmtMs(pass.sides.head.rule_ms) },
  { title: "lint total", align: "right", cell: (pass) => fmtMs(pass.sides.head.lint_ms) },
  { title: "parse", align: "right", cell: (pass) => fmtMs(pass.sides.head.parse_ms) },
  {
    title: "setup + warm-up per shard",
    align: "right",
    cell: (pass) =>
      `${fmtMs(perRun(pass, (run) => run.result.setup_ms))} + ${fmtMs(perRun(pass, (run) => run.result.warmup_ms))}`,
  },
  {
    title: "ms per file (fixed)",
    align: "right",
    cell: (pass) => fmtMsFine(pass.sides.head.cost.fixedMs),
  },
  {
    title: "ms per 1k nodes (marginal)",
    align: "right",
    cell: (pass) => fmtMsFine(pass.sides.head.cost.perKNodesMs),
  },
  { title: "peak RSS", align: "right", cell: (pass) => fmtMb(pass.sides.head.max_rss_kb) },
  {
    title: "noise",
    align: "right",
    cell: (pass) => (pass.noise === null ? "n/a" : `${(pass.noise * 100).toFixed(1)}%`),
  },
  { title: "reports expected → actual", align: "right", cell: reportsCell },
];

const corpus = prepareSynthetic({ scale: options.scale, seed: options.seed });
const env = environmentInfo();

const passes = await withBuilds({ base: null, head: options.ref }, async (builds) => {
  const plans = planPasses(corpus, {
    shards: options.shards,
    iterations: {
      untyped: options.iterations,
      "type-aware": options.typed ? options.typedIterations : 0,
    },
  });

  const measured = await measurePasses(corpus, plans, builds, {
    oracle: options.oracle,
    countNodes: false,
  });

  const head = buildInfo(builds.head);
  console.log(
    `### use-baseline benchmark · \`${buildLabel(head)}\`\n\n- corpus \`${corpus.info.id}\` · scale ${options.scale} · ${options.shards} shards · Node ${env.node} · ESLint ${env.eslint} · TypeScript ${env.typescript} · ${env.cpu}\n`,
  );
  console.log(markdownTable(COLUMNS, measured));

  if (options.oracle && snippetsStale()) {
    console.log(`\n${STALE_SNIPPETS}`);
  }

  if (options.out !== "") {
    const results: BenchResults = {
      tool: "bench",
      version: 1,
      env,
      options,
      builds: { base: null, head },
      passes: measured,
      verdict: null,
    };

    writeJson(resolve(options.out), results);
  }

  return measured;
});

if (!passes.every((pass) => pass.oracle === null || sideMatches(pass.oracle.head))) {
  console.error("[bench] the build's reports differ from the expected reports");
  process.exitCode = 1;
}
