import { isDeepStrictEqual } from "node:util";
import { requiresTypes } from "./cases.mjs";
import { hosts } from "./hosts.mjs";
import { probeRuleId, productRuleId, reasons, sentinelPrefix } from "./protocol.mjs";

// Oxlint reports byte offsets; ESLint and Bun report lines and UTF-16 columns of the text
// without its byte order mark. Convert the former into the latter.
function positionAt(source, offset) {
  const prefix = Buffer.from(source)
    .subarray(0, offset)
    .toString("utf8")
    .replace(/^\u{FEFF}/u, "");
  const lines = prefix.split(/\r\n|[\r\n\u{2028}\u{2029}]/u);
  return { line: lines.length, column: lines.at(-1).length + 1 };
}

export function parseDiagnostics(tool, stdout, source) {
  const output = JSON.parse(stdout);
  if (tool === "oxlint") {
    if (!Array.isArray(output?.diagnostics)) throw new Error("Missing Oxlint diagnostics array");
    return output.diagnostics.map((diagnostic) => {
      if (typeof diagnostic.message !== "string") throw new Error("Malformed Oxlint diagnostic");
      const span = diagnostic.labels?.[0]?.span;
      // Oxlint's own reports, such as a JS plugin that threw, carry neither a code nor a span.
      if (!diagnostic.code && !span) return { ...diagnostic, ruleId: undefined };
      if (
        !span ||
        !Number.isInteger(span.offset) ||
        !Number.isInteger(span.length) ||
        span.offset < 0 ||
        span.length < 0
      ) {
        throw new Error("Missing Oxlint diagnostic span");
      }
      const ruleId = diagnostic.code?.replace(/^(.+)\(([^)]+)\)$/, "$1/$2");
      const end = positionAt(source, span.offset + span.length);
      return {
        ...diagnostic,
        ruleId,
        ...positionAt(source, span.offset),
        endLine: end.line,
        endColumn: end.column,
      };
    });
  }
  if (!Array.isArray(output) || output.length !== 1 || !Array.isArray(output[0]?.messages)) {
    throw new Error("Expected exactly one linted file with a messages array");
  }
  if (output[0].messages.some((message) => !message || typeof message.message !== "string")) {
    throw new Error("Malformed diagnostic message");
  }
  return output[0].messages;
}

