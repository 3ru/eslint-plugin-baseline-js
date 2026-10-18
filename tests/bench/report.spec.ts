import { describe, expect, it } from "vitest";
import {
  evaluate,
  type ReportContext,
  renderComment,
  renderSummary,
  STALE_SNIPPETS,
} from "../../scripts/bench/report.mts";
import type { PairedEstimate } from "../../scripts/bench/stats.mts";
import type {
  BenchResults,
  EnvironmentInfo,
  OraclePass,
  PassName,
  PassResult,
  ReportMismatch,
  SideSummary,
} from "../../scripts/bench/types.mts";

const THRESHOLD = 10;

function estimate(ratio: number, lo: number, hi: number, p: number, n = 18): PairedEstimate {
  return { n, ratio, lo, hi, p };
}

const flat = estimate(1, 0.99, 1.01, 1);

function side(ruleMs: number): SideSummary {
  return {
    rule_ms: ruleMs,
    lint_ms: 9_900,
    parse_ms: 4_000,
    thread_cpu_ms: 9_000,
    max_rss_kb: 612 * 1024,
    cost: { fixedMs: 0.6, perKNodesMs: 0.015 },
  };
}

function oracle(expected: number, headMismatches: ReportMismatch[] = []): OraclePass {
  const missing = headMismatches.reduce((sum, m) => sum + m.expected - m.actual, 0);

  return {
    expected,
    base: { reports: expected, fatals: 0, mismatches: [] },
    head: { reports: expected - missing, fatals: 0, mismatches: headMismatches },
    ruleTime: estimate(1.31, 1.22, 1.4, 0.01, 6),
  };
}

function pass(
  name: PassName,
  ruleTime: PairedEstimate,
  {
    iterations = 3,
    check = oracle(4_313),
  }: { iterations?: number; check?: OraclePass | null } = {},
): PassResult {
  return {
    corpus: { id: "fe2c5fafe00b5053", scale: 2, sizeMult: 1 },
    name,
    files: name === "untyped" ? 1_984 : 992,
    nodes: 4_000_000,
    warmupFiles: 16,
    shards: 6,
    iterations,
    sides: { base: side(1_380), head: side(1_720) },
    noise: iterations > 1 ? 0.074 : null,
    comparison: {
      metrics: { rule_ms: ruleTime, lint_ms: flat, max_rss_kb: flat, thread_cpu_ms: flat },
      orderEffect: -0.004,
    },
    oracle: check,
    runs: [],
  };
}

const env: EnvironmentInfo = {
  node: "v22.22.2",
  platform: "linux-x64",
  cpu: "AMD EPYC 7763",
  cores: 4,
  eslint: "10.11.0",
  typescriptEslintParser: "8.70.1",
  typescript: "6.0.3",
  date: "2026-10-17T00:00:00.000Z",
};

function context(passes: PassResult[], snippetsStale = false): ReportContext {
  return {
    baseLabel: "a1b2c3d",
    headLabel: "d4e5f6a",
    corpus: { id: "fe2c5fafe00b5053", scale: 2, sizeMult: 1 },
    passes,
    verdict: evaluate(passes, { threshold: THRESHOLD, snippetsStale }),
    threshold: THRESHOLD,
    env,
    dependencyCaveat: false,
    ci: { serverUrl: "https://github.com", repository: "owner/repo", runId: "42" },
  };
}

function judge(passes: PassResult[], snippetsStale = false) {
  return evaluate(passes, { threshold: THRESHOLD, snippetsStale });
}

