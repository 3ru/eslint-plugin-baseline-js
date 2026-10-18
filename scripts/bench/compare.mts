/** bench:compare: base vs head on the synthetic corpus, the benchmark pull requests run. */
import { appendFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { option, parseCli } from "./cli.mts";
import { writeJson } from "./lib.mts";
import {
  buildLabel,
  type CiLinks,
  evaluate,
  type ReportContext,
  renderComment,
  renderSummary,
} from "./report.mts";
import {
  buildInfo,
  DEFAULT_SHARDS,
  dependencyCaveat,
  environmentInfo,
  integerOption,
  measurePasses,
  planPasses,
  positiveOption,
  prepareSynthetic,
  snippetsStale,
  withBuilds,
} from "./runner.mts";
import { SIGNIFICANCE } from "./stats.mts";
import type { BenchResults } from "./types.mts";

const USAGE = `usage: pnpm bench:compare [options]

Builds the base and the head, lints the synthetic corpus with both in alternating fresh
processes, and reports the paired change in rule time. One extra run per build under
available: 1900 counts reports; the head build must produce exactly the expected reports.

  --base <ref>              base build (default: origin/main)
  --head <ref>              head build (default: .); "." builds the working tree in place,
                            any other ref builds in a detached worktree
  --scale <n>               corpus size: about n × 1,000 files (default: 3)
  --seed <n>                generator seed (default: 1)
  --shards <n>              shards per pass (default: ${DEFAULT_SHARDS})
  --iterations <n>          untyped iterations; each lints every shard once per build (default: 3)
  --typed-iterations <n>    type-aware iterations over the TypeScript files; 0 skips the
                            type-aware pass (default: 2)
  --threshold <pct>         a pass regressed when its whole 95% interval lies above +pct% and
                            its Holm-adjusted p < ${SIGNIFICANCE}; an interval wider than ±pct% is
                            inconclusive (default: 10)
  --fail-on-regression      exit 1 when a pass regressed (a report mismatch always exits 1)
  --no-oracle               skip the report check
  --out <file>              write the JSON results
  --summary <file>          append the full Markdown report (CI passes the job summary)
  --comment <file>          write the compact pull request comment
  --base-label <text>       title label of the base (default: its short SHA)
  --head-label <text>       title label of the head (default: its short SHA)
  --help                    print this help`;

const OPTIONS = {
  base: option.text("origin/main"),
  head: option.text("."),
  scale: option.number(3),
  seed: option.number(1),
  shards: option.number(DEFAULT_SHARDS),
  iterations: option.number(3),
  typedIterations: option.number(2),
  threshold: option.number(10),
  failOnRegression: option.flag(false),
  oracle: option.flag(true),
  out: option.text(""),
  summary: option.text(""),
  comment: option.text(""),
  baseLabel: option.text(""),
  headLabel: option.text(""),
};

const options = parseCli(process.argv.slice(2), OPTIONS, USAGE, (parsed) => ({
  ...parsed,
  scale: positiveOption("scale", parsed.scale),
  shards: integerOption("shards", parsed.shards, 1),
  iterations: integerOption("iterations", parsed.iterations, 1),
  typedIterations: integerOption("typed-iterations", parsed.typedIterations, 0),
  threshold: positiveOption("threshold", parsed.threshold),
}));

function ciLinks(): CiLinks | null {
  const { GITHUB_SERVER_URL, GITHUB_REPOSITORY, GITHUB_RUN_ID } = process.env;

  if (GITHUB_SERVER_URL === undefined || GITHUB_REPOSITORY === undefined) return null;

  return {
    serverUrl: GITHUB_SERVER_URL,
    repository: GITHUB_REPOSITORY,
    runId: GITHUB_RUN_ID ?? null,
  };
}

const corpus = prepareSynthetic({ scale: options.scale, seed: options.seed });
const env = environmentInfo();

const verdict = await withBuilds({ base: options.base, head: options.head }, async (builds) => {
  if (builds.base === null) throw new Error("bench:compare needs a base build");
  const base = buildInfo(builds.base);
  const head = buildInfo(builds.head);

  const plans = planPasses(corpus, {
    shards: options.shards,
    iterations: { untyped: options.iterations, "type-aware": options.typedIterations },
  });

  const passes = await measurePasses(corpus, plans, builds, {
    oracle: options.oracle,
    countNodes: false,
  });

  const result = evaluate(passes, {
    threshold: options.threshold,
    snippetsStale: snippetsStale(),
  });

  const ctx: ReportContext = {
    baseLabel: options.baseLabel === "" ? buildLabel(base) : options.baseLabel,
    headLabel: options.headLabel === "" ? buildLabel(head) : options.headLabel,
    corpus: corpus.info,
    passes,
    verdict: result,
    threshold: options.threshold,
    env,
    dependencyCaveat: dependencyCaveat(base, head),
    ci: ciLinks(),
  };

  const summary = renderSummary(ctx);
  console.log(summary);

  if (options.summary !== "") appendFileSync(resolve(options.summary), `${summary}\n`);

  if (options.comment !== "") writeFileSync(resolve(options.comment), renderComment(ctx));

  if (options.out !== "") {
    const results: BenchResults = {
      tool: "bench:compare",
      version: 1,
      env,
      options,
      builds: { base, head },
      passes,
      verdict: result,
    };

    writeJson(resolve(options.out), results);
  }

  return result;
});

// Set after the worktrees are gone.
if (verdict.headMismatch) {
  console.error("[bench] the head build's reports differ from the expected reports");
  process.exitCode = 1;
} else if (options.failOnRegression && verdict.passes.some((pass) => pass.change === "regressed")) {
  console.error("[bench] rule time regressed beyond the threshold");
  process.exitCode = 1;
}