// The host's own words, from stderr. ESLint prints a banner before its "Error:" line.
function hostMessage(run) {
  const lines = (run.stderr ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.find((line) => /^error\b/iu.test(line)) ?? lines[0];
}

function processFailure(run) {
  const outcome = run.error ?? `Process exited ${run.exitCode} (${run.signal ?? "no signal"})`;
  return [outcome, hostMessage(run)].filter(Boolean).join(": ");
}

function readProbe(message, check) {
  if (message.ruleId !== probeRuleId || !message.message.startsWith(sentinelPrefix)) {
    throw new Error("Unexpected probe diagnostic");
  }
  const probe = JSON.parse(message.message.slice(sentinelPrefix.length));
  if (probe?.check === undefined) throw new Error(reasons.optionsNotDelivered);
  if (
    probe.check !== check ||
    typeof probe.supported !== "boolean" ||
    !probe.observed ||
    typeof probe.observed !== "object" ||
    Array.isArray(probe.observed) ||
    (check === "types" &&
      ["hasProgram", "hasNodeMap", "hasChecker"].some(
        (key) => typeof probe.observed[key] !== "boolean",
      ))
  ) {
    throw new Error("Invalid probe evidence");
  }
  return probe;
}

export function applyEdit(code, { range: [start, end], text }) {
  return `${code.slice(0, start)}${text}${code.slice(end)}`;
}

// Why a --fix or --fix-suggestions run did not produce the expected file, or undefined.
export function fixRunProblem(tool, run, actualCode, expectedCode) {
  if (run.error || run.signal || run.exitCode !== 0) return processFailure(run);
  if (actualCode !== expectedCode) return "file differs from the expected edit";
  try {
    const messages = parseDiagnostics(tool, run.stdout, actualCode);
    // Oxlint removes fixed diagnostics; ESLint and Bun re-lint the changed file.
    if (messages.length > 1) return `${messages.length} diagnostics after the edit`;
    for (const message of messages) {
      const probe = readProbe(message, "fixes");
      if (probe.observed.error) return probe.observed.error;
      if (![1, "warning"].includes(message.severity)) return "re-linted probe is not a warning";
    }
    return undefined;
  } catch (error) {
    return error.message;
  }
}

// ESLint-style JSON carries each suggestion's description and edit on the diagnostic.
export function suggestionPayloadProblem(tool, run, testCase) {
  let messages;
  try {
    messages = parseDiagnostics(tool, run.stdout, testCase.code);
  } catch (error) {
    return error.message;
  }
  const sentinel = messages.find((message) => message.ruleId === probeRuleId);
  if (!sentinel) return "probe sentinel missing";
  const payload = sentinel.suggestions?.map(({ desc, fix }) => ({ desc, fix }));
  if (isDeepStrictEqual(payload, testCase.expectedSuggestions)) return undefined;
  return `suggestion payload was ${JSON.stringify(payload)}`;
}

function productDiagnostic(message) {
  return {
    featureId: message.message.match(/\(([^()]+)\)\.?$/)?.[1] ?? null,
    line: message.line,
    column: message.column,
  };
}

function subtract(left, right) {
  const remaining = [...right];
  return left.filter((entry) => {
    const index = remaining.findIndex((other) => isDeepStrictEqual(entry, other));
    if (index < 0) return true;
    remaining.splice(index, 1);
    return false;
  });
}

const listFindings = (label, entries) =>
  entries.map(({ featureId, line, column }) => `${label} ${featureId} at ${line}:${column}`);

export function assess(testCase, tool, run, fixes = {}) {
  const result = {
    caseId: testCase.id,
    suite: testCase.suite,
    capability: "unknown",
    correctness: "not-assessed",
    status: "execution-error",
    expectationMatched: false,
  };
  if (run.error || run.signal || ![0, 1].includes(run.exitCode)) {
    return { ...result, reason: processFailure(run) };
  }
  let messages;
  try {
    messages = parseDiagnostics(tool, run.stdout, testCase.code);
  } catch (error) {
    return { ...result, reason: [error.message, hostMessage(run)].filter(Boolean).join(": ") };
  }
  // A diagnostic with no rule id (a parse error, a JS plugin that threw, a directive problem)
  // belongs to no rule; keep the host's message.
  const unattributed = messages.find((message) => message.fatal || message.ruleId == null);
  if (unattributed) return { ...result, reason: unattributed.message };
  const sentinels = messages.filter(
    (message) => message.ruleId === probeRuleId && message.message.startsWith(sentinelPrefix),
  );
  if (sentinels.length !== 1) {
    return {
      ...result,
      status: "unknown",
      reason: `Expected one probe sentinel; received ${sentinels.length}`,
    };
  }
  let probe;
  try {
    probe = readProbe(sentinels[0], testCase.check);
  } catch (error) {
    return { ...result, status: "unknown", reason: error.message };
  }
  result.evidence = probe;
  result.capability = probe.supported ? "supported" : "unavailable";
  const needsTypes = requiresTypes(testCase);
  const expectedUnavailable = needsTypes && !hosts[tool].typeServices;
  result.expectedCapability = expectedUnavailable ? "unavailable" : "supported";
  if (probe.observed.error) {
    return { ...result, reason: probe.observed.error };
  }
  const documentedTypeGap =
    !probe.supported &&
    needsTypes &&
    probe.observed.reason === reasons.typedServicesUnavailable &&
    (!probe.observed.hasProgram || !probe.observed.hasNodeMap);
  const capabilityMatches = expectedUnavailable ? documentedTypeGap : probe.supported;
  const capabilityReason = () => {
    if (expectedUnavailable && probe.supported) {
      return "Host now provides type services; review the expectation";
    }
    return probe.observed.reason ?? "capability unavailable without a reason";
  };

  const unexpectedRules = messages.filter(
    (message) => message !== sentinels[0] && message.ruleId !== productRuleId,
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
        reason: probe.observed.reason,
        expectationMatched: capabilityMatches,
      };
    }
    const checks = {
      observation: isDeepStrictEqual(probe.observed, testCase.expected),
      position:
        testCase.check !== "location" ||
        ["line", "column", "endLine", "endColumn"].every(
          (key) => sentinels[0][key] === testCase.expected[key],
        ),
      fix: !testCase.expectedFix || fixes.fixMatched === true,
      suggestions: !testCase.expectedSuggestions || fixes.suggestionsMatched === true,
    };
    const causes = {
      fix: fixes.fixProblem,
      suggestions: fixes.suggestions
        ?.filter((entry) => entry.problem)
        .map((entry) => `${entry.method}: ${entry.problem}`)
        .join(", "),
    };
    const failed = Object.keys(checks)
      .filter((name) => !checks[name])
      .map((name) => (causes[name] ? `${name} (${causes[name]})` : name));
    result.correctness = failed.length ? "mismatch" : "matched";
    result.status = probe.supported ? result.correctness : "unsupported";
    result.expectationMatched = capabilityMatches && failed.length === 0;
    const problems = [];
    if (!capabilityMatches) problems.push(capabilityReason());
    if (failed.length) problems.push(`Mismatch in ${failed.join(", ")}`);
    if (problems.length) result.reason = problems.join("; ");
    if (testCase.expectedFix || testCase.expectedSuggestions) result.fixes = fixes;
    return result;
  }

  const missing = subtract(testCase.expected, product);
  const unexpected = subtract(product, testCase.expected);
  result.missing = missing;
  result.unexpected = unexpected;
  // A known host limitation cannot excuse false positives or the wrong diagnostic.
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
      reason: "Required receiver analysis is unavailable; zero findings do not verify this case",
      silentCoverageLoss: missing.length > 0 && run.exitCode === 0,
      expectationMatched: capabilityMatches,
    };
  }
  const detection = missing.length ? "coverage-loss" : "matched";
  result.correctness = missing.length ? "missing" : "matched";
  result.status = probe.supported ? detection : "unsupported";
  result.expectationMatched = capabilityMatches && !missing.length;
  const problems = [];
  if (!capabilityMatches) problems.push(capabilityReason());
  problems.push(...listFindings("Missing", missing));
  if (problems.length) result.reason = problems.join("; ");
  return result;
}

export function renderReport(report) {
  const pullRequest = report.source?.pullRequest;
  const commits = pullRequest
    ? ` (pull request head ${pullRequest.head}, base ${pullRequest.base})`
    : "";
  const lines = [
    "# Toolchain capability report",
    "",
    `Profile: ${report.profile}. Source: ${report.source?.commit ?? "unavailable"}${commits}.`,
    "",
    "This compares external JavaScript plugin capabilities and a small Baseline corpus. It is not a speed benchmark or browser compatibility certification.",
    "",
    "Known missing receiver services remain **unsupported**, including negative cases. An expectation match means the recorded behavior was anticipated; it does not mean all checks ran.",
    "",
    "| Tool | Package | Reported version |",
    "| --- | --- | --- |",
    ...Object.entries(report.tools ?? {}).map(
      ([tool, metadata]) =>
        `| ${tool} | ${report.dependencies?.[tool] ?? "unavailable"} | ${metadata.version} |`,
    ),
    "",
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
  if (report.error) lines.push("", "Run error:", "", "```text", report.error, "```");
  return `${lines.join("\n")}\n`;
}
