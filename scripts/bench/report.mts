/**
 * The verdict of a base/head comparison and its two Markdown renderings, the pull request
 * comment and the job summary, whose tables select columns from one definition.
 */
import {
  type Column,
  fmtCi,
  fmtInt,
  fmtMb,
  fmtMs,
  fmtMsFine,
  fmtP,
  fmtPct,
  markdownTable,
} from "./format.mts";
import { compareText } from "./lib.mts";
import { type Change, classifyChange, holm, type PairedEstimate, SIGNIFICANCE } from "./stats.mts";
import type {
  BuildInfo,
  CorpusInfo,
  EnvironmentInfo,
  OraclePass,
  OracleRuleOptions,
  OracleSide,
  PassComparison,
  PassResult,
  PassVerdict,
  ReportMismatch,
  SideSummary,
  Verdict,
  VerdictKind,
} from "./types.mts";

const ORACLE_POLICY: OracleRuleOptions["available"] = 1900;

/** Features named per pass in a CAUTION line. */
const VERDICT_FEATURES = 3;

const MISMATCH_LINES = 10;

export const STALE_SNIPPETS =
  "Snippets were verified against different plugin data; run `pnpm build && pnpm bench:snippets` and commit the result.";

const DEPENDENCY_CAVEAT =
  "Dependencies differ between base and head; both builds ran with head's installed packages.";

/** Worst first. */
const SEVERITY: readonly Change[] = [
  "regressed",
  "slower",
  "inconclusive",
  "unknown",
  "unchanged",
  "faster",
];

function comparisonOf(pass: PassResult): PassComparison {
  if (pass.comparison === null) throw new Error(`${pass.name}: no base build to compare with`);

  return pass.comparison;
}

/** Every file got exactly its expected reports, and no file failed to parse. */
export function sideMatches(side: OracleSide): boolean {
  return side.mismatches.length === 0 && side.fatals === 0;
}

interface FeatureMismatch {
  featureId: string;
  missing: number;
  extra: number;
  files: number;
}

/** Largest first. */
function byFeature(mismatches: readonly ReportMismatch[]): FeatureMismatch[] {
  const groups = Map.groupBy(mismatches, (mismatch) => mismatch.featureId);

  return [...groups]
    .map(([featureId, list]) => ({
      featureId,
      missing: list.reduce((sum, m) => sum + Math.max(0, m.expected - m.actual), 0),
      extra: list.reduce((sum, m) => sum + Math.max(0, m.actual - m.expected), 0),
      files: list.length,
    }))
    .sort(
      (a, b) =>
        b.missing + b.extra - (a.missing + a.extra) || compareText(a.featureId, b.featureId),
    );
}

function signedCounts({ missing, extra }: FeatureMismatch): string {
  const parts = [];

  if (missing > 0) parts.push(`−${missing}`);

  if (extra > 0) parts.push(`+${extra}`);

  return parts.join(" ");
}

function mismatchSummary(pass: PassResult, oracle: OraclePass): string {
  const features = byFeature(oracle.head.mismatches);

  const named = features
    .slice(0, VERDICT_FEATURES)
    .map((feature) => `${feature.featureId} ${signedCounts(feature)}`);

  if (features.length > VERDICT_FEATURES) named.push("…");

  if (oracle.head.fatals > 0) {
    named.push(`${oracle.head.fatals} parse error${oracle.head.fatals === 1 ? "" : "s"}`);
  }

  return `${pass.name} ${fmtInt(oracle.head.reports)} of ${fmtInt(oracle.expected)} (${named.join(", ")})`;
}

interface Judged {
  pass: PassResult;
  estimate: PairedEstimate;
  verdict: PassVerdict;
}

/** "untyped +6.1% (+3.0% … +9.3%)"; `label` names the interval in a list's first entry. */
function changeText({ pass, estimate }: Judged, label = ""): string {
  return `${pass.name} ${fmtPct(estimate.ratio)} (${label}${fmtCi(estimate)})`;
}

