import { isDeepStrictEqual } from "node:util";
import { requiresTypes } from "./cases.ts";
import { probeRuleId, productRuleId, reasons, sentinelPrefix } from "./protocol.mjs";
import type {
  Assessment,
  Case,
  Diagnostic,
  Format,
  HostFacts,
  ObservedFacts,
  ObservedFinding,
  Parsed,
  ProbeEvidence,
  Report,
  RunOutcome,
} from "./types.ts";

interface Position {
  line: number;
  column: number;
}

interface ProbeReading {
  evidence: ProbeEvidence;
  facts: ObservedFacts;
}

const fail = (problem: string): Parsed<never> => ({ ok: false, problem });
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isString = (value: unknown): value is string => typeof value === "string";
const isNumber = (value: unknown): value is number => typeof value === "number";
const isBoolean = (value: unknown): value is boolean => typeof value === "boolean";
const isIndex = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0;
const isRuleId = (value: unknown): value is string | null => value === null || isString(value);
const isSeverity = (value: unknown): value is number | string => isNumber(value) || isString(value);
const absentOr =
  <T>(guard: (value: unknown) => value is T) =>
  (value: unknown): value is T | undefined =>
    value === undefined || guard(value);

function parseJson(text: string): Parsed<unknown> {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (error) {
    if (error instanceof SyntaxError) return fail(error.message);
    throw error;
  }
}

const lineBreak = /\r\n|[\r\n\u{2028}\u{2029}]/u;

// Oxlint reports byte offsets; ESLint and Bun report lines and UTF-16 columns of the text
// without its byte order mark. Convert the former into the latter.
function positionAt(source: string, offset: number): Position {
  const prefix = Buffer.from(source)
    .subarray(0, offset)
    .toString("utf8")
    .replace(/^\u{FEFF}/u, "");
  const lastLine = prefix.replace(/^[\s\S]*(?:\r\n|[\r\n\u{2028}\u{2029}])/u, "");
  return { line: prefix.split(lineBreak).length, column: lastLine.length + 1 };
}

function readEslintDiagnostic(entry: unknown): Diagnostic | undefined {
  if (!isRecord(entry) || !isString(entry.message)) return undefined;
  const { ruleId, severity, fatal, line, column, endLine, endColumn } = entry;
  if (
    !absentOr(isRuleId)(ruleId) ||
    !absentOr(isSeverity)(severity) ||
    !absentOr(isBoolean)(fatal) ||
    !absentOr(isNumber)(line) ||
    !absentOr(isNumber)(column) ||
    !absentOr(isNumber)(endLine) ||
    !absentOr(isNumber)(endColumn)
  ) {
    return undefined;
  }
  return {
    ruleId,
    message: entry.message,
    severity,
    fatal,
    line,
    column,
    endLine,
    endColumn,
  };
}

function parseEslint(output: unknown): Parsed<Diagnostic[]> {
  const file: unknown = Array.isArray(output) && output.length === 1 ? output[0] : undefined;
  const messages = isRecord(file) ? file.messages : undefined;
  if (!Array.isArray(messages))
    return fail("Expected exactly one linted file with a messages array");
  const diagnostics: Diagnostic[] = [];
  for (const entry of messages as unknown[]) {
    const diagnostic = readEslintDiagnostic(entry);
    if (!diagnostic) return fail("Malformed diagnostic message");
    diagnostics.push(diagnostic);
  }
  return { ok: true, value: diagnostics };
}

