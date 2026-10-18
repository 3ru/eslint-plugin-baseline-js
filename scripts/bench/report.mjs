/**
 * Markdown renderers for a comparison: a compact pull-request comment (verdict, one
 * small table, details folded away) and a fuller job summary.
 */
import { fmtDelta, fmtInt, fmtMb, fmtMs, fmtMsFine, fmtP } from "./lib.mjs";

/** Judge every pass and pick the one-line verdict for the whole run. */
export function evaluate(passes, results, oracle, { threshold }) {
  const rows = passes.map((pass) => {
    const r = results[pass.name];
    const o = oracle[pass.name] ?? null;
    const significant = r.p < 0.05;
    const slower = significant && r.pairedRatio > 1 + threshold / 100;
    const faster = significant && r.pairedRatio < 1 - threshold / 100;
    const headOk = o ? o.head.reports === o.expected && o.head.fatals === 0 : true;
    const baseOk = o ? o.base.reports === o.expected : true;
    return { pass, r, o, slower, faster, headOk, baseOk };
  });
  const mismatched = rows.filter((x) => !x.headOk);
  const slower = rows.filter((x) => x.slower).sort((a, b) => b.r.pairedRatio - a.r.pairedRatio);
  const faster = rows.filter((x) => x.faster).sort((a, b) => a.r.pairedRatio - b.r.pairedRatio);
  let verdict;
  if (mismatched.length) {
    verdict = {
      kind: "CAUTION",
      text: `Detections differ from the generator: ${mismatched
        .map(
          (x) =>
            `${x.pass.name} expected ${fmtInt(x.o.expected)}, head reported ${fmtInt(x.o.head.reports)}${x.o.head.fatals ? ` with ${x.o.head.fatals} parse errors` : ""}`,
        )
        .join("; ")}.`,
    };
  } else if (slower.length) {
    const [w] = slower;
    verdict = {
      kind: "WARNING",
      text: `use-baseline is slower: ${w.pass.name} ${fmtDelta(w.r.base.rule_ms, w.r.head.rule_ms)} (${w.r.losses}/${w.r.pairs} pairs slower, ${fmtP(w.r.p)}).`,
    };
  } else if (faster.length) {
    const [b] = faster;
    verdict = {
      kind: "TIP",
      text: `use-baseline is faster: ${b.pass.name} ${fmtDelta(b.r.base.rule_ms, b.r.head.rule_ms)} (${b.r.wins}/${b.r.pairs} pairs faster, ${fmtP(b.r.p)}).`,
    };
  } else {
    verdict = {
      kind: "NOTE",
      text: "No measurable change in use-baseline time. Detections match the generator.",
    };
  }
  return { rows, verdict, mismatched: mismatched.length, regressions: slower.length };
}

function reportsCell({ o, headOk, baseOk }) {
  if (!o) return "n/a";
  if (!headOk) return `❌ ${fmtInt(o.head.reports)} of ${fmtInt(o.expected)}`;
  return baseOk
    ? `✅ ${fmtInt(o.expected)}`
    : `✅ ${fmtInt(o.expected)} (base ${fmtInt(o.base.reports)})`;
}

function passLabel(pass) {
  return pass.typed ? "typed" : "untyped";
}

function ciLinks() {
  const {
    GITHUB_SERVER_URL: server,
    GITHUB_REPOSITORY: repo,
    GITHUB_RUN_ID: runId,
    GITHUB_SHA: sha,
  } = process.env;
  if (!server || !repo) return {};
  return {
    run: runId ? `${server}/${repo}/actions/runs/${runId}` : undefined,
    docs: `${server}/${repo}/blob/${sha ?? "main"}/docs/BENCHMARKS.md`,
  };
}

function detailLines({ corpus, args, env, evaluation }) {
  const t = corpus.manifest.totals;
  const links = ciLinks();
  const confidence = evaluation.rows
    .map(
      ({ pass, r }) =>
        `${passLabel(pass)} ${r.losses}/${r.pairs} pairs slower (${fmtP(r.p)}), noise ±${(r.noise * 100).toFixed(0)}%`,
    )
    .join("; ");
  const lines = [
    `- Corpus \`${corpus.id.slice(0, 8)}\` · scale ${args.scale} · ${fmtInt(t.files)} files (${Object.entries(
      t.byLang,
    )
      .map(([l, n]) => `${l} ${fmtInt(n)}`)
      .join(
        ", ",
      )}) · ${fmtInt(t.nodes)} AST nodes · ${args.shards} shards · untyped ×${args.iterations}${args.typedIterations ? `, typed ×${args.typedIterations}` : ""}`,
    `- Confidence: ${confidence}`,
    `- Node ${env.node} · ESLint ${env.eslint} · TypeScript ${env.typescript} · ${env.platform} · ${env.cpu}`,
  ];
  const refs = [
    links.run && `[Workflow run](${links.run})`,
    links.docs && `[How to read this](${links.docs})`,
  ].filter(Boolean);
  if (refs.length) lines.push(`- ${refs.join(" · ")}`);
  return lines;
}

