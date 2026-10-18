import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyEdit,
  assess,
  fixRunProblem,
  parseDiagnostics,
  suggestionPayloadProblem,
} from "./assess.ts";
import { probeRuleId, productRuleId, reasons, sentinelPrefix } from "./protocol.mjs";
import type {
  BaselineCase,
  Diagnostic,
  Edit,
  Fixes,
  HostCase,
  HostFacts,
  Observations,
  ProbeMessage,
  RunOutcome,
} from "./types.ts";

// Hosts as the assessment sees them. Each test names only the facet it depends on, so a change
// to what hosts.ts says about a real host cannot move these tests.
const eslintHost: HostFacts = { format: "eslint", typeServices: true };
const untypedHost: HostFacts = { format: "eslint", typeServices: false };
const oxlintHost: HostFacts = { format: "oxlint", typeServices: false };

const typed: BaselineCase = {
  id: "typed",
  suite: "baseline",
  check: "types",
  member: "checkVisibility",
  code: "element.checkVisibility();",
  extension: "ts",
  expected: [{ featureId: "check-visibility", line: 1, column: 9 }],
};
const finding: Diagnostic = {
  ruleId: productRuleId,
  message: "API (check-visibility).",
  line: 1,
  column: 9,
};
const missingTypes: ProbeMessage = {
  check: "types",
  supported: false,
  observed: {
    hasProgram: false,
    hasNodeMap: true,
    hasChecker: false,
    reason: reasons.typedServicesUnavailable,
  },
};
const receiverObserved: Observations["types"] = {
  hasProgram: true,
  hasNodeMap: true,
  hasChecker: true,
  receiverType: "Element",
  property: "checkVisibility",
  hasProperty: true,
  defaultLibrary: true,
};
const usableTypes: ProbeMessage = { check: "types", supported: true, observed: receiverObserved };

type Position = Pick<Diagnostic, "line" | "column" | "endLine" | "endColumn">;

const outcome = (
  run: Pick<RunOutcome, "exitCode" | "stdout"> & Partial<RunOutcome>,
): RunOutcome => ({
  signal: null,
  stderr: "",
  ...run,
});

// A probe diagnostic; a string stands for a deliberately malformed message body.
function sentinel(
  probe: ProbeMessage | string,
  position: Position = { line: 1, column: 1 },
): Diagnostic {
  const body = typeof probe === "string" ? probe : JSON.stringify(probe);
  return { ruleId: probeRuleId, message: `${sentinelPrefix}${body}`, ...position };
}

const eslintOutput = (messages: unknown[]): string =>
  JSON.stringify([{ filePath: "input.ts", messages }]);

function run(
  probe: ProbeMessage | string,
  diagnostics: Diagnostic[] = [],
  exitCode = diagnostics.length ? 1 : 0,
  position?: Position,
): RunOutcome {
  return outcome({ exitCode, stdout: eslintOutput([sentinel(probe, position), ...diagnostics]) });
}

const oxlintOutput = (diagnostics: unknown[]): string => JSON.stringify({ diagnostics });

test("a successful exit without a probe cannot become a passing result", () => {
  const result = assess(typed, untypedHost, outcome({ exitCode: 0, stdout: "[]" }));
  assert.equal(result.expectationMatched, false);
  assert.equal(result.status, "execution-error");
  const skipped = assess(typed, untypedHost, outcome({ exitCode: 0, stdout: eslintOutput([]) }));
  assert.equal(skipped.status, "unknown");
  assert.equal(skipped.reason, "Expected one probe sentinel; received 0");
  assert.equal(skipped.expectationMatched, false);
});

test("known missing type information remains unverified even for a negative fixture", () => {
  const positive = assess(typed, untypedHost, run(missingTypes));
  assert.equal(positive.status, "unsupported");
  assert.equal(positive.correctness, "not-verified");
  assert.equal(positive.silentCoverageLoss, true);
  assert.equal(positive.expectationMatched, true);
  const negative = assess({ ...typed, expected: [] }, untypedHost, run(missingTypes));
  assert.equal(negative.status, "unsupported");
  assert.equal(negative.correctness, "not-verified");
  assert.equal(negative.silentCoverageLoss, false);
});

test("a known type gap cannot conceal an unexpected report", () => {
  const wrong: Diagnostic = { ...finding, message: "Wrong API (array-group)." };
  const result = assess(typed, untypedHost, run(missingTypes, [wrong]));
  assert.equal(result.status, "incorrect");
  assert.equal(result.expectationMatched, false);
  assert.equal(result.unexpected?.length, 1);
  assert.equal(result.reason, "Unexpected array-group at 1:9");
});