describe("evaluate", () => {
  it("warns when the whole interval lies beyond the threshold and Holm keeps p small", () => {
    const verdict = judge([
      pass("untyped", estimate(1.247, 1.181, 1.316, 0.001)),
      pass("type-aware", estimate(1.299, 1.21, 1.394, 0.002, 12)),
    ]);

    expect(verdict.kind).toBe("WARNING");
    expect(verdict.lines).toEqual([
      "Rule time regressed: untyped +24.7% (95% CI +18.1% … +31.6%), type-aware +29.9% (+21.0% … +39.4%); threshold 10%.",
    ]);
    expect(verdict.passes.map((entry) => entry.change)).toEqual(["regressed", "regressed"]);
    expect(verdict.headMismatch).toBe(false);
  });

  it("applies Holm's adjustment across passes before calling a regression", () => {
    const verdict = judge([
      pass("untyped", estimate(1.2, 1.12, 1.29, 0.03)),
      pass("type-aware", estimate(1.2, 1.12, 1.29, 0.03)),
    ]);

    expect(verdict.passes.map((entry) => entry.pAdjusted)).toEqual([0.06, 0.06]);
    expect(verdict.passes.map((entry) => entry.change)).toEqual(["slower", "slower"]);
    expect(verdict.kind).toBe("NOTE");
  });

  it("notes a slowdown whose interval stays above zero", () => {
    const verdict = judge([pass("untyped", estimate(1.061, 1.03, 1.093, 0.004))]);
    expect(verdict.kind).toBe("NOTE");
    expect(verdict.lines[0]).toBe("Slower: untyped +6.1% (+3.0% … +9.3%).");
  });

  it("gives a tip when the head is faster", () => {
    const verdict = judge([pass("untyped", estimate(0.877, 0.849, 0.906, 0.001))]);
    expect(verdict.kind).toBe("TIP");
    expect(verdict.lines[0]).toBe("Faster: untyped −12.3% (−15.1% … −9.4%).");
  });

  it("calls an interval wider than the threshold inconclusive", () => {
    const verdict = judge([pass("untyped", estimate(1.02, 0.918, 1.124, 0.6))]);
    expect(verdict.kind).toBe("NOTE");
    expect(verdict.lines[0]).toBe(
      "Inconclusive: the 95% interval (untyped −8.2% … +12.4%) is wider than the 10% threshold.",
    );
  });

  it("states the interval when nothing changed", () => {
    const verdict = judge([pass("untyped", estimate(1.006, 0.979, 1.034, 0.7))]);
    expect(verdict.kind).toBe("NOTE");
    expect(verdict.lines[0]).toBe("No change in rule time beyond untyped −2.1% … +3.4%.");
  });

  it("judges one iteration from its shard pairs", () => {
    const verdict = judge([pass("untyped", estimate(1.012, 0.9, 1.1, 0.5, 6), { iterations: 1 })]);
    expect(verdict.kind).toBe("NOTE");
    expect(verdict.passes[0]?.change).toBe("inconclusive");
  });

  it("gives no verdict for a single pair", () => {
    const single = estimate(1.012, Number.NaN, Number.NaN, Number.NaN, 1);
    const verdict = judge([pass("untyped", single, { iterations: 1 })]);
    expect(verdict.kind).toBe("NOTE");
    expect(verdict.passes[0]?.change).toBe("unknown");
    expect(verdict.lines[0]).toBe("One pair: no interval; rule time untyped +1.2%.");
  });

  it("lets the worst pass decide", () => {
    const verdict = judge([
      pass("untyped", estimate(0.877, 0.849, 0.906, 0.001)),
      pass("type-aware", estimate(1.061, 1.03, 1.093, 0.004, 12)),
    ]);

    expect(verdict.kind).toBe("NOTE");
    expect(verdict.lines[0]).toBe("Slower: type-aware +6.1% (+3.0% … +9.3%).");
  });

  it("cautions about a head report mismatch, grouped by feature", () => {
    const mismatches = ["a.js", "b.js", "c.js"].map((file) => ({
      file,
      featureId: "url-parse",
      expected: 1,
      actual: 0,
    }));

    const verdict = judge([
      pass("untyped", estimate(1.006, 0.979, 1.034, 0.7), { check: oracle(4_313, mismatches) }),
    ]);

    expect(verdict.kind).toBe("CAUTION");
    expect(verdict.headMismatch).toBe(true);
    expect(verdict.lines).toEqual([
      "Reports differ from the expected reports: untyped 4,310 of 4,313 (url-parse −3).",
      "No change in rule time beyond untyped −2.1% … +3.4%.",
    ]);
  });

  it("cautions about snippets verified against other plugin data without failing the run", () => {
    const verdict = judge([pass("untyped", estimate(1.006, 0.979, 1.034, 0.7))], true);
    expect(verdict.kind).toBe("CAUTION");
    expect(verdict.headMismatch).toBe(false);
    expect(verdict.lines[0]).toBe(STALE_SNIPPETS);
  });
});