function readOxlintDiagnostic(entry: unknown, source: string): Parsed<Diagnostic> {
  if (!isRecord(entry) || !isString(entry.message) || !absentOr(isSeverity)(entry.severity)) {
    return fail("Malformed Oxlint diagnostic");
  }
  const label: unknown = Array.isArray(entry.labels) ? entry.labels[0] : undefined;
  const span = isRecord(label) && isRecord(label.span) ? label.span : undefined;
  // Oxlint's own reports, such as a JS plugin that threw, carry neither a code nor a span.
  if (!entry.code && !span) {
    return { ok: true, value: { message: entry.message, severity: entry.severity } };
  }
  if (!span || !isIndex(span.offset) || !isIndex(span.length)) {
    return fail("Missing Oxlint diagnostic span");
  }
  const ruleId = isString(entry.code)
    ? entry.code.replace(/^(.+)\(([^)]+)\)$/u, "$1/$2")
    : undefined;
  const start = positionAt(source, span.offset);
  const end = positionAt(source, span.offset + span.length);
  return {
    ok: true,
    value: {
      ruleId,
      message: entry.message,
      severity: entry.severity,
      line: start.line,
      column: start.column,
      endLine: end.line,
      endColumn: end.column,
    },
  };
}

function parseOxlint(output: unknown, source: string): Parsed<Diagnostic[]> {
  const entries = isRecord(output) ? output.diagnostics : undefined;
  if (!Array.isArray(entries)) return fail("Missing Oxlint diagnostics array");
  const diagnostics: Diagnostic[] = [];
  for (const entry of entries as unknown[]) {
    const diagnostic = readOxlintDiagnostic(entry, source);
    if (!diagnostic.ok) return diagnostic;
    diagnostics.push(diagnostic.value);
  }
  return { ok: true, value: diagnostics };
}

export function parseDiagnostics(
  format: Format,
  stdout: string,
  source: string,
): Parsed<Diagnostic[]> {
  const output = parseJson(stdout);
  if (!output.ok) return output;
  return format === "oxlint" ? parseOxlint(output.value, source) : parseEslint(output.value);
}

function hostMessage(run: RunOutcome): string | undefined {
  const lines = run.stderr
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.find((line) => /^error\b/iu.test(line)) ?? lines[0];
}

function processFailure(run: RunOutcome): string {
  const outcome = run.error ?? `Process exited ${run.exitCode} (${run.signal ?? "no signal"})`;
  return [outcome, hostMessage(run)].filter(Boolean).join(": ");
}

function readProbe(message: Diagnostic, testCase: Case): Parsed<ProbeReading> {
  if (message.ruleId !== probeRuleId || !message.message.startsWith(sentinelPrefix)) {
    return fail("Unexpected probe diagnostic");
  }
  const parsed = parseJson(message.message.slice(sentinelPrefix.length));
  if (!parsed.ok) return parsed;
  const probe = parsed.value;
  if (!isRecord(probe) || !isRecord(probe.observed)) return fail("Invalid probe evidence");
  const { supported, observed } = probe;
  if (probe.check === undefined) {
    return fail(isString(observed.reason) ? observed.reason : reasons.optionsNotDelivered);
  }
  const { reason, error, hasProgram, hasNodeMap, hasChecker } = observed;
  const { check } = testCase;
  if (
    probe.check !== check ||
    !isBoolean(supported) ||
    !absentOr(isString)(reason) ||
    !absentOr(isString)(error) ||
    !absentOr(isBoolean)(hasProgram) ||
    !absentOr(isBoolean)(hasNodeMap) ||
    (check === "types" && ![hasProgram, hasNodeMap, hasChecker].every(isBoolean))
  ) {
    return fail("Invalid probe evidence");
  }
  if (
    testCase.check === "types" &&
    supported &&
    (hasProgram !== true ||
      hasNodeMap !== true ||
      hasChecker !== true ||
      observed.property !== testCase.member ||
      observed.hasProperty !== true ||
      !isString(observed.receiverType) ||
      !isBoolean(observed.defaultLibrary))
  ) {
    return fail(
      `Type evidence does not verify ${testCase.member} with usable receiver services; inspect the raw probe output`,
    );
  }
  return {
    ok: true,
    value: {
      evidence: { check, supported, observed },
      facts: { reason, error, hasProgram, hasNodeMap },
    },
  };
}

function productDiagnostic(message: Diagnostic): ObservedFinding {
  return {
    featureId:
      message.message.match(/\. Feature ID: ([a-z0-9-]+)\.$/u)?.[1] ??
      message.message.match(/\(([^()]+)\)\.?$/u)?.[1] ??
      null,
    line: message.line,
    column: message.column,
  };
}

