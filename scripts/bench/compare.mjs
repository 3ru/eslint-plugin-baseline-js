#!/usr/bin/env node
/**
 * Before/after benchmark of two plugin builds on the synthetic corpus.
 *
 *   pnpm bench:compare                                  # origin/main vs working tree, scale 3
 *   pnpm bench:compare --base v0.7.5 --head . --scale 1 --iterations 5
 *   pnpm bench:compare --base <sha> --head . --summary "$GITHUB_STEP_SUMMARY" --out bench-results.json
 *
 * Each ref is built with tsdown in a detached worktree ("." builds the working tree in
 * place). The corpus is split into shards; every iteration lints every shard with both
 * builds, alternating which build goes first, so machine drift hits both sides equally and
 * each (shard, iteration) pair is an independent observation. Timing runs under
 * `available: "widely"`; one extra pass under a report-everything policy checks that each
 * build reports exactly the detections the generator injected.
 */
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { git, parseArgs, ROOT } from "./lib.mjs";
import { evaluate, renderComment, renderSummary } from "./report.mjs";
import {
  buildRef,
  environmentInfo,
  ORACLE_POLICY,
  prepareSynthetic,
  runJob,
  shardFiles,
  shardJob,
  summarizePass,
  TIMING_POLICY,
} from "./runner.mjs";

const USAGE = `usage: node scripts/bench/compare.mjs [options]
  --base <ref>              git ref to compare against (default: origin/main, else main)
  --head <ref>              git ref under test, "." for the working tree (default: .)
  --scale <n>               corpus size: n × 1,000 files (default: 3)
  --seed <n>                generator seed (default: 1)
  --iterations <n>          untyped iterations, alternating builds (default: 3)
  --typed-iterations <n>    type-aware iterations over the TypeScript files, 0 to skip (default: 2)
  --shards <n>              shards per iteration, each a fresh process (default: 6)
  --threshold <pct>         flag a use-baseline slowdown above this percentage (default: 10)
  --fail-on-regression      exit 1 when a flagged slowdown exists (report mismatches always exit 1)
  --no-oracle               skip the expected-report check
  --size-mult, --detections-mult, --collisions-mult, --shadow-mult, --lang-mix
                            generator overrides, see scripts/bench/synth.mjs
  --out <file>              write the JSON report here
  --summary <file>          append the full Markdown report here (e.g. $GITHUB_STEP_SUMMARY)
  --comment <file>          write the compact Markdown report for a pull-request comment here
  --base-label, --head-label
                            names shown instead of the refs (CI passes the commit SHAs)`;

function defaultBase() {
  try {
    git(["rev-parse", "--verify", "origin/main^{commit}"]);
    return "origin/main";
  } catch {
    return "main";
  }
}

const args = parseArgs(
  process.argv.slice(2),
  {
    base: "",
    head: ".",
    scale: 3,
    seed: 1,
    iterations: 3,
    typedIterations: 2,
    shards: 6,
    threshold: 10,
    failOnRegression: false,
    oracle: true,
    sizeMult: 1,
    detectionsMult: 1,
    collisionsMult: 1,
    shadowMult: 1,
    langMix: "",
    out: "",
    summary: "",
    comment: "",
    baseLabel: "",
    headLabel: "",
  },
  { usage: USAGE },
);
const baseRef = args.base || defaultBase();

function refLabel(ref, build) {
  if (/^[0-9a-f]{7,40}$/i.test(ref)) return ref.slice(0, 7);
  if (ref === ".") {
    return `working tree ${build.sha.slice(0, 7)}${build.sha.endsWith("+dirty") ? "*" : ""}`;
  }
  return `${ref} @ ${build.sha.slice(0, 7)}`;
}

const corpus = prepareSynthetic({
  scale: args.scale,
  seed: args.seed,
  sizeMult: args.sizeMult,
  detectionsMult: args.detectionsMult,
  collisionsMult: args.collisionsMult,
  shadowMult: args.shadowMult,
  langMix: args.langMix,
});
console.error(
  `[bench] corpus ${corpus.id} ${corpus.reused ? "reused" : "generated"}: ${corpus.manifest.totals.files} files, ${corpus.manifest.totals.nodes} nodes`,
);

const passes = [
  { name: "untyped", typed: false, files: corpus.files, iterations: args.iterations },
];
if (args.typedIterations > 0 && corpus.typedFiles.length) {
  passes.push({
    name: "typed",
    typed: true,
    files: corpus.typedFiles,
    iterations: args.typedIterations,
  });
}
for (const pass of passes) {
  pass.shards = shardFiles(pass.files, args.shards);
  pass.nodes = pass.files.reduce((n, f) => n + (corpus.nodesByFile.get(f) ?? 0), 0);
  pass.expected = pass.files.reduce(
    (n, f) => n + (corpus.expectedByFile.get(f)?.[pass.typed ? "typed" : "untyped"] ?? 0),
    0,
  );
}

