#!/usr/bin/env node
/**
 * Calibration (local only): lint real repositories from the git-ignored
 * bench/corpus.local.json and the synthetic corpus with the same build, and compare the
 * cost per file and per 1,000 AST nodes. Use it after re-extracting the profile or when the
 * synthetic numbers look implausible; it is not part of CI.
 *
 *   pnpm bench:calibrate                       # untyped, synthetic scale 1
 *   pnpm bench:calibrate --typed --scale 1 --manifest bench/corpus.local.json
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fmtMb, fmtMsFine, LOCAL_CORPUS_FILE, parseArgs } from "./lib.mjs";
import { ensureRealCorpusDir, loadLocalManifest } from "./real-corpus.mjs";
import {
  buildRef,
  prepareSynthetic,
  runJob,
  shardFiles,
  shardJob,
  TIMING_POLICY,
  writeShardTsconfig,
} from "./runner.mjs";

const USAGE = `usage: node scripts/bench/calibrate.mjs [options]
  --manifest <file>      local real-repository manifest (default: bench/corpus.local.json)
  --scale <n>            synthetic scale to compare against (default: 1)
  --shards <n>           shards for the synthetic corpus (default: 6)
  --typed                also lint TypeScript with type information (slow)
  --max-files <n>        files per real repository (default: 2000)`;

const args = parseArgs(
  process.argv.slice(2),
  { manifest: LOCAL_CORPUS_FILE, scale: 1, shards: 6, typed: false, maxFiles: 2000 },
  { usage: USAGE },
);
const manifest = loadLocalManifest(resolve(args.manifest));
const workDir = mkdtempSync(join(tmpdir(), "baseline-bench-calibrate-"));
const build = buildRef(".", workDir);
const rows = [];
try {
  for (const entry of manifest.entries) {
    const { dir, files } = await ensureRealCorpusDir(entry, { maxFiles: args.maxFiles });
    const corpus = { dir, id: `real-${entry.id}` };
    const untyped = await runJob(
      build.pluginPath,
      shardJob(corpus, files, { typed: false, policy: TIMING_POLICY, countNodes: true }),
    );
    rows.push({
      source: entry.id,
      kind: "real",
      pass: "untyped",
      files: untyped.files,
      nodes: untyped.nodes,
      rule_ms: untyped.rule_ms,
      max_rss_kb: untyped.max_rss_kb,
    });
    if (args.typed) {
      const tsFiles = files.filter((f) => /\.(ts|tsx|mts|cts)$/.test(f));
      if (tsFiles.length) {
        const job = shardJob(corpus, tsFiles, {
          typed: true,
          policy: TIMING_POLICY,
          countNodes: true,
        });
        job.tsconfig = writeShardTsconfig(dir, corpus.id, tsFiles);
        const typed = await runJob(build.pluginPath, job);
        rows.push({
          source: entry.id,
          kind: "real",
          pass: "typed",
          files: typed.files,
          nodes: typed.nodes,
          rule_ms: typed.rule_ms,
          max_rss_kb: typed.max_rss_kb,
        });
      }
    }
    console.error(
      `[calibrate] ${entry.id}: ${untyped.files} files, ${fmtMsFine(untyped.rule_ms / untyped.files)}/file`,
    );
  }
  const synthetic = prepareSynthetic({ scale: args.scale });
  for (const pass of [
    { name: "untyped", typed: false, files: synthetic.files },
    ...(args.typed ? [{ name: "typed", typed: true, files: synthetic.typedFiles }] : []),
  ]) {
    let rule = 0;
    let files = 0;
    let rss = 0;
    for (const shard of shardFiles(pass.files, args.shards)) {
      const r = await runJob(
        build.pluginPath,
        shardJob(synthetic, shard, { typed: pass.typed, policy: TIMING_POLICY }),
      );
      rule += r.rule_ms;
      files += r.files;
      rss = Math.max(rss, r.max_rss_kb);
    }
    const nodes = pass.files.reduce((n, f) => n + (synthetic.nodesByFile.get(f) ?? 0), 0);
    rows.push({
      source: `synthetic scale ${args.scale}`,
      kind: "synthetic",
      pass: pass.name,
      files,
      nodes,
      rule_ms: rule,
      max_rss_kb: rss,
    });
  }
} finally {
  build.cleanup();
  rmSync(workDir, { recursive: true, force: true });
}

console.log(`### calibration: ${build.label}\n`);
console.log("| source | pass | files | nodes | ms/file | ms per 1k nodes | max RSS |");
console.log("|---|---|---:|---:|---|---|---|");
for (const r of rows)
  console.log(
    `| ${r.source} | ${r.pass} | ${r.files} | ${r.nodes ?? "n/a"} | ${fmtMsFine(r.rule_ms / r.files)} | ${r.nodes ? fmtMsFine((r.rule_ms / r.nodes) * 1000) : "n/a"} | ${fmtMb(r.max_rss_kb)} |`,
  );
for (const pass of ["untyped", "typed"]) {
  const real = rows.filter((r) => r.kind === "real" && r.pass === pass);
  const synth = rows.find((r) => r.kind === "synthetic" && r.pass === pass);
  if (!real.length || !synth) continue;
  const realRule = real.reduce((n, r) => n + r.rule_ms, 0);
  const realFiles = real.reduce((n, r) => n + r.files, 0);
  const realNodes = real.reduce((n, r) => n + (r.nodes ?? 0), 0);
  const perFile = synth.rule_ms / synth.files / (realRule / realFiles);
  const perNode = realNodes ? synth.rule_ms / synth.nodes / (realRule / realNodes) : Number.NaN;
  console.log(
    `\n${pass}: synthetic / real = ${perFile.toFixed(2)}× per file, ${Number.isFinite(perNode) ? perNode.toFixed(2) : "n/a"}× per 1k nodes${Math.abs(perFile - 1) > 0.2 || Math.abs(perNode - 1) > 0.2 ? " (outside ±20%: consider re-extracting bench/profile.json)" : " (within ±20%)"}`,
  );
}