function subtract<Left, Right>(left: readonly Left[], right: readonly Right[]): Left[] {
  const remaining = [...right];
  return left.filter((entry) => {
    const index = remaining.findIndex((other) => isDeepStrictEqual(entry, other));
    if (index < 0) return true;
    remaining.splice(index, 1);
    return false;
  });
}

const listFindings = (label: string, entries: readonly ObservedFinding[]): string[] =>
  entries.map(({ featureId, line, column }) => `${label} ${featureId} at ${line}:${column}`);

export function assess(testCase: Case, host: HostFacts, run: RunOutcome): Assessment {
  const result: Assessment = {
    caseId: testCase.id,
    suite: testCase.suite,
    capability: "unknown",
    correctness: "not-assessed",
    status: "execution-error",
    expectationMatched: false,
  };
  if (run.error || run.signal || (run.exitCode !== 0 && run.exitCode !== 1)) {
    return { ...result, reason: processFailure(run) };
  }
  const parsed = parseDiagnostics(host.format, run.stdout, testCase.code);
  if (!parsed.ok) {
    return { ...result, reason: [parsed.problem, hostMessage(run)].filter(Boolean).join(": ") };
  }
  const messages = parsed.value;
  const unattributed = messages.find((message) => message.fatal || message.ruleId == null);
  if (unattributed) return { ...result, reason: unattributed.message };
  const [sentinel, ...extra] = messages.filter(
    (message) => message.ruleId === probeRuleId && message.message.startsWith(sentinelPrefix),
  );
  if (!sentinel || extra.length > 0) {
    const received = sentinel ? extra.length + 1 : 0;
    return {
      ...result,
      status: "unknown",
      reason: `Expected one probe sentinel; received ${received}`,
    };
  }
  const probe = readProbe(sentinel, testCase);
  if (!probe.ok) return { ...result, status: "unknown", reason: probe.problem };
  const { evidence, facts } = probe.value;
  result.evidence = evidence;
  result.capability = evidence.supported ? "supported" : "unavailable";
  const needsTypes = requiresTypes(testCase);
  const expectedUnavailable = needsTypes && !host.typeServices;
  result.expectedCapability = expectedUnavailable ? "unavailable" : "supported";
  if (facts.error) return { ...result, reason: facts.error };
  const documentedTypeGap =
    !evidence.supported &&
    needsTypes &&
    facts.reason === reasons.typedServicesUnavailable &&
    (!facts.hasProgram || !facts.hasNodeMap);
  const capabilityMatches = expectedUnavailable ? documentedTypeGap : evidence.supported;
  const capabilityReason = (): string => {
    if (expectedUnavailable && evidence.supported) {
      return "Host now provides type services; review the expectation";
    }
    return facts.reason ?? "capability unavailable without a reason";
  };

  const unexpectedRules = messages.filter(
    (message) => message !== sentinel && message.ruleId !== productRuleId,
  );
  const product = messages
    .filter((message) => message.ruleId === productRuleId)
    .map(productDiagnostic);
  result.diagnostics = product;
  const expectedExit = product.length > 0 ? 1 : 0;
  if (unexpectedRules.length) {
    const ruleIds = unexpectedRules.map((message) => message.ruleId).join(", ");
    return { ...result, reason: `Unexpected rule ${ruleIds}`, unexpectedRules };
  }
  if (run.exitCode !== expectedExit) {
    return { ...result, reason: `Exit code ${run.exitCode}, expected ${expectedExit}` };
  }

  if (testCase.suite === "host") {
    if (product.length) return { ...result, reason: "Product rule ran in a host-only probe" };
    if (documentedTypeGap) {
      return {
        ...result,
        status: "unsupported",
        reason: facts.reason,
        expectationMatched: capabilityMatches,
      };
    }
    const checksPassed = {
      observation: isDeepStrictEqual(evidence.observed, testCase.expected),
      position:
        testCase.check !== "location" ||
        (["line", "column", "endLine", "endColumn"] as const).every(
          (key) => sentinel[key] === testCase.expected[key],
        ),
    };
    const failed = (Object.keys(checksPassed) as (keyof typeof checksPassed)[]).filter(
      (name) => !checksPassed[name],
    );
    result.correctness = failed.length ? "mismatch" : "matched";
    result.status = evidence.supported ? result.correctness : "unsupported";
    result.expectationMatched = capabilityMatches && failed.length === 0;
    const problems: string[] = [];
    if (!capabilityMatches) problems.push(capabilityReason());
    if (failed.length) problems.push(`Mismatch in ${failed.join(", ")}`);
    if (problems.length) result.reason = problems.join("; ");
    return result;
  }

  const missing = subtract(testCase.expected, product);
  const unexpected = subtract(product, testCase.expected);
  result.missing = missing;
  result.unexpected = unexpected;
  if (unexpected.length) {
    return {
      ...result,
      correctness: "unexpected",
      status: "incorrect",
      reason: listFindings("Unexpected", unexpected).join("; "),
    };
  }
  if (documentedTypeGap) {
    return {
      ...result,
      correctness: "not-verified",
      status: "unsupported",
      reason: "Required receiver analysis is unavailable; this case remains unverified",
      silentCoverageLoss: missing.length > 0 && run.exitCode === 0,
      expectationMatched: capabilityMatches,
    };
  }
  const detection = missing.length ? "coverage-loss" : "matched";
  result.correctness = missing.length ? "missing" : "matched";
  result.status = evidence.supported ? detection : "unsupported";
  result.expectationMatched = capabilityMatches && !missing.length;
  const problems: string[] = [];
  if (!capabilityMatches) problems.push(capabilityReason());
  problems.push(...listFindings("Missing", missing));
  if (problems.length) result.reason = problems.join("; ");
  return result;
}

