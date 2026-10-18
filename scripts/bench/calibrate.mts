/**
 * bench:calibrate (local only): compare the fixed and marginal cost per file of the
 * calibration repositories and the synthetic corpus, with nodes counted the same way.
 */
import { resolve } from "node:path";
import { option, parseCli } from "./cli.mts";
import { type Column, fmtInt, fmtMb, fmtMs, fmtMsFine, markdownTable } from "./format.mts";
import { LOCAL_CORPUS_FILE, writeJson } from "./lib.mts";
import { ensureRealCorpusDir, filterEntries, loadLocalManifest } from "./real-corpus.mts";
import { buildLabel } from "./report.mts";
import {
  type BenchCorpus,
  type BuildPair,
  buildInfo,
  calibrationCorpus,
  costPoints,
  DEFAULT_SHARDS,
  distBuild,
  environmentInfo,
  fitCost,
  measurePasses,
  planPasses,
  positiveOption,
  prepareSynthetic,
} from "./runner.mts";
import type { BenchResults, PassName, PassResult } from "./types.mts";

/** Synthetic and real cost may differ by this share before the profile needs re-extracting. */
const CALIBRATION_TOLERANCE = 0.2;
const SEED = 1;

const USAGE = `usage: pnpm bench:calibrate [options]

Lints the calibration repositories and the synthetic corpus with dist/index.mjs and compares
their fixed and marginal cost per file (within ±${CALIBRATION_TOLERANCE * 100}% is calibrated). Local only;
run \`pnpm build\` first.

  --manifest <file>      calibration manifest (default: bench/corpus.local.json)
  --only <id,id>         calibration repositories to use (default: all)
  --typed                run the type-aware pass over TypeScript files (slow)
  --scale <n>            synthetic corpus scale to compare with (default: 1)
  --out <file>           write the JSON results
  --help                 print this help`;

const OPTIONS = {
  manifest: option.text(LOCAL_CORPUS_FILE),
  only: option.text(""),
  typed: option.flag(false),
  scale: option.number(1),
  out: option.text(""),
};

const options = parseCli(process.argv.slice(2), OPTIONS, USAGE, (parsed) => ({
  ...parsed,
  scale: positiveOption("scale", parsed.scale),
}));

const only = options.only
  .split(",")
  .values()
  .map((id) => id.trim())
  .filter((id) => id !== "")
  .toArray();

const build = distBuild();
const builds: BuildPair = { base: null, head: build };
const iterations: Record<PassName, number> = { untyped: 1, "type-aware": options.typed ? 1 : 0 };

async function measure(corpus: BenchCorpus): Promise<PassResult[]> {
  const plans = planPasses(corpus, { shards: DEFAULT_SHARDS, iterations });

  return measurePasses(corpus, plans, builds, { oracle: false, countNodes: true });
}

interface Measured {
  corpus: BenchCorpus;
  passes: PassResult[];
}

const repositories: Measured[] = [];

for (const entry of filterEntries(loadLocalManifest(resolve(options.manifest)), only)) {
  const corpus = calibrationCorpus(entry.id, await ensureRealCorpusDir(entry));
  console.error(`[bench] calibration repository ${entry.id}: ${corpus.files.untyped.length} files`);
  repositories.push({ corpus, passes: await measure(corpus) });
}

const synthetic = prepareSynthetic({ scale: options.scale, seed: SEED });
const syntheticPasses = await measure(synthetic);

const COLUMNS: ReadonlyArray<Column<PassResult>> = [
  { title: "source", cell: (pass) => `\`${pass.corpus.id}\`` },
  { title: "pass", cell: (pass) => pass.name },
  { title: "files", align: "right", cell: (pass) => fmtInt(pass.files) },
  { title: "nodes", align: "right", cell: (pass) => fmtInt(pass.nodes) },
  { title: "rule time", align: "right", cell: (pass) => fmtMs(pass.sides.head.rule_ms) },
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
];

const realPasses = repositories.flatMap((repository) => repository.passes);

console.log(`### use-baseline calibration · \`${buildLabel(buildInfo(build))}\`\n`);

console.log(markdownTable(COLUMNS, [...realPasses, ...syntheticPasses]));

for (const syntheticPass of syntheticPasses) {
  // One line over every calibration file, so large repositories weigh by their file count.
  const points = repositories.flatMap(({ corpus, passes }) =>
    passes
      .filter((pass) => pass.name === syntheticPass.name)
      .flatMap((pass) => costPoints(corpus, pass.runs)),
  );

  if (points.length === 0) continue;
  const real = fitCost(points);
  const { cost } = syntheticPass.sides.head;
  const fixed = cost.fixedMs / real.fixedMs;
  const marginal = cost.perKNodesMs / real.perKNodesMs;

  const within =
    Math.abs(fixed - 1) <= CALIBRATION_TOLERANCE && Math.abs(marginal - 1) <= CALIBRATION_TOLERANCE;

  const tolerance = `±${CALIBRATION_TOLERANCE * 100}%`;
  console.log(
    `\n${syntheticPass.name}: synthetic ÷ real = ${fixed.toFixed(2)}× fixed, ${marginal.toFixed(2)}× marginal (${within ? `within ${tolerance}` : `outside ${tolerance}: re-extract bench/profile.json with \`pnpm build && pnpm bench:profile\``})`,
  );
}

if (options.out !== "") {
  const results: BenchResults = {
    tool: "bench:calibrate",
    version: 1,
    env: environmentInfo(),
    options,
    builds: { base: null, head: buildInfo(build) },
    passes: [...realPasses, ...syntheticPasses],
    verdict: null,
  };

  writeJson(resolve(options.out), results);
}