test("missing findings on a capable host are coverage loss", () => {
  const result = assess(typed, eslintHost, run(usableTypes));
  assert.equal(result.status, "coverage-loss");
  assert.equal(result.expectationMatched, false);
  assert.deepEqual(result.missing, typed.expected);
  assert.equal(result.reason, "Missing check-visibility at 1:9");
});

test("a host expected to have type services cannot claim the documented gap", () => {
  const receiver: HostCase = {
    id: "receiver",
    suite: "host",
    check: "types",
    member: "checkVisibility",
    code: typed.code,
    extension: "ts",
    expected: receiverObserved,
  };
  const result = assess(receiver, eslintHost, run(missingTypes));
  assert.equal(result.status, "unsupported");
  assert.equal(result.expectationMatched, false);
  assert.equal(result.reason, reasons.typedServicesUnavailable);
});

test("unusable parser services with another reason are not the documented gap", () => {
  const stub: ProbeMessage = {
    check: "types",
    supported: false,
    observed: {
      hasProgram: true,
      hasNodeMap: true,
      hasChecker: false,
      reason: "receiver checker API unavailable",
    },
  };
  const result = assess(typed, untypedHost, run(stub));
  assert.equal(result.expectationMatched, false);
  assert.equal(result.reason, "receiver checker API unavailable; Missing check-visibility at 1:9");
});

test("the documented gap needs the recorded booleans to agree with its reason", () => {
  const contradictory: ProbeMessage = {
    check: "types",
    supported: false,
    observed: {
      hasProgram: true,
      hasNodeMap: true,
      hasChecker: false,
      reason: reasons.typedServicesUnavailable,
    },
  };
  const result = assess(typed, untypedHost, run(contradictory));
  assert.equal(result.status, "unsupported");
  assert.equal(result.correctness, "missing");
  assert.equal(result.expectationMatched, false);
});

test("malformed output and process failures remain failures", () => {
  const garbage = assess(typed, eslintHost, outcome({ exitCode: 0, stdout: "not json" }));
  assert.equal(garbage.status, "execution-error");
  const failures: Partial<RunOutcome>[] = [
    { exitCode: 2 },
    { exitCode: null, signal: "SIGTERM" },
    { exitCode: null, error: "timeout" },
  ];
  for (const failure of failures) {
    const result = assess(typed, untypedHost, { ...run(missingTypes), ...failure });
    assert.equal(result.status, "execution-error");
    assert.equal(result.expectationMatched, false);
  }
});

test("a file the host could not parse keeps the parser's message", () => {
  const fatal: Diagnostic = {
    ruleId: null,
    fatal: true,
    severity: 2,
    message: "Parsing error: Unexpected token",
    line: 1,
    column: 1,
  };
  const eslintShaped = assess(
    typed,
    eslintHost,
    outcome({ exitCode: 1, stdout: eslintOutput([fatal]) }),
  );
  assert.equal(eslintShaped.status, "execution-error");
  assert.equal(eslintShaped.reason, "Parsing error: Unexpected token");
  const oxlintShaped = assess(
    typed,
    oxlintHost,
    outcome({
      exitCode: 1,
      stdout: oxlintOutput([
        {
          message: "Expected a semicolon or an implicit semicolon after a statement",
          severity: "error",
          labels: [{ span: { offset: 0, length: 1 } }],
        },
      ]),
    }),
  );
  assert.equal(oxlintShaped.status, "execution-error");
  assert.equal(
    oxlintShaped.reason,
    "Expected a semicolon or an implicit semicolon after a statement",
  );
  const crashed = assess(
    typed,
    oxlintHost,
    outcome({
      exitCode: 1,
      stdout: oxlintOutput([
        { message: "Failed to load plugin: probe threw", severity: "error", labels: [] },
      ]),
    }),
  );
  assert.equal(crashed.status, "execution-error");
  assert.equal(crashed.reason, "Failed to load plugin: probe threw");
  const spanless = assess(
    typed,
    oxlintHost,
    outcome({
      exitCode: 1,
      stdout: oxlintOutput([{ code: "toolchain-probe(inspect)", message: "sentinel", labels: [] }]),
    }),
  );
  assert.equal(spanless.reason, "Missing Oxlint diagnostic span");
});