const workDir = mkdtempSync(join(tmpdir(), "baseline-bench-builds-"));
const builds = {};
try {
  console.error(`[bench] building base ${baseRef}`);
  builds.base = buildRef(baseRef, workDir);
  console.error(`[bench] building head ${args.head}`);
  builds.head = buildRef(args.head, workDir);

  // ---- oracle: every build must report exactly the injected detections ---------------
  const oracle = {};
  if (args.oracle) {
    for (const pass of passes) {
      oracle[pass.name] = { expected: pass.expected };
      for (const side of ["base", "head"]) {
        let reports = 0;
        let fatals = 0;
        const mismatches = [];
        for (const shard of pass.shards) {
          const r = await runJob(
            builds[side].pluginPath,
            shardJob(corpus, shard, {
              typed: pass.typed,
              policy: ORACLE_POLICY,
              perFileReports: true,
            }),
          );
          reports += r.reports;
          fatals += r.fatals;
          for (const [file, count] of Object.entries(r.reportsByFile ?? {})) {
            const want = corpus.expectedByFile.get(file)?.[pass.typed ? "typed" : "untyped"] ?? 0;
            if (count !== want && mismatches.length < 10)
              mismatches.push({ file, expected: want, actual: count });
          }
        }
        oracle[pass.name][side] = { reports, fatals, mismatches };
      }
      console.error(
        `[bench] oracle ${pass.name}: expected ${pass.expected}, base ${oracle[pass.name].base.reports}, head ${oracle[pass.name].head.reports}`,
      );
    }
  }

  // ---- timing ---------------------------------------------------------------------------
  const results = {};
  for (const pass of passes) {
    const runs = { base: [], head: [] };
    for (let i = 0; i < pass.iterations; i++) {
      runs.base.push([]);
      runs.head.push([]);
      const order = i % 2 === 0 ? ["base", "head"] : ["head", "base"];
      for (const shard of pass.shards) {
        for (const side of order) {
          runs[side][i].push(
            await runJob(
              builds[side].pluginPath,
              shardJob(corpus, shard, { typed: pass.typed, policy: TIMING_POLICY }),
            ),
          );
        }
      }
      console.error(`[bench] ${pass.name} iteration ${i + 1}/${pass.iterations} done`);
    }
    results[pass.name] = {
      ...summarizePass(runs, { files: pass.files.length, nodes: pass.nodes }),
      runs,
    };
  }

  // ---- report ---------------------------------------------------------------------------
  const env = environmentInfo();
  const evaluation = evaluate(passes, results, oracle, { threshold: args.threshold });
  const ctx = {
    baseLabel: args.baseLabel || refLabel(baseRef, builds.base),
    headLabel: args.headLabel || refLabel(args.head, builds.head),
    corpus,
    args,
    env,
    evaluation,
  };
  const summary = renderSummary(ctx);
  console.log(summary);
  if (args.summary) appendFileSync(resolve(args.summary), `\n${summary}`);
  if (args.comment) writeFileSync(resolve(args.comment), renderComment(ctx));
  const t = corpus.manifest.totals;
  if (args.out) {
    const out = resolve(ROOT, args.out);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(
      out,
      `${JSON.stringify(
        {
          meta: {
            ...env,
            scale: args.scale,
            seed: args.seed,
            shards: args.shards,
            iterations: args.iterations,
            typedIterations: args.typedIterations,
            threshold: args.threshold,
            corpus: corpus.id,
            corpusTotals: t,
          },
          builds: {
            base: { ref: builds.base.ref, label: builds.base.label, sha: builds.base.sha },
            head: { ref: builds.head.ref, label: builds.head.label, sha: builds.head.sha },
          },
          oracle,
          passes: results,
        },
        null,
        2,
      )}\n`,
    );
    console.error(`[bench] report written to ${args.out}`);
  }
  if (evaluation.mismatched) {
    console.error(
      `[bench] ${evaluation.mismatched} pass${evaluation.mismatched === 1 ? "" : "es"} reported a different number of detections than expected`,
    );
    process.exitCode = 1;
  } else if (evaluation.regressions && args.failOnRegression) {
    console.error(
      `[bench] ${evaluation.regressions} pass${evaluation.regressions === 1 ? "" : "es"} regressed beyond the threshold`,
    );
    process.exitCode = 1;
  }
} finally {
  for (const build of Object.values(builds)) build.cleanup();
  rmSync(workDir, { recursive: true, force: true });
}