function timingLine(change: Change, judged: readonly Judged[], threshold: number): string {
  const list = judged.filter((row) => row.verdict.change === change);

  switch (change) {
    case "regressed": {
      const texts = list.map((row, index) => changeText(row, index === 0 ? "95% CI " : ""));

      return `Rule time regressed: ${texts.join(", ")}; threshold ${threshold}%.`;
    }

    case "slower":
      return `Slower: ${list.map((row) => changeText(row)).join(", ")}.`;
    case "faster":
      return `Faster: ${list.map((row) => changeText(row)).join(", ")}.`;
    case "inconclusive": {
      const intervals = list.map((row) => `${row.pass.name} ${fmtCi(row.estimate)}`).join(", ");
      const [noun, verb] = list.length === 1 ? ["interval", "is"] : ["intervals", "are"];

      return `Inconclusive: the 95% ${noun} (${intervals}) ${verb} wider than the ${threshold}% threshold.`;
    }

    case "unchanged":
      return `No change in rule time beyond ${list.map((row) => `${row.pass.name} ${fmtCi(row.estimate)}`).join(", ")}.`;
    case "unknown":
      return `One pair: no interval; rule time ${list.map((row) => `${row.pass.name} ${fmtPct(row.estimate.ratio)}`).join(", ")}.`;
  }
}

const KIND_BY_CHANGE: Record<Change, VerdictKind> = {
  regressed: "WARNING",
  slower: "NOTE",
  inconclusive: "NOTE",
  unknown: "NOTE",
  unchanged: "NOTE",
  faster: "TIP",
};

export interface EvaluateOptions {
  /** Regression threshold in percent. */
  threshold: number;
  snippetsStale: boolean;
}

/** Judges each pass by its rule-time estimate, Holm-adjusted across passes; the worst decides. */
export function evaluate(
  passes: readonly PassResult[],
  { threshold, snippetsStale }: EvaluateOptions,
): Verdict {
  if (passes.length === 0) throw new Error("nothing to evaluate: no pass ran");
  const estimates = passes.map((pass) => comparisonOf(pass).metrics.rule_ms);
  const adjusted = holm(estimates.map((estimate) => estimate.p));

  const judged = passes.map((pass, index): Judged => {
    const estimate = estimates[index];
    const pAdjusted = adjusted[index];

    if (estimate === undefined || pAdjusted === undefined) throw new Error("passes out of step");
    const change = classifyChange(estimate, { threshold: threshold / 100, pAdjusted });

    return { pass, estimate, verdict: { pass: pass.name, change, pAdjusted } };
  });

  const worst = SEVERITY.find((change) => judged.some((row) => row.verdict.change === change));

  if (worst === undefined) throw new Error("no pass has a known change kind");

  const mismatched = passes.flatMap((pass) =>
    pass.oracle !== null && !sideMatches(pass.oracle.head) ? [{ pass, oracle: pass.oracle }] : [],
  );

  const lines = [];

  if (mismatched.length > 0) {
    const list = mismatched.map(({ pass, oracle }) => mismatchSummary(pass, oracle));
    lines.push(`Reports differ from the expected reports: ${list.join("; ")}.`);
  }

  if (snippetsStale) lines.push(STALE_SNIPPETS);
  // The timing line stays below a CAUTION: the numbers are still worth reading.
  lines.push(timingLine(worst, judged, threshold));
  const caution = mismatched.length > 0 || snippetsStale;

  return {
    kind: caution ? "CAUTION" : KIND_BY_CHANGE[worst],
    lines,
    passes: judged.map((row) => row.verdict),
    headMismatch: mismatched.length > 0,
  };
}

export interface CiLinks {
  serverUrl: string;
  repository: string;
  runId: string | null;
}

export interface ReportContext {
  baseLabel: string;
  headLabel: string;
  corpus: CorpusInfo;
  passes: readonly PassResult[];
  verdict: Verdict;
  threshold: number;
  env: EnvironmentInfo;
  dependencyCaveat: boolean;
  ci: CiLinks | null;
}

export function buildLabel(build: BuildInfo): string {
  return build.dirty ? `${build.label}+dirty` : build.label;
}

interface Row {
  pass: PassResult;
  base: SideSummary;
  head: SideSummary;
  comparison: PassComparison;
  verdict: PassVerdict;
}

function rows(ctx: ReportContext): Row[] {
  return ctx.passes.map((pass) => {
    const verdict = ctx.verdict.passes.find((entry) => entry.pass === pass.name);

    if (pass.sides.base === null || verdict === undefined) {
      throw new Error(`${pass.name}: a comparison report needs both builds and a verdict`);
    }

    return {
      pass,
      base: pass.sides.base,
      head: pass.sides.head,
      comparison: comparisonOf(pass),
      verdict,
    };
  });
}