test("a diagnostic whose field has the wrong type is malformed, not trusted", () => {
  const parsed = parseDiagnostics("eslint", eslintOutput([{ message: "x", line: "1" }]), "");
  assert.deepEqual(parsed, { ok: false, problem: "Malformed diagnostic message" });
  const severity = parseDiagnostics(
    "oxlint",
    oxlintOutput([{ message: "x", severity: 2, labels: [{ span: { offset: 0, length: 1 } }] }]),
    "x",
  );
  assert.equal(severity.ok, true);
});

test("a sentinel without a check reports why", () => {
  const undelivered = assess(
    typed,
    oxlintHost,
    outcome({
      exitCode: 0,
      stdout: oxlintOutput([
        {
          code: "toolchain-probe(inspect)",
          message: `${sentinelPrefix}${JSON.stringify({
            supported: false,
            observed: { reason: reasons.optionsNotDelivered },
          })}`,
          labels: [{ span: { offset: 0, length: 1 } }],
        },
      ]),
    }),
  );
  assert.equal(undelivered.status, "unknown");
  assert.equal(undelivered.reason, reasons.optionsNotDelivered);
  const unknownCheck = assess(
    typed,
    eslintHost,
    run('{"supported":false,"observed":{"reason":"unknown probe check nope"}}'),
  );
  assert.equal(unknownCheck.status, "unknown");
  assert.equal(unknownCheck.reason, "unknown probe check nope");
});

test("Oxlint byte offsets normalize to ESLint UTF-16 locations", () => {
  const source = '  "\u{1F600}" + marker;';
  const offset = Buffer.byteLength('  "\u{1F600}" + ');
  const parsed = parseDiagnostics(
    "oxlint",
    oxlintOutput([
      {
        code: "toolchain-probe(inspect)",
        message: "sentinel",
        labels: [{ span: { offset, length: 6 } }],
      },
    ]),
    source,
  );
  assert.ok(parsed.ok);
  const [message] = parsed.value;
  assert.ok(message);
  assert.equal(message.ruleId, "toolchain-probe/inspect");
  assert.deepEqual(
    [message.line, message.column, message.endLine, message.endColumn],
    [1, 10, 1, 16],
  );
});

test("a byte order mark and every line terminator count as ESLint counts them", () => {
  const source = "\u{FEFF}w;\r  marker;\u{2028}x;\u{2029}y;\nz;\r\nv;";
  const positions = ["w", "marker", "x", "y", "z", "v"].map((name) => {
    const offset = Buffer.byteLength(source.slice(0, source.indexOf(name)));
    const parsed = parseDiagnostics(
      "oxlint",
      oxlintOutput([
        {
          code: "toolchain-probe(inspect)",
          message: "sentinel",
          labels: [{ span: { offset, length: name.length } }],
        },
      ]),
      source,
    );
    assert.ok(parsed.ok);
    const [message] = parsed.value;
    assert.ok(message);
    return [message.line, message.column];
  });
  assert.deepEqual(positions, [
    [1, 1],
    [2, 3],
    [3, 1],
    [4, 1],
    [5, 1],
    [6, 1],
  ]);
});

test("a newly supported host is surfaced for expectation review", () => {
  const result = assess(typed, untypedHost, run(usableTypes, [finding]));
  assert.equal(result.correctness, "matched");
  assert.equal(result.capability, "supported");
  assert.equal(result.expectationMatched, false);
  assert.equal(result.reason, "Host now provides type services; review the expectation");
});

test("extra probe diagnostics cannot hide beside a valid sentinel", () => {
  const stray: Diagnostic = {
    ruleId: probeRuleId,
    message: "Unrelated probe error",
    severity: 2,
    line: 1,
    column: 1,
  };
  const result = assess(typed, untypedHost, run(missingTypes, [stray], 0));
  assert.equal(result.expectationMatched, false);
  assert.equal(result.status, "execution-error");
  assert.equal(result.reason, "Unexpected rule toolchain-probe/inspect");
});

test("two sentinels are as unusable as none", () => {
  const result = assess(typed, eslintHost, run(usableTypes, [sentinel(usableTypes)], 0));
  assert.equal(result.status, "unknown");
  assert.equal(result.reason, "Expected one probe sentinel; received 2");
});

test("missing capability booleans are malformed evidence rather than a known gap", () => {
  const result = assess(
    typed,
    untypedHost,
    run(
      `{"check":"types","supported":false,"observed":{"reason":"${reasons.typedServicesUnavailable}"}}`,
    ),
  );
  assert.equal(result.expectationMatched, false);
  assert.equal(result.status, "unknown");
  assert.equal(result.reason, "Invalid probe evidence");
});

