import assert from "node:assert/strict";
import { test } from "node:test";
import { assess, fixRunMatches, parseDiagnostics } from "./assess.mjs";
import { probeRuleId, productRuleId, reasons, sentinelPrefix } from "./protocol.mjs";

const typed = {
  id: "typed",
  suite: "baseline",
  check: "types",
  code: "element.checkVisibility();",
  expected: [{ featureId: "check-visibility", line: 1, column: 9 }],
};
const missingTypes = {
  check: "types",
  supported: false,
  observed: {
    hasProgram: false,
    hasNodeMap: true,
    hasChecker: false,
    reason: reasons.typedServicesUnavailable,
  },
};
const usableTypes = {
  check: "types",
  supported: true,
  observed: { hasProgram: true, hasNodeMap: true, hasChecker: true },
};

function run(probe, diagnostics = [], exitCode = diagnostics.length ? 1 : 0) {
  const messages = [
    {
      ruleId: probeRuleId,
      message: `${sentinelPrefix}${JSON.stringify(probe)}`,
      line: 1,
      column: 1,
    },
    ...diagnostics,
  ];
  return { exitCode, signal: null, stdout: JSON.stringify([{ filePath: "input.ts", messages }]) };
}

test("a successful exit without a probe cannot become a passing result", () => {
  const result = assess(typed, "bun", { exitCode: 0, stdout: "[]" });
  assert.equal(result.expectationMatched, false);
  assert.equal(result.status, "execution-error");
  const skipped = assess(typed, "bun", {
    exitCode: 0,
    stdout: JSON.stringify([{ filePath: "input.ts", messages: [] }]),
  });
  assert.equal(skipped.status, "unknown");
  assert.equal(skipped.expectationMatched, false);
});

test("known missing type information remains unverified even for a negative fixture", () => {
  const positive = assess(typed, "bun", run(missingTypes));
  assert.equal(positive.status, "unsupported");
  assert.equal(positive.correctness, "not-verified");
  assert.equal(positive.silentCoverageLoss, true);
  assert.equal(positive.expectationMatched, true);
  const negative = assess({ ...typed, expected: [] }, "bun", run(missingTypes));
  assert.equal(negative.status, "unsupported");
  assert.equal(negative.correctness, "not-verified");
  assert.equal(negative.silentCoverageLoss, false);
});

test("a known type gap cannot conceal an unexpected report", () => {
  const result = assess(
    typed,
    "bun",
    run(missingTypes, [
      {
        ruleId: productRuleId,
        message: "Wrong API (array-group).",
        line: 1,
        column: 9,
      },
    ]),
  );
  assert.equal(result.status, "incorrect");
  assert.equal(result.expectationMatched, false);
  assert.equal(result.unexpected.length, 1);
});

test("missing findings on a capable host are coverage loss", () => {
  const result = assess(typed, "eslint", run(usableTypes));
  assert.equal(result.status, "coverage-loss");
  assert.equal(result.expectationMatched, false);
  assert.deepEqual(result.missing, typed.expected);
});

test("non-null but unusable parser services are not an accepted missing-types exception", () => {
  const result = assess(
    typed,
    "bun",
    run({
      check: "types",
      supported: false,
      observed: {
        hasProgram: true,
        hasNodeMap: true,
        hasChecker: false,
        reason: "receiver checker API unavailable",
      },
    }),
  );
  assert.equal(result.expectationMatched, false);
});

test("malformed output and process failures remain failures", () => {
  assert.equal(
    assess(typed, "eslint", { exitCode: 0, stdout: "not json" }).status,
    "execution-error",
  );
  for (const failure of [
    { exitCode: 2 },
    { exitCode: null, signal: "SIGTERM" },
    { exitCode: null, error: "timeout" },
  ]) {
    assert.equal(
      assess(typed, "bun", { ...run(missingTypes), ...failure }).expectationMatched,
      false,
    );
  }
});

test("Oxlint byte offsets normalize to ESLint UTF-16 locations", () => {
  const source = "// 😀\n  marker;";
  const offset = Buffer.byteLength("// 😀\n  ");
  const [message] = parseDiagnostics(
    "oxlint",
    JSON.stringify({
      diagnostics: [
        {
          code: "toolchain-probe(inspect)",
          message: "sentinel",
          labels: [{ span: { offset, length: 6 } }],
        },
      ],
    }),
    source,
  );
  assert.equal(message.ruleId, probeRuleId);
  assert.deepEqual(
    [message.line, message.column, message.endLine, message.endColumn],
    [2, 3, 2, 9],
  );
});

test("a newly supported host is surfaced for expectation review", () => {
  const result = assess(
    typed,
    "bun",
    run(usableTypes, [
      {
        ruleId: productRuleId,
        message: "API is too new (check-visibility).",
        line: 1,
        column: 9,
      },
    ]),
  );
  assert.equal(result.correctness, "matched");
  assert.equal(result.capability, "supported");
  assert.equal(result.expectationMatched, false);
});

test("extra probe diagnostics cannot hide beside a valid sentinel", () => {
  const result = assess(
    typed,
    "bun",
    run(
      missingTypes,
      [
        {
          ruleId: probeRuleId,
          message: "Unrelated probe error",
          severity: 2,
          line: 1,
          column: 1,
        },
      ],
      0,
    ),
  );
  assert.equal(result.expectationMatched, false);
  assert.equal(result.status, "execution-error");
});

test("missing capability booleans are malformed evidence rather than a known gap", () => {
  const result = assess(
    typed,
    "bun",
    run({
      check: "types",
      supported: false,
      observed: { reason: reasons.typedServicesUnavailable },
    }),
  );
  assert.equal(result.expectationMatched, false);
  assert.equal(result.status, "unknown");
});

test("applied fixes still require clean process and diagnostic output", () => {
  const clean = { exitCode: 0, stdout: JSON.stringify([{ messages: [] }]) };
  assert.equal(fixRunMatches("eslint", clean, "2", "2"), true);
  for (const bad of [
    { ...clean, exitCode: 1 },
    { ...clean, signal: "SIGTERM" },
    { ...clean, stdout: "invalid json" },
    {
      ...clean,
      stdout: JSON.stringify([
        { messages: [{ ruleId: "other/rule", message: "Error", severity: 2, line: 1, column: 1 }] },
      ]),
    },
  ])
    assert.equal(fixRunMatches("eslint", bad, "2", "2"), false);
  assert.equal(fixRunMatches("eslint", clean, "1", "2"), false);
});

test("a host probe cannot pass when fix or suggestion behavior is lost", () => {
  const fixture = {
    id: "fixes",
    suite: "host",
    check: "fixes",
    needsTypes: false,
    expected: {},
    expectedFix: {},
    expectedSuggestions: [],
  };
  for (const fixes of [
    { fixMatched: false, suggestionsMatched: true },
    { fixMatched: true, suggestionsMatched: false },
  ]) {
    const result = assess(
      fixture,
      "eslint",
      run({ check: "fixes", supported: true, observed: {} }),
      fixes,
    );
    assert.equal(result.expectationMatched, false);
  }
});
