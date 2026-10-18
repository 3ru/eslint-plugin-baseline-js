#!/usr/bin/env node
/**
 * Lint the synthetic corpus with one plugin build and print totals.
 *
 *   pnpm bench                                  # dist/index.mjs, scale 3, untyped + typed
 *   pnpm bench --scale 1 --iterations 1 --no-typed
 *   pnpm bench --plugin ../other/dist/index.mjs --scale 1
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fmtMb, fmtMs, fmtMsFine, parseArgs, ROOT } from "./lib.mjs";
import {
  environmentInfo,
  medianMaxRss,
  medianTotal,
  ORACLE_POLICY,
  prepareSynthetic,
  runJob,
  shardFiles,
  shardJob,
  TIMING_POLICY,
} from "./runner.mjs";

const USAGE = `usage: node scripts/bench/run.mjs [options]
  --plugin <path>        plugin bundle to measure (default: dist/index.mjs)
  --scale <n>            corpus size: n × 1,000 files (default: 3)
  --seed <n>             generator seed (default: 1)
  --iterations <n>       runs per shard (default: 1)
  --shards <n>           shards, each a fresh process (default: 6)
  --typed / --no-typed   also lint the TypeScript files with type information (default: on)
  --no-oracle            skip the expected-report check
  --size-mult, --detections-mult, --collisions-mult, --shadow-mult, --lang-mix
                         generator overrides, see scripts/bench/synth.mjs
  --out <file>           write the JSON report here`;

const args = parseArgs(
  process.argv.slice(2),
  {
    plugin: "dist/index.mjs",
    scale: 3,
    seed: 1,
    iterations: 1,
    shards: 6,
    typed: true,
    oracle: true,
    sizeMult: 1,
    detectionsMult: 1,
    collisionsMult: 1,
    shadowMult: 1,
    langMix: "",
    out: "",
  },
  { usage: USAGE },
);

const pluginPath = resolve(ROOT, args.plugin);
const corpus = prepareSynthetic({
  scale: args.scale,
  seed: args.seed,
  sizeMult: args.sizeMult,
  detectionsMult: args.detectionsMult,
  collisionsMult: args.collisionsMult,
  shadowMult: args.shadowMult,
  langMix: args.langMix,
});
const t = corpus.manifest.totals;
console.log(
  `corpus ${corpus.id} (${corpus.reused ? "reused" : "generated"}): ${t.files} files, ${t.nodes} nodes; plugin ${args.plugin}`,
);

const passes = [{ name: "untyped", typed: false, files: corpus.files }];
if (args.typed && corpus.typedFiles.length)
  passes.push({ name: "typed", typed: true, files: corpus.typedFiles });
const report = {
  meta: {
    ...environmentInfo(),
    plugin: pluginPath,
    scale: args.scale,
    seed: args.seed,
    corpus: corpus.id,
  },
  passes: {},
};
console.log("");
console.log(
  "| pass | files | use-baseline time | lint total | parse | ms/file | ms per 1k nodes | max RSS | reports expected → actual | fatals |",
);
console.log("|---|---:|---|---|---|---|---|---|---|---:|");
let mismatched = 0;
for (const pass of passes) {
  const shards = shardFiles(pass.files, args.shards);
  const nodes = pass.files.reduce((n, f) => n + (corpus.nodesByFile.get(f) ?? 0), 0);
  const expected = pass.files.reduce(
    (n, f) => n + (corpus.expectedByFile.get(f)?.[pass.typed ? "typed" : "untyped"] ?? 0),
    0,
  );
  const iterations = [];
  for (let i = 0; i < args.iterations; i++) {
    const shardRuns = [];
    for (const shard of shards)
      shardRuns.push(
        await runJob(
          pluginPath,
          shardJob(corpus, shard, { typed: pass.typed, policy: TIMING_POLICY }),
        ),
      );
    iterations.push(shardRuns);
  }
  let actual = null;
  let fatals = 0;
  if (args.oracle) {
    actual = 0;
    for (const shard of shards) {
      const r = await runJob(
        pluginPath,
        shardJob(corpus, shard, { typed: pass.typed, policy: ORACLE_POLICY }),
      );
      actual += r.reports;
      fatals += r.fatals;
    }
    if (actual !== expected || fatals) mismatched++;
  }
  const rule = medianTotal(iterations, "rule_ms");
  const lint = medianTotal(iterations, "lint_ms");
  const parse = medianTotal(iterations, "parse_ms");
  const rss = medianMaxRss(iterations);
  report.passes[pass.name] = {
    files: pass.files.length,
    nodes,
    expected,
    actual,
    fatals,
    rule_ms: rule,
    lint_ms: lint,
    parse_ms: parse,
    max_rss_kb: rss,
    iterations,
  };
  console.log(
    `| ${pass.name}${pass.typed ? " (ts+tsx, type-aware)" : ""} | ${pass.files.length} | ${fmtMs(rule)} | ${fmtMs(lint)} | ${fmtMs(parse)} | ${fmtMsFine(rule / pass.files.length)} | ${fmtMsFine((rule / nodes) * 1000)} | ${fmtMb(rss)} | ${actual === null ? "n/a" : `${expected} → ${actual}${actual === expected ? " ✅" : " ❌"}`} | ${fatals} |`,
  );
}
if (args.out) {
  const out = resolve(ROOT, args.out);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`\nreport written to ${args.out}`);
}
if (mismatched) {
  console.error(
    `${mismatched} pass${mismatched === 1 ? "" : "es"} reported a different number of detections than expected`,
  );
  process.exitCode = 1;
}