test("a location sentinel reported at the wrong column is a mismatch", () => {
  const expected = { line: 2, column: 3, endLine: 2, endColumn: 9 };
  const location: HostCase = {
    id: "location",
    suite: "host",
    check: "location",
    code: "",
    extension: "js",
    expected,
  };
  const probe: ProbeMessage = { check: "location", supported: true, observed: expected };
  assert.equal(assess(location, eslintHost, run(probe, [], 0, expected)).expectationMatched, true);
  for (const shift of [{ column: 4 }, { endColumn: 10 }]) {
    const shifted = assess(location, eslintHost, run(probe, [], 0, { ...expected, ...shift }));
    assert.equal(shifted.expectationMatched, false);
    assert.equal(shifted.reason, "Mismatch in position");
  }
});

test("applied fixes still require clean process and diagnostic output", () => {
  const clean = outcome({ exitCode: 0, stdout: eslintOutput([]) });
  assert.equal(fixRunProblem("eslint", clean, "2", "2"), undefined);
  const stray: Diagnostic = {
    ruleId: "other/rule",
    message: "Error",
    severity: 2,
    line: 1,
    column: 1,
  };
  const problems: [RunOutcome, string][] = [
    [{ ...clean, exitCode: 1 }, "Process exited 1 (no signal)"],
    [
      { ...clean, signal: "SIGTERM", stderr: "error: killed" },
      "Process exited 0 (SIGTERM): error: killed",
    ],
    [{ ...clean, stdout: eslintOutput([stray]) }, "Unexpected probe diagnostic"],
  ];
  for (const [bad, expected] of problems) {
    assert.equal(fixRunProblem("eslint", bad, "2", "2"), expected);
  }
  const garbage = fixRunProblem("eslint", { ...clean, stdout: "invalid json" }, "2", "2");
  assert.ok(garbage);
  assert.match(garbage, /^Unexpected token/u);
  assert.equal(fixRunProblem("eslint", clean, "1", "2"), "file differs from the expected edit");
});

test("an edit replaces its range, and suggestion payloads compare description and edit", () => {
  assert.equal(applyEdit("abcdef", { range: [1, 3], text: "XYZ" }), "aXYZdef");
  const fixes: HostCase = {
    id: "fixes",
    suite: "host",
    check: "fixes",
    code: "const answer = 1;\n",
    extension: "js",
    expected: { literal: 1, range: [15, 16] },
    expectedSuggestions: [{ desc: "Replace one with three", fix: { range: [15, 16], text: "3" } }],
  };
  const payload = (suggestions: unknown): RunOutcome =>
    outcome({
      exitCode: 0,
      stdout: eslintOutput([
        { ...sentinel({ check: "fixes", supported: true, observed: fixes.expected }), suggestions },
      ]),
    });
  const suggestion = (desc: string, fix: Edit = { range: [15, 16], text: "3" }) => [{ desc, fix }];
  assert.equal(
    suggestionPayloadProblem("eslint", payload(suggestion("Replace one with three")), fixes),
    undefined,
  );
  assert.equal(
    suggestionPayloadProblem("eslint", payload(suggestion("Replace one")), fixes),
    'suggestion payload was [{"desc":"Replace one","fix":{"range":[15,16],"text":"3"}}]',
  );
  const shifted = suggestion("Replace one with three", { range: [14, 16], text: "3" });
  assert.equal(
    suggestionPayloadProblem("eslint", payload(shifted), fixes),
    'suggestion payload was [{"desc":"Replace one with three","fix":{"range":[14,16],"text":"3"}}]',
  );
  assert.equal(
    suggestionPayloadProblem("eslint", payload("garbage"), fixes),
    'suggestion payload was "garbage"',
  );
  assert.equal(
    suggestionPayloadProblem("eslint", outcome({ exitCode: 0, stdout: "[]" }), fixes),
    "Expected exactly one linted file with a messages array",
  );
});