export function renderReport(report: Report): string {
  const tools = report.tools
    ? [
        "| Tool | Package | Reported version |",
        "| --- | --- | --- |",
        ...Object.entries(report.tools).map(
          ([tool, metadata]) =>
            `| ${tool} | ${report.dependencies?.[tool] ?? "unavailable"} | ${metadata.version} |`,
        ),
        "",
      ]
    : [];
  const lines = [
    "# Toolchain capability report",
    "",
    `Profile: ${report.profile}. Captured at: ${report.capturedAt}.`,
    `Harness source: ${report.source?.commit ?? "unavailable"}.`,
    `Measured product: ${report.product?.source ?? "unavailable"}. Version: ${report.product?.version ?? "unavailable"}.`,
    "",
    "This compares external JavaScript plugin capabilities and a small Baseline corpus. It is not a speed benchmark or browser compatibility certification.",
    "",
    "Known missing receiver services remain **unsupported**, including negative cases. An expectation match means the recorded behavior was anticipated; it does not mean all checks ran.",
    "",
    ...tools,
    `Parser: ${report.dependencies?.["@typescript-eslint/parser"] ?? "unavailable"}. TypeScript reference: ${report.dependencies?.typescript ?? "unavailable"}.`,
    "",
    "| Case | Tool | Host capability | Result | Expected behavior observed |",
    "| --- | --- | --- | --- | --- |",
    ...report.results.map(
      (result) =>
        `| ${result.caseId} | ${result.tool} | ${result.capability} | ${result.status} | ${result.expectationMatched ? "yes" : "**no**"} |`,
    ),
    "",
  ];
  for (const result of report.results.filter((entry) => !entry.expectationMatched)) {
    lines.push(`- **${result.tool} / ${result.caseId}:** ${result.reason ?? result.correctness}`);
  }
  for (const [tool, reason] of Object.entries(report.hostErrors ?? {})) {
    lines.push(`- **${tool} not measured:** ${reason}`);
  }
  if (report.error) lines.push("", "Run error:", "", "```text", report.error, "```");
  return `${lines.join("\n")}\n`;
}