function header(ctx) {
  return [
    `### use-baseline benchmark · \`${ctx.baseLabel}\` → \`${ctx.headLabel}\``,
    "",
    `> [!${ctx.evaluation.verdict.kind}]`,
    `> ${ctx.evaluation.verdict.text}`,
    "",
  ];
}

/** The pull-request comment: verdict, a table that fits on one screen, details folded. */
export function renderComment(ctx) {
  const lines = header(ctx);
  lines.push(
    "| pass | files | use-baseline | Δ | lint total | Δ | max RSS | reports |",
    "|---|---:|---:|---:|---:|---:|---:|:---:|",
  );
  for (const row of ctx.evaluation.rows) {
    const { pass, r } = row;
    lines.push(
      `| ${passLabel(pass)} | ${fmtInt(r.files)} | ${fmtMs(r.base.rule_ms)} → ${fmtMs(r.head.rule_ms)} | ${fmtDelta(r.base.rule_ms, r.head.rule_ms)}${row.slower ? " ⚠️" : ""} | ${fmtMs(r.base.lint_ms)} → ${fmtMs(r.head.lint_ms)} | ${fmtDelta(r.base.lint_ms, r.head.lint_ms)} | ${fmtMb(r.head.max_rss_kb)} | ${reportsCell(row)} |`,
    );
  }
  lines.push(
    "",
    "<details>",
    "<summary>Details</summary>",
    "",
    ...detailLines(ctx),
    "",
    "</details>",
  );
  return `${lines.join("\n")}\n`;
}

/** The job summary: everything the comment has plus per-file costs, noise and mismatches. */
export function renderSummary(ctx) {
  const lines = header(ctx);
  lines.push(
    "| pass | files | use-baseline | Δ | lint total | Δ | ms/file | ms per 1k nodes | max RSS | Δ | reports expected → base → head | noise | pairs |",
    "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|:---:|---:|---:|",
  );
  for (const row of ctx.evaluation.rows) {
    const { pass, r, o } = row;
    const reports = o
      ? `${fmtInt(o.expected)} → ${fmtInt(o.base.reports)}${row.baseOk ? "" : " ⚠️"} → ${fmtInt(o.head.reports)}${row.headOk ? " ✅" : " ❌"}`
      : "n/a";
    lines.push(
      `| ${passLabel(pass)} | ${fmtInt(r.files)} | ${fmtMs(r.base.rule_ms)} → ${fmtMs(r.head.rule_ms)} | ${fmtDelta(r.base.rule_ms, r.head.rule_ms)}${row.slower ? " ⚠️" : ""} | ${fmtMs(r.base.lint_ms)} → ${fmtMs(r.head.lint_ms)} | ${fmtDelta(r.base.lint_ms, r.head.lint_ms)} | ${fmtMsFine(r.perFile.base)} → ${fmtMsFine(r.perFile.head)} | ${r.perKNodes ? `${fmtMsFine(r.perKNodes.base)} → ${fmtMsFine(r.perKNodes.head)}` : "n/a"} | ${fmtMb(r.base.max_rss_kb)} → ${fmtMb(r.head.max_rss_kb)} | ${fmtDelta(r.base.max_rss_kb, r.head.max_rss_kb)} | ${reports} | ±${(r.noise * 100).toFixed(0)}% | ${r.losses}/${r.pairs} slower, ${fmtP(r.p)} |`,
    );
  }
  lines.push("", ...detailLines(ctx));
  for (const { pass, o } of ctx.evaluation.rows) {
    if (!o) continue;
    for (const side of ["base", "head"]) {
      if (o[side].mismatches.length) {
        lines.push(
          "",
          `${side} ${passLabel(pass)} mismatches (first ${o[side].mismatches.length}):`,
        );
        for (const m of o[side].mismatches)
          lines.push(`- \`${m.file}\`: expected ${m.expected}, got ${m.actual}`);
      }
    }
  }
  lines.push(
    "",
    `_use-baseline_ is the rule's own time from ESLint's \`stats\`; _lint total_ is wall-clock around \`lintFiles()\`. Δ compares medians; ⚠️ marks a slowdown above ${ctx.args.threshold}% with p < 0.05 over the paired shard runs. Reports are counted under a policy that reports every detection and must equal the number the generator injected.`,
  );
  return `${lines.join("\n")}\n`;
}