function reportsCell({ pass }: Row): string {
  if (pass.oracle === null) return "n/a";

  return `${fmtInt(pass.oracle.head.reports)} ${sideMatches(pass.oracle.head) ? "✅" : "❌"}`;
}

function expectedBaseHeadCell(row: Row): string {
  const { oracle } = row.pass;

  if (oracle === null) return "n/a";

  const base =
    oracle.base === null
      ? "n/a"
      : `${fmtInt(oracle.base.reports)}${sideMatches(oracle.base) ? "" : " ⚠️"}`;

  return `${fmtInt(oracle.expected)} → ${base} → ${reportsCell(row)}`;
}

function ruleDeltaCell({ comparison, verdict }: Row): string {
  const estimate = comparison.metrics.rule_ms;
  const pct = fmtPct(estimate.ratio);
  const shown = verdict.change === "regressed" ? `**${pct}**` : pct;
  const interval = verdict.change === "unknown" ? "one pair" : fmtCi(estimate);

  return `${shown} (${interval})`;
}

function ratioCell(estimate: PairedEstimate | null): string {
  return estimate === null ? "n/a" : fmtPct(estimate.ratio);
}

function costCell(row: Row, key: "fixedMs" | "perKNodesMs"): string {
  return `${fmtMsFine(row.base.cost[key])} → ${fmtMsFine(row.head.cost[key])}`;
}

const COLUMNS = {
  pass: { title: "pass", cell: (row) => row.pass.name },
  files: { title: "files", align: "right", cell: (row) => fmtInt(row.pass.files) },
  ruleTime: { title: "rule time", align: "right", cell: (row) => fmtMs(row.head.rule_ms) },
  ruleDelta: { title: "Δ (95% CI)", align: "right", cell: ruleDeltaCell },
  pHolm: { title: "p (Holm)", align: "right", cell: (row) => fmtP(row.verdict.pAdjusted) },
  lintTotal: { title: "lint total", align: "right", cell: (row) => fmtMs(row.head.lint_ms) },
  lintDelta: {
    title: "Δ",
    align: "right",
    cell: (row) => ratioCell(row.comparison.metrics.lint_ms),
  },
  threadCpuDelta: {
    title: "thread CPU Δ",
    align: "right",
    cell: (row) => ratioCell(row.comparison.metrics.thread_cpu_ms),
  },
  peakRss: { title: "peak RSS", align: "right", cell: (row) => fmtMb(row.head.max_rss_kb) },
  rssDelta: {
    title: "Δ",
    align: "right",
    cell: (row) => ratioCell(row.comparison.metrics.max_rss_kb),
  },
  fixed: { title: "ms per file (fixed)", align: "right", cell: (row) => costCell(row, "fixedMs") },
  marginal: {
    title: "ms per 1k nodes (marginal)",
    align: "right",
    cell: (row) => costCell(row, "perKNodesMs"),
  },
  reports: { title: "reports", align: "right", cell: reportsCell },
  expectedBaseHead: { title: "expected → base → head", align: "right", cell: expectedBaseHeadCell },
} satisfies Record<string, Column<Row>>;

type ColumnKey = keyof typeof COLUMNS;

const COMMENT_COLUMNS: readonly ColumnKey[] = [
  "pass",
  "files",
  "ruleTime",
  "ruleDelta",
  "lintTotal",
  "lintDelta",
  "peakRss",
  "rssDelta",
  "reports",
];

const SUMMARY_COLUMNS: readonly ColumnKey[] = [
  "pass",
  "files",
  "ruleTime",
  "ruleDelta",
  "pHolm",
  "lintTotal",
  "lintDelta",
  "threadCpuDelta",
  "peakRss",
  "rssDelta",
  "fixed",
  "marginal",
  "expectedBaseHead",
];

function table(ctx: ReportContext, keys: readonly ColumnKey[]): string {
  return markdownTable(
    keys.map((key) => COLUMNS[key]),
    rows(ctx),
  );
}

function header(ctx: ReportContext): string[] {
  return [
    `### use-baseline benchmark · \`${ctx.baseLabel}\` → \`${ctx.headLabel}\``,
    "",
    `> [!${ctx.verdict.kind}]`,
    ...ctx.verdict.lines.map((line) => `> ${line}`),
    "",
  ];
}

function fmtNoise(noise: number | null): string {
  return noise === null ? "n/a" : `${(noise * 100).toFixed(1)}%`;
}

