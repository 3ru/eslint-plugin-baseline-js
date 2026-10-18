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
      const span = diagnostic.labels?.[0]?.span;
      if (
        !span ||
        !Number.isInteger(span.offset) ||
        !Number.isInteger(span.length) ||
        span.offset < 0 ||
        span.length < 0 ||
        typeof diagnostic.message !== "string"
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

// Apply edits from the end of the text, so earlier offsets stay valid.
export function applyEdits(code, edits) {
  return [...edits]
    .sort((left, right) => right.range[0] - left.range[0])
    .reduce(
      (text, { range: [start, end], text: replacement }) =>
        `${text.slice(0, start)}${replacement}${text.slice(end)}`,
      code,
    );
}

export function fixRunMatches(tool, run, actualCode, expectedCode) {
  if (run.error || run.signal || run.exitCode !== 0 || actualCode !== expectedCode) return false;
  try {
    const messages = parseDiagnostics(tool, run.stdout, actualCode);
    // Oxlint removes fixed diagnostics; ESLint and Bun re-lint the changed file.
    return (
      messages.length <= 1 &&
      messages.every((message) => {
        const probe = readProbe(message, "fixes");
        return !probe.observed.error && [1, "warning"].includes(message.severity);
      })
    );
  } catch {
    return false;
  }
}

// ESLint-style JSON carries each suggestion's description and edit on the diagnostic.
export function suggestionPayloadMatches(tool, run, testCase) {
  let messages;
  try {
    messages = parseDiagnostics(tool, run.stdout, testCase.code);
  } catch {
    return false;
  }
  const sentinel = messages.find((message) => message.ruleId === probeRuleId);
  return isDeepStrictEqual(
    sentinel?.suggestions?.map(({ desc, fix }) => ({ desc, fix })),
    testCase.expectedSuggestions,
  );
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
    return {
      ...result,
      reason: run.error ?? `Process exited ${run.exitCode} (${run.signal ?? "no signal"})`,
    };
  }
  let messages;
  try {
    messages = parseDiagnostics(tool, run.stdout, testCase.code);
  } catch (error) {
    return { ...result, reason: error.message };
  }
  // A file the host could not parse has no rule id on its diagnostic; keep the parser's message.
  const fatal = messages.find((message) => message.fatal || message.ruleId == null);
  if (fatal) return { ...result, reason: fatal.message };
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
    if (!expectedUnavailable) return probe.observed.reason;
    if (probe.supported) return "Host now provides type services; review the expectation";
    return probe.observed.reason;
  };

  const unexpectedRules = messages.filter(
    (message) => message !== sentinels[0] && message.ruleId !== productRuleId,
  );
  const product = messages
    .filter((message) => message.ruleId === productRuleId)
    .map(productDiagnostic);
  result.diagnostics = product;
  const expectedExit = product.length > 0 ? 1 : 0;
  if (unexpectedRules.length || run.exitCode !== expectedExit) {
    return {
      ...result,
      reason: "Unexpected rule, parse diagnostic, or exit code",
      unexpectedRules,
    };
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
    const failed = Object.keys(checks).filter((name) => !checks[name]);
    result.correctness = failed.length ? "mismatch" : "matched";
    result.status = probe.supported ? result.correctness : "unsupported";
    result.expectationMatched = capabilityMatches && failed.length === 0;
    const problems = [];
    if (!capabilityMatches) problems.push(capabilityReason());
    if (failed.length) problems.push(`Mismatch in ${failed.join(", ")}`);
    if (problems.length) result.reason = problems.join("; ");
    result.fixes = testCase.expectedFix ? fixes : undefined;
    return result;
  }

  const missing = subtract(testCase.expected, product);
  const unexpected = subtract(product, testCase.expected);
  result.missing = missing;
  result.unexpected = unexpected;
  // A known host limitation cannot excuse false positives or the wrong diagnostic.
  if (unexpected.length) {
    return { ...result, correctness: "unexpected", status: "incorrect" };
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
  if (!capabilityMatches) result.reason = capabilityReason();
  return result;
}

export function renderReport(report) {
  const lines = [
    "# Toolchain capability report",
    "",
    `Profile: ${report.profile}. Source: ${report.source?.commit ?? "unavailable"}.`,
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