describe("renderComment", () => {
  const regressed = [
    pass("untyped", estimate(1.247, 1.181, 1.316, 0.001)),
    pass("type-aware", estimate(1.05, 0.98, 1.12, 0.2, 12)),
  ];

  it("leads with the title and the alert, then one table row per pass", () => {
    const lines = renderComment(context(regressed)).split("\n");
    expect(lines.slice(0, 5)).toEqual([
      "### use-baseline benchmark · `a1b2c3d` → `d4e5f6a`",
      "",
      "> [!WARNING]",
      "> Rule time regressed: untyped +24.7% (95% CI +18.1% … +31.6%); threshold 10%.",
      "",
    ]);
    expect(lines[5]).toBe(
      "| pass | files | rule time | Δ (95% CI) | lint total | Δ | peak RSS | Δ | reports |",
    );
    expect(lines[6]).toBe("|---|---:|---:|---:|---:|---:|---:|---:|---:|");
    expect(lines[7]).toBe(
      "| untyped | 1,984 | 1.72 s | **+24.7%** (+18.1% … +31.6%) | 9.90 s | 0.0% | 612 MB | 0.0% | 4,313 ✅ |",
    );
    // Only a regressed pass is bold.
    expect(lines[8]).toContain("| +5.0% (−2.0% … +12.0%) |");
  });

  it("folds the details and links the workflow run and the docs on main", () => {
    const comment = renderComment(context(regressed));
    expect(comment).toContain("<details><summary>Details</summary>");
    expect(comment).toContain(
      "- corpus `fe2c5fafe00b5053` · scale 2 · 6 shards · 3 + 3 iterations · 18 + 12 pairs",
    );
    expect(comment).toContain(
      "- noise (within-shard SD of ln rule time): untyped 7.4%, type-aware 7.4% · order effect untyped −0.4%, type-aware −0.4%",
    );
    expect(comment).toContain(
      "- every descriptor (available: 1900): untyped +31.0% (+22.0% … +40.0%), type-aware +31.0% (+22.0% … +40.0%)",
    );
    expect(comment).toContain("- [workflow run](https://github.com/owner/repo/actions/runs/42)");
    expect(comment).toContain("- Reports match the expected reports.");
    expect(comment.endsWith("</details>\n")).toBe(true);
  });

  it("marks a single-pair pass instead of printing an interval", () => {
    const single = estimate(1.012, Number.NaN, Number.NaN, Number.NaN, 1);
    const comment = renderComment(context([pass("untyped", single, { iterations: 1 })]));
    expect(comment).toContain("| +1.2% (one pair) |");
    expect(comment).toContain("noise (within-shard SD of ln rule time): untyped n/a");
  });

  it("shows ❌ when the head build's reports differ", () => {
    const mismatch = [{ file: "a.js", featureId: "url-parse", expected: 1, actual: 0 }];

    const comment = renderComment(
      context([pass("untyped", estimate(1, 0.98, 1.02, 0.9), { check: oracle(10, mismatch) })]),
    );

    expect(comment).toContain("> [!CAUTION]");
    expect(comment).toContain("| 9 ❌ |");
  });
});

describe("renderSummary", () => {
  it("adds costs, thread CPU, report counts, mismatches, the caveat and the footnote", () => {
    const mismatches = [
      { file: "a.js", featureId: "url-parse", expected: 2, actual: 0 },
      { file: "b.js", featureId: "url-parse", expected: 1, actual: 0 },
      { file: "b.js", featureId: "resize-observer", expected: 0, actual: 1 },
    ];

    const ctx = {
      ...context([
        pass("untyped", estimate(1.061, 1.03, 1.093, 0.004), { check: oracle(4_313, mismatches) }),
      ]),
      dependencyCaveat: true,
    };

    const summary = renderSummary(ctx);
    const lines = summary.split("\n");
    expect(lines.slice(0, 3)).toEqual([
      "### use-baseline benchmark · `a1b2c3d` → `d4e5f6a`",
      "",
      "> [!CAUTION]",
    ]);
    const header = lines.find((line) => line.startsWith("| pass |"));
    expect(header).toBe(
      "| pass | files | rule time | Δ (95% CI) | p (Holm) | lint total | Δ | thread CPU Δ | peak RSS | Δ | ms per file (fixed) | ms per 1k nodes (marginal) | expected → base → head |",
    );
    expect(summary).toContain(
      "| untyped | 1,984 | 1.72 s | +6.1% (+3.0% … +9.3%) | p = 0.0040 | 9.90 s | 0.0% | 0.0% | 612 MB | 0.0% | 0.60 ms → 0.60 ms | 0.015 ms → 0.015 ms | 4,313 → 4,313 → 4,311 ❌ |",
    );
    expect(summary).toContain(
      "Dependencies differ between base and head; both builds ran with head's installed packages.",
    );
    expect(summary).toContain(
      "**Report mismatches, head build, untyped** (expected 4,313, reported 4,311):",
    );
    expect(summary).toContain("- `url-parse`: 3 missing in 2 files");
    expect(summary).toContain("- `resize-observer`: 1 extra in 1 file");
    expect(summary).toContain("whole interval lies above +10% and p < 0.05");
  });
});

describe("results JSON", () => {
  it("survives a JSON round trip unchanged", () => {
    const passes = [pass("untyped", estimate(1.061, 1.03, 1.093, 0.004))];

    const results: BenchResults = {
      tool: "bench:compare",
      version: 1,
      env,
      options: { scale: 2, base: "origin/main", oracle: true },
      builds: {
        base: { ref: "origin/main", sha: "a".repeat(40), label: "aaaaaaa", dirty: false },
        head: { ref: ".", sha: "b".repeat(40), label: "bbbbbbb", dirty: true },
      },
      passes,
      verdict: judge(passes),
    };

    expect(JSON.parse(JSON.stringify(results))).toEqual(results);
  });
});
