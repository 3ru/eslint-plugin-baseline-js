/**
 * bench:sweep: lint growing synthetic corpora with the working-tree build and check that the
 * fixed and marginal cost per file stay flat as files multiply and as they grow.
 */
import { appendFileSync } from "node:fs";
import { resolve } from "node:path";
import { numberList, option, parseCli } from "./cli.mts";
import { type Column, fmtInt, fmtMb, fmtMs, fmtMsFine, fmtPct, markdownTable } from "./format.mts";
import { writeJson } from "./lib.mts";
import { buildLabel, sideMatches } from "./report.mts";
import {
  buildInfo,
  DEFAULT_SHARDS,
  environmentInfo,
  integerOption,
  measurePasses,
  planPasses,
  prepareSynthetic,
  withBuilds,
} from "./runner.mts";
import type { BenchResults, CostModel, PassName, PassResult } from "./types.mts";

/** Fixed or marginal cost this much above the first point of its axis is flagged. */
const SWEEP_GROWTH_LIMIT = 0.25;

/** The file-size axis runs at the smallest file-count scale, or at this one without any. */
const SIZE_AXIS_FALLBACK_SCALE = 1;
const SEED = 1;

const USAGE = `usage: pnpm bench:sweep [options]

Lints growing synthetic corpora with the working-tree build and flags fixed or marginal
cost per file that grows more than ${SWEEP_GROWTH_LIMIT * 100}% above the first point of its axis.

  --scales <list>          untyped scales, the file-count axis (default: 1,4,16)
  --typed-scales <list>    type-aware scales over the TypeScript files; an empty value skips
                           the type-aware pass (default: 1,4)
  --size-mults <list>      file-size multipliers at the smallest of --scales (${SIZE_AXIS_FALLBACK_SCALE} when
                           --scales is empty), the file-size axis; empty skips it (default: 1,4,16)
  --iterations <n>         iterations per point; each lints every shard once (default: 1)
  --out <file>             write the JSON results
  --summary <file>         append the Markdown report
  --help                   print this help`;

const OPTIONS = {
  scales: option.text("1,4,16"),
  typedScales: option.text("1,4"),
  sizeMults: option.text("1,4,16"),
  iterations: option.number(1),
  out: option.text(""),
  summary: option.text(""),
};

const options = parseCli(process.argv.slice(2), OPTIONS, USAGE, (parsed) => ({
  ...parsed,
  scales: numberList("scales", parsed.scales),
  typedScales: numberList("typed-scales", parsed.typedScales),
  sizeMults: numberList("size-mults", parsed.sizeMults),
  iterations: integerOption("iterations", parsed.iterations, 1),
}));

type Axis = "file count" | "file size";

interface Point {
  axis: Axis;
  pass: PassName;
  scale: number;
  sizeMult: number;
}

const ascending = (values: readonly number[]): number[] => values.toSorted((a, b) => a - b);
const sizeAxisScale = ascending(options.scales)[0] ?? SIZE_AXIS_FALLBACK_SCALE;

const points: Point[] = [
  ...ascending(options.scales).map(
    (scale): Point => ({ axis: "file count", pass: "untyped", scale, sizeMult: 1 }),
  ),
  ...ascending(options.typedScales).map(
    (scale): Point => ({ axis: "file count", pass: "type-aware", scale, sizeMult: 1 }),
  ),
  ...ascending(options.sizeMults).map(
    (sizeMult): Point => ({ axis: "file size", pass: "untyped", scale: sizeAxisScale, sizeMult }),
  ),
];

const pointKey = (point: Point): string => `${point.pass}:${point.scale}:${point.sizeMult}`;

interface Row {
  point: Point;
  result: PassResult;
  /** The first point of the row's axis and pass. */
  reference: PassResult;
}

/** NaN when the reference is not positive. */
function growth(row: Row, key: keyof CostModel): number {
  const reference = row.reference.sides.head.cost[key];

  return reference > 0 ? row.result.sides.head.cost[key] / reference - 1 : Number.NaN;
}

function growthCell(row: Row, key: keyof CostModel): string {
  if (row.result === row.reference) return "reference";
  const value = growth(row, key);

  return `${fmtPct(1 + value)}${value > SWEEP_GROWTH_LIMIT ? " ⚠️" : ""}`;
}

