import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyEdits,
  assess,
  fixRunProblem,
  parseDiagnostics,
  suggestionPayloadProblem,
} from "./assess.mjs";
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

function sentinel(probe, position = { line: 1, column: 1 }) {
  return { ruleId: probeRuleId, message: `${sentinelPrefix}${JSON.stringify(probe)}`, ...position };
}

function run(probe, diagnostics = [], exitCode = diagnostics.length ? 1 : 0, position) {
  const messages = [sentinel(probe, position), ...diagnostics];
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
      { ruleId: productRuleId, message: "Wrong API (array-group).", line: 1, column: 9 },
    ]),
  );
  assert.equal(result.status, "incorrect");
  assert.equal(result.expectationMatched, false);
  assert.equal(result.unexpected.length, 1);
  assert.equal(result.reason, "Unexpected array-group at 1:9");
});

test("missing findings on a capable host are coverage loss", () => {
  const result = assess(typed, "eslint", run(usableTypes));
  assert.equal(result.status, "coverage-loss");
  assert.equal(result.expectationMatched, false);
  assert.deepEqual(result.missing, typed.expected);
  assert.equal(result.reason, "Missing check-visibility at 1:9");
});

test("a host expected to have type services cannot claim the documented gap", () => {
  const hostCase = { ...typed, id: "receiver", suite: "host", expected: usableTypes.observed };
  const result = assess(hostCase, "eslint", run(missingTypes));
  assert.equal(result.status, "unsupported");
  assert.equal(result.expectationMatched, false);
  assert.equal(result.reason, reasons.typedServicesUnavailable);
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
  assert.equal(result.reason, "receiver checker API unavailable; Missing check-visibility at 1:9");
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

test("a file the host could not parse keeps the parser's message", () => {
  const eslintShaped = assess(typed, "eslint", {
    exitCode: 1,
    stdout: JSON.stringify([
      {
        filePath: "input.ts",
        messages: [
          {
            ruleId: null,
            fatal: true,
            severity: 2,
            message: "Parsing error: Unexpected token",
            line: 1,
            column: 1,
          },
        ],
      },
    ]),
  });
  assert.equal(eslintShaped.status, "execution-error");
  assert.equal(eslintShaped.reason, "Parsing error: Unexpected token");
  const oxlintShaped = assess(typed, "oxlint", {
    exitCode: 1,
    stdout: JSON.stringify({
      diagnostics: [
        {
          message: "Expected a semicolon or an implicit semicolon after a statement",
          severity: "error",
          labels: [{ span: { offset: 0, length: 1 } }],
        },
      ],
    }),
  });
  assert.equal(oxlintShaped.status, "execution-error");
  assert.match(oxlintShaped.reason, /^Expected a semicolon/u);
});

test("a sentinel without a check reports undelivered rule options", () => {
  const result = assess(typed, "oxlint", {
    exitCode: 0,
    stdout: JSON.stringify({
      diagnostics: [
        {
          code: "toolchain-probe(inspect)",
          message: `${sentinelPrefix}${JSON.stringify({
            supported: false,
            observed: { reason: reasons.optionsNotDelivered },
          })}`,
          labels: [{ span: { offset: 0, length: 1 } }],
        },
      ],
    }),
  });
  assert.equal(result.status, "unknown");
  assert.equal(result.reason, reasons.optionsNotDelivered);
});

test("Oxlint byte offsets normalize to ESLint UTF-16 locations", () => {
  const source = '  "\u{1F600}" + marker;';
  const offset = Buffer.byteLength('  "\u{1F600}" + ');
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
  assert.equal(message.ruleId, "toolchain-probe/inspect");
  assert.deepEqual(
    [message.line, message.column, message.endLine, message.endColumn],
    [1, 10, 1, 16],
  );
});

test("a byte order mark and every line terminator count as ESLint counts them", () => {
  const source = "\u{FEFF}a;\r  marker;\u{2028}x;\r\ny;";
  const positions = ["marker", "x", "y"].map((name) => {
    const offset = Buffer.byteLength(source.slice(0, source.indexOf(name)));
    const [message] = parseDiagnostics(
      "oxlint",
      JSON.stringify({
        diagnostics: [
          {
            code: "toolchain-probe(inspect)",
            message: "sentinel",
            labels: [{ span: { offset, length: name.length } }],
          },
        ],
      }),
      source,
    );
    return [message.line, message.column];
  });
  assert.deepEqual(positions, [
    [2, 3],
    [3, 1],
    [4, 1],
  ]);
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
  assert.equal(result.reason, "Host now provides type services; review the expectation");
});

test("extra probe diagnostics cannot hide beside a valid sentinel", () => {
  const result = assess(
    typed,
    "bun",
    run(
      missingTypes,
      [{ ruleId: probeRuleId, message: "Unrelated probe error", severity: 2, line: 1, column: 1 }],
      0,
    ),
  );
  assert.equal(result.expectationMatched, false);
  assert.equal(result.status, "execution-error");
  assert.equal(result.reason, "Unexpected rule toolchain-probe/inspect");
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

test("a location sentinel reported at the wrong column is a mismatch", () => {
  const expected = { line: 2, column: 3, endLine: 2, endColumn: 9 };
  const location = { id: "location", suite: "host", check: "location", code: "", expected };
  const probe = { check: "location", supported: true, observed: expected };
  assert.equal(assess(location, "eslint", run(probe, [], 0, expected)).expectationMatched, true);
  const shifted = assess(location, "eslint", run(probe, [], 0, { ...expected, column: 4 }));
  assert.equal(shifted.expectationMatched, false);
  assert.equal(shifted.reason, "Mismatch in position");
});

test("applied fixes still require clean process and diagnostic output", () => {
  const clean = { exitCode: 0, stdout: JSON.stringify([{ messages: [] }]) };
  assert.equal(fixRunProblem("eslint", clean, "2", "2"), undefined);
  const problems = [
    [{ ...clean, exitCode: 1 }, "Process exited 1 (no signal)"],
    [
      { ...clean, signal: "SIGTERM", stderr: "error: killed" },
      "Process exited 0 (SIGTERM): error: killed",
    ],
    [{ ...clean, stdout: "invalid json" }, /^Unexpected token/u],
    [
      {
        ...clean,
        stdout: JSON.stringify([
          {
            messages: [{ ruleId: "other/rule", message: "Error", severity: 2, line: 1, column: 1 }],
          },
        ]),
      },
      "Unexpected probe diagnostic",
    ],
  ];
  for (const [bad, expected] of problems) {
    const problem = fixRunProblem("eslint", bad, "2", "2");
    if (expected instanceof RegExp) assert.match(problem, expected);
    else assert.equal(problem, expected);
  }
  assert.equal(fixRunProblem("eslint", clean, "1", "2"), "file differs from the expected edit");
});

test("edits apply from the end, and suggestion payloads compare description and edit", () => {
  const edits = [
    { range: [0, 1], text: "X" },
    { range: [4, 6], text: "YZ" },
  ];
  assert.equal(applyEdits("abcdef", edits), "XbcdYZ");
  const fixes = {
    id: "fixes",
    suite: "host",
    check: "fixes",
    code: "const answer = 1;\n",
    expectedSuggestions: [{ desc: "Replace one with three", fix: { range: [15, 16], text: "3" } }],
  };
  const payload = (desc) => ({
    exitCode: 0,
    stdout: JSON.stringify([
      {
        messages: [
          {
            ...sentinel({ check: "fixes", supported: true, observed: {} }),
            suggestions: [{ desc, fix: { range: [15, 16], text: "3" } }],
          },
        ],
      },
    ]),
  });
  assert.equal(
    suggestionPayloadProblem("bun", payload("Replace one with three"), fixes),
    undefined,
  );
  assert.match(
    suggestionPayloadProblem("bun", payload("Replace one"), fixes),
    /^suggestion payload was/u,
  );
  assert.match(
    suggestionPayloadProblem("bun", { exitCode: 0, stdout: "[]" }, fixes),
    /^Expected exactly one/u,
  );
});

test("a host probe cannot pass when fix or suggestion behavior is lost", () => {
  const fixture = {
    id: "fixes",
    suite: "host",
    check: "fixes",
    code: "",
    expected: {},
    expectedFix: {},
    expectedSuggestions: [],
  };
  const probe = { check: "fixes", supported: true, observed: {} };
  for (const [fixes, reason] of [
    [{ fixMatched: false, suggestionsMatched: true }, "Mismatch in fix"],
    [{ fixMatched: true, suggestionsMatched: false }, "Mismatch in suggestions"],
  ]) {
    const result = assess(fixture, "eslint", run(probe), fixes);
    assert.equal(result.expectationMatched, false);
    assert.equal(result.reason, reason);
  }
});
