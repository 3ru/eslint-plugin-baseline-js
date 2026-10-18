#!/usr/bin/env node
/**
 * Scale sweep: lint the synthetic corpus at several scales with the working-tree build
 * and report whether cost per file and peak memory stay flat as the corpus grows.
 *
 *   pnpm bench:sweep                                   # scales 1,4,16 untyped; 1,4 typed
 *   pnpm bench:sweep --scales 1,2 --typed-scales 1 --summary "$GITHUB_STEP_SUMMARY" --out sweep.json
 */
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fmtDelta, fmtMb, fmtMs, fmtMsFine, parseArgs, ROOT } from "./lib.mjs";
import {
  buildRef,
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

const USAGE = `usage: node scripts/bench/sweep.mjs [options]
  --scales <list>          untyped scales (default: 1,4,16)
  --typed-scales <list>    type-aware scales over the TypeScript files, empty to skip (default: 1,4)
  --iterations <n>         runs per shard and scale (default: 1)
  --shards <n>             shards per run (default: 6)
  --seed <n>               generator seed (default: 1)
  --out <file>             write the JSON report here
  --summary <file>         append the Markdown report here`;

const args = parseArgs(
  process.argv.slice(2),
  { scales: "1,4,16", typedScales: "1,4", iterations: 1, shards: 6, seed: 1, out: "", summary: "" },
  { usage: USAGE },
);
const parseList = (text) =>
  text
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
const plan = [
  ...parseList(args.scales).map((scale) => ({ scale, typed: false })),
  ...parseList(args.typedScales).map((scale) => ({ scale, typed: true })),
];

const workDir = mkdtempSync(join(tmpdir(), "baseline-bench-sweep-"));
const build = buildRef(".", workDir);
const rows = [];
try {
  for (const step of plan) {
    const corpus = prepareSynthetic({ scale: step.scale, seed: args.seed });
    const files = step.typed ? corpus.typedFiles : corpus.files;
    const shards = shardFiles(files, args.shards);
    const nodes = files.reduce((n, f) => n + (corpus.nodesByFile.get(f) ?? 0), 0);
    const expected = files.reduce(
      (n, f) => n + (corpus.expectedByFile.get(f)?.[step.typed ? "typed" : "untyped"] ?? 0),
      0,
    );
    const iterations = [];
    for (let i = 0; i < args.iterations; i++) {
      const runs = [];
      for (const shard of shards)
        runs.push(
          await runJob(
            build.pluginPath,
            shardJob(corpus, shard, { typed: step.typed, policy: TIMING_POLICY }),
          ),
        );
      iterations.push(runs);
    }
    let reports = 0;
    let fatals = 0;
    for (const shard of shards) {
      const r = await runJob(
        build.pluginPath,
        shardJob(corpus, shard, { typed: step.typed, policy: ORACLE_POLICY }),
      );
      reports += r.reports;
      fatals += r.fatals;
    }
    const rule = medianTotal(iterations, "rule_ms");
    rows.push({
      pass: step.typed ? "typed" : "untyped",
      scale: step.scale,
      files: files.length,
      nodes,
      rule_ms: rule,
      lint_ms: medianTotal(iterations, "lint_ms"),
      perFile: rule / files.length,
      perKNodes: (rule / nodes) * 1000,
      max_rss_kb: medianMaxRss(iterations),
      expected,
      reports,
      fatals,
    });
    console.error(
      `[sweep] ${step.typed ? "typed" : "untyped"} scale ${step.scale}: ${files.length} files, ${fmtMsFine(rule / files.length)}/file`,
    );
  }
} finally {
  build.cleanup();
  rmSync(workDir, { recursive: true, force: true });
}

const env = environmentInfo();
const lines = [];
let mismatched = 0;
lines.push(`### use-baseline scale sweep: ${build.label}`);
lines.push("");
lines.push(
  `Synthetic corpus, timing under \`available: "widely"\`, ${args.shards} shards, ${args.iterations} iteration(s). Node ${env.node}, ESLint ${env.eslint}, TypeScript ${env.typescript}, ${env.platform}, ${env.cpu}.`,
);
lines.push("");
lines.push(
  "| pass | scale | files | use-baseline time | lint total | ms/file | ms per 1k nodes | max RSS | reports expected → actual | vs smallest scale |",
);
lines.push("|---|---:|---:|---|---|---|---|---|---|---|");
for (const pass of ["untyped", "typed"]) {
  const group = rows.filter((r) => r.pass === pass).sort((a, b) => a.scale - b.scale);
  const first = group[0];
  for (const r of group) {
    const ok = r.reports === r.expected && r.fatals === 0;
    if (!ok) mismatched++;
    const growth =
      first && r !== first
        ? `ms/file ${fmtDelta(first.perFile, r.perFile)}${r.perFile > first.perFile * 1.25 ? " ⚠️" : ""}, RSS ${fmtDelta(first.max_rss_kb, r.max_rss_kb)}`
        : "reference";
    lines.push(
      `| ${pass} | ${r.scale} | ${r.files} | ${fmtMs(r.rule_ms)} | ${fmtMs(r.lint_ms)} | ${fmtMsFine(r.perFile)} | ${fmtMsFine(r.perKNodes)} | ${fmtMb(r.max_rss_kb)} | ${r.expected} → ${r.reports}${ok ? " ✅" : " ❌"} | ${growth} |`,
    );
  }
}
lines.push("");
lines.push(
  "A flat ms/file across scales means the rule's cost is linear in the number of files; ⚠️ marks growth above 25% against the smallest scale. RSS is the largest shard process at each scale.",
);
const markdown = `${lines.join("\n")}\n`;
console.log(markdown);
if (args.summary) appendFileSync(resolve(args.summary), `\n${markdown}`);
if (args.out) {
  const out = resolve(ROOT, args.out);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(
    out,
    `${JSON.stringify({ meta: { ...env, build: build.label, shards: args.shards, iterations: args.iterations, seed: args.seed }, rows }, null, 2)}\n`,
  );
}
if (mismatched) {
  console.error(
    `[sweep] ${mismatched} run${mismatched === 1 ? "" : "s"} reported a different number of detections than expected`,
  );
  process.exitCode = 1;
}