const COLUMNS: ReadonlyArray<Column<Row>> = [
  { title: "axis", cell: (row) => row.point.axis },
  { title: "pass", cell: (row) => row.point.pass },
  { title: "scale", align: "right", cell: (row) => String(row.point.scale) },
  { title: "size ×", align: "right", cell: (row) => String(row.point.sizeMult) },
  { title: "files", align: "right", cell: (row) => fmtInt(row.result.files) },
  { title: "nodes", align: "right", cell: (row) => fmtInt(row.result.nodes) },
  { title: "rule time", align: "right", cell: (row) => fmtMs(row.result.sides.head.rule_ms) },
  {
    title: "ms per file (fixed)",
    align: "right",
    cell: (row) => fmtMsFine(row.result.sides.head.cost.fixedMs),
  },
  { title: "Δ fixed", align: "right", cell: (row) => growthCell(row, "fixedMs") },
  {
    title: "ms per 1k nodes (marginal)",
    align: "right",
    cell: (row) => fmtMsFine(row.result.sides.head.cost.perKNodesMs),
  },
  { title: "Δ marginal", align: "right", cell: (row) => growthCell(row, "perKNodesMs") },
  { title: "peak RSS", align: "right", cell: (row) => fmtMb(row.result.sides.head.max_rss_kb) },
  {
    title: "reports expected → actual",
    align: "right",
    cell: ({ result: { oracle } }) =>
      oracle === null
        ? "n/a"
        : `${fmtInt(oracle.expected)} → ${fmtInt(oracle.head.reports)} ${sideMatches(oracle.head) ? "✅" : "❌"}`,
  },
];

const env = environmentInfo();

const { head, measured } = await withBuilds({ base: null, head: "." }, async (builds) => {
  const results = new Map<string, PassResult>();

  for (const point of points) {
    if (results.has(pointKey(point))) continue;
    const corpus = prepareSynthetic({ scale: point.scale, seed: SEED, sizeMult: point.sizeMult });

    const plans = planPasses(corpus, {
      shards: DEFAULT_SHARDS,
      iterations: {
        untyped: point.pass === "untyped" ? options.iterations : 0,
        "type-aware": point.pass === "type-aware" ? options.iterations : 0,
      },
    });

    const [result] = await measurePasses(corpus, plans, builds, {
      oracle: true,
      countNodes: false,
    });

    if (result === undefined) throw new Error(`no ${point.pass} files at scale ${point.scale}`);
    results.set(pointKey(point), result);
  }

  return { head: buildInfo(builds.head), measured: results };
});

function resultOf(point: Point): PassResult {
  const result = measured.get(pointKey(point));

  if (result === undefined) throw new Error(`no result for ${pointKey(point)}`);

  return result;
}

const rows = points.map((point): Row => {
  const first = points.find((other) => other.axis === point.axis && other.pass === point.pass);

  if (first === undefined) throw new Error("a point without an axis");

  return { point, result: resultOf(point), reference: resultOf(first) };
});

const flagged = rows.filter(
  (row) =>
    growth(row, "fixedMs") > SWEEP_GROWTH_LIMIT || growth(row, "perKNodesMs") > SWEEP_GROWTH_LIMIT,
);

const markdown = `${[
  `### use-baseline scale sweep · \`${buildLabel(head)}\``,
  "",
  `- ${DEFAULT_SHARDS} shards · ${options.iterations} iteration${options.iterations === 1 ? "" : "s"} per point · ${env.platform} · Node ${env.node} · ESLint ${env.eslint} · TypeScript ${env.typescript} · ${env.cpu}`,
  "",
  markdownTable(COLUMNS, rows),
  "",
  flagged.length === 0
    ? `Fixed and marginal cost stay within ${SWEEP_GROWTH_LIMIT * 100}% of the first point of each axis.`
    : `⚠️ ${flagged.length} point${flagged.length === 1 ? "" : "s"} grew more than ${SWEEP_GROWTH_LIMIT * 100}% above the first point of its axis.`,
  "",
  "Fixed and marginal cost are the intercept and slope of a least-squares line over each file's (nodes ÷ 1,000, rule time). Flat values along both axes mean the rule's cost is linear in files and in nodes; peak RSS is the largest shard process.",
].join("\n")}\n`;

console.log(markdown);

if (options.summary !== "") appendFileSync(resolve(options.summary), markdown);

if (options.out !== "") {
  const results: BenchResults = {
    tool: "bench:sweep",
    version: 1,
    env,
    options: {
      scales: options.scales.join(","),
      typedScales: options.typedScales.join(","),
      sizeMults: options.sizeMults.join(","),
      iterations: options.iterations,
    },
    builds: { base: null, head },
    passes: [...measured.values()],
    verdict: null,
  };

  writeJson(resolve(options.out), results);
}

// One iteration per point is too noisy to gate on growth; only a report mismatch fails.
if (
  ![...measured.values()].every((pass) => pass.oracle === null || sideMatches(pass.oracle.head))
) {
  console.error("[bench] the build's reports differ from the expected reports");
  process.exitCode = 1;
}