function perPass(ctx: ReportContext, cell: (pass: PassResult) => string): string {
  return ctx.passes.map((pass) => `${pass.name} ${cell(pass)}`).join(", ");
}

function detailLines(ctx: ReportContext): string[] {
  const { corpus, env, passes } = ctx;
  const scale = corpus.scale === null ? "" : ` · scale ${corpus.scale}`;
  const shards = [...new Set(passes.map((pass) => pass.shards))].join(" + ");
  const iterations = passes.map((pass) => pass.iterations).join(" + ");
  const pairs = passes.map((pass) => comparisonOf(pass).metrics.rule_ms.n).join(" + ");

  const lines = [
    `corpus \`${corpus.id}\`${scale} · ${shards} shards · ${iterations} iterations · ${pairs} pairs`,
    `noise (within-shard SD of ln rule time): ${perPass(ctx, (pass) => fmtNoise(pass.noise))} · order effect ${perPass(ctx, (pass) => fmtPct(Math.exp(comparisonOf(pass).orderEffect)))}`,
  ];

  const oracleTimes = passes.flatMap((pass) =>
    pass.oracle?.ruleTime
      ? [`${pass.name} ${fmtPct(pass.oracle.ruleTime.ratio)} (${fmtCi(pass.oracle.ruleTime)})`]
      : [],
  );

  if (oracleTimes.length > 0) {
    lines.push(`every descriptor (available: ${ORACLE_POLICY}): ${oracleTimes.join(", ")}`);
  }

  const checked = passes.flatMap((pass) => (pass.oracle === null ? [] : [pass.oracle.head]));

  if (checked.length === passes.length && checked.every(sideMatches)) {
    lines.push("Reports match the expected reports.");
  }

  lines.push(
    `${env.platform} · Node ${env.node} · ESLint ${env.eslint} · TypeScript ${env.typescript} · ${env.cpu}`,
  );

  if (ctx.ci !== null && ctx.ci.runId !== null) {
    lines.push(
      `[workflow run](${ctx.ci.serverUrl}/${ctx.ci.repository}/actions/runs/${ctx.ci.runId})`,
    );
  }

  return lines.map((line) => `- ${line}`);
}

export function renderComment(ctx: ReportContext): string {
  return `${[
    ...header(ctx),
    table(ctx, COMMENT_COLUMNS),
    "",
    "<details><summary>Details</summary>",
    "",
    ...detailLines(ctx),
    "",
    "</details>",
  ].join("\n")}\n`;
}

function mismatchLines(ctx: ReportContext): string[] {
  const lines = [];

  for (const { name, oracle } of ctx.passes) {
    if (oracle === null) continue;

    for (const side of ["base", "head"] as const) {
      const result = oracle[side];

      if (result === null || result.mismatches.length === 0) continue;
      const features = byFeature(result.mismatches);
      lines.push(
        "",
        `**Report mismatches, ${side} build, ${name}** (expected ${fmtInt(oracle.expected)}, reported ${fmtInt(result.reports)}):`,
        "",
        ...features.slice(0, MISMATCH_LINES).map((feature) => {
          const counts = [];

          if (feature.missing > 0) counts.push(`${feature.missing} missing`);

          if (feature.extra > 0) counts.push(`${feature.extra} extra`);

          return `- \`${feature.featureId}\`: ${counts.join(", ")} in ${feature.files} file${feature.files === 1 ? "" : "s"}`;
        }),
      );

      if (features.length > MISMATCH_LINES) {
        lines.push(`- … ${features.length - MISMATCH_LINES} more features`);
      }
    }
  }

  return lines;
}

export function renderSummary(ctx: ReportContext): string {
  const caveat = ctx.dependencyCaveat ? ["", DEPENDENCY_CAVEAT] : [];

  return `${[
    ...header(ctx),
    table(ctx, SUMMARY_COLUMNS),
    "",
    ...detailLines(ctx),
    ...caveat,
    ...mismatchLines(ctx),
    "",
    `Δ is the geometric mean of head ÷ base over the (shard, iteration) pairs with a 95% t interval, and p is a sign-flip permutation test adjusted with Holm's method across passes; a pass regresses when its whole interval lies above +${ctx.threshold}% and p < ${SIGNIFICANCE}. Noise is the pooled within-shard standard deviation of ln rule time across iterations, and the order effect is half the difference in mean log ratio between pairs where the head ran first and pairs where the base ran first.`,
  ].join("\n")}\n`;
}