test("a host probe cannot pass when fix or suggestion behavior is lost", () => {
  const fixture: HostCase = {
    id: "fixes",
    suite: "host",
    check: "fixes",
    code: "",
    extension: "js",
    expected: { literal: 1, range: [15, 16] },
    expectedFix: { range: [15, 16], text: "2" },
    expectedSuggestions: [{ desc: "Replace one with three", fix: { range: [15, 16], text: "3" } }],
  };
  const probe: ProbeMessage = { check: "fixes", supported: true, observed: fixture.expected };
  const applied = { method: "--fix-suggestions application" };
  const lost: [Fixes, string][] = [
    [
      { fix: { problem: "file differs from the expected edit" }, suggestions: [applied] },
      "Mismatch in fix (file differs from the expected edit)",
    ],
    [
      { fix: {}, suggestions: [{ ...applied, problem: "2 diagnostics after the edit" }] },
      "Mismatch in suggestions (--fix-suggestions application: 2 diagnostics after the edit)",
    ],
    [{ fix: {} }, "Mismatch in suggestions"],
  ];
  for (const [fixes, reason] of lost) {
    const result = assess(fixture, eslintHost, run(probe), fixes);
    assert.equal(result.expectationMatched, false);
    assert.equal(result.reason, reason);
  }
  assert.equal(
    assess(fixture, eslintHost, run(probe), { fix: {}, suggestions: [applied] }).status,
    "matched",
  );
});

test("a process failure quotes the host's error line, not its banner", () => {
  const stderr = "Oops! Something went wrong!\n\nESLint: 10.13.0\n\nError: Invalid option\n";
  const result = assess(typed, eslintHost, outcome({ exitCode: 2, stdout: "", stderr }));
  assert.equal(result.status, "execution-error");
  assert.equal(result.reason, "Process exited 2 (no signal): Error: Invalid option");
});

test("a host observation that differs is a mismatch in observation", () => {
  const scope: HostCase = {
    id: "scope",
    suite: "host",
    check: "scope",
    code: "",
    extension: "js",
    expected: { shadowed: [false, true] },
  };
  const probe: ProbeMessage = {
    check: "scope",
    supported: true,
    observed: { shadowed: [false, false] },
  };
  const result = assess(scope, eslintHost, run(probe));
  assert.equal(result.status, "mismatch");
  assert.equal(result.expectationMatched, false);
  assert.equal(result.reason, "Mismatch in observation");
  const same: ProbeMessage = { ...probe, observed: scope.expected };
  assert.equal(assess(scope, eslintHost, run(same)).status, "matched");
});

test("an unsupported host observation carries the probe's reason", () => {
  const selector: HostCase = {
    id: "selector",
    suite: "host",
    check: "selectors",
    code: "",
    extension: "js",
    expected: { memberCalls: 1, property: "groupBy", computed: false },
  };
  const probe: ProbeMessage = {
    check: "selectors",
    supported: false,
    observed: { memberCalls: 0, reason: "attribute selector matched no node" },
  };
  const result = assess(selector, eslintHost, run(probe));
  assert.equal(result.status, "unsupported");
  assert.equal(result.expectationMatched, false);
  assert.equal(result.reason, "attribute selector matched no node; Mismatch in observation");
});

test("a probe error is an execution error with the probe's message", () => {
  const probe: ProbeMessage = {
    check: "types",
    supported: false,
    observed: { hasProgram: true, hasNodeMap: true, hasChecker: false, error: "boom" },
  };
  const result = assess(typed, eslintHost, run(probe));
  assert.equal(result.status, "execution-error");
  assert.equal(result.reason, "boom");
});

test("the exit code must agree with the product diagnostics", () => {
  const result = assess(typed, eslintHost, run(usableTypes, [finding], 0));
  assert.equal(result.status, "execution-error");
  assert.equal(result.reason, "Exit code 0, expected 1");
});

test("duplicate expectations each need their own diagnostic", () => {
  const twice: BaselineCase = { ...typed, expected: [...typed.expected, ...typed.expected] };
  const result = assess(twice, eslintHost, run(usableTypes, [finding]));
  assert.equal(result.status, "coverage-loss");
  assert.equal(result.reason, "Missing check-visibility at 1:9");
});

test("a product diagnostic in a host-only probe is an execution error", () => {
  const options: HostCase = {
    id: "options",
    suite: "host",
    check: "options",
    code: "",
    extension: "js",
    expected: { configuredCheck: "options", visited: true },
  };
  const probe: ProbeMessage = { check: "options", supported: true, observed: options.expected };
  const product: Diagnostic = { ...finding, message: "API (array-group).", column: 1 };
  const result = assess(options, eslintHost, run(probe, [product]));
  assert.equal(result.status, "execution-error");
  assert.equal(result.reason, "Product rule ran in a host-only probe");
});
