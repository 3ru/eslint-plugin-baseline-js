import { isDeepStrictEqual } from "node:util";

const prefix = "toolchain-probe:";

function positionAt(source, offset) {
  const lines = Buffer.from(source).subarray(0, offset).toString("utf8").split("\n");
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
  if (message.ruleId !== "toolchain-probe/inspect" || !message.message.startsWith(prefix)) {
    throw new Error("Unexpected probe diagnostic");
  }
  const probe = JSON.parse(message.message.slice(prefix.length));
  if (
    probe?.check !== check ||
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
  const sentinels = messages.filter(
    (message) => message.ruleId === "toolchain-probe/inspect" && message.message.startsWith(prefix),
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
  const expectedUnavailable = tool !== "eslint" && testCase.needsTypes;
  result.expectedCapability = expectedUnavailable ? "unavailable" : "supported";
  if (probe.observed.error) {
    return { ...result, reason: probe.observed.error };
  }
  const documentedTypeGap =
    !probe.supported &&
    testCase.needsTypes &&
    !probe.observed.error &&
    probe.observed.reason === "typed parser services unavailable" &&
    (!probe.observed.hasProgram || !probe.observed.hasNodeMap);
  const capabilityMatches = expectedUnavailable ? documentedTypeGap : probe.supported;

  const unexpectedRules = messages.filter(
    (message) => message !== sentinels[0] && message.ruleId !== "baseline-js/use-baseline",
  );
  const product = messages
    .filter((message) => message.ruleId === "baseline-js/use-baseline")
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
    const observationMatches = isDeepStrictEqual(probe.observed, testCase.expected);
    const positionMatches =
      testCase.check !== "location" ||
      ["line", "column", "endLine", "endColumn"].every(
        (key) => sentinels[0][key] === testCase.expected[key],
      );
    const fixMatches = !testCase.expectedFix || fixes.fixMatched === true;
    const suggestionsMatch = !testCase.expectedSuggestions || fixes.suggestionsMatched === true;
    result.correctness =
      observationMatches && positionMatches && fixMatches && suggestionsMatch
        ? "matched"
        : "mismatch";
    result.status = probe.supported ? result.correctness : "unsupported";
    result.expectationMatched = capabilityMatches && result.correctness === "matched";
    if (!capabilityMatches) result.reason = `Expected ${result.expectedCapability} capability`;
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
  result.correctness = missing.length ? "missing" : "matched";
  result.status = probe.supported ? (missing.length ? "coverage-loss" : "matched") : "unsupported";
  result.expectationMatched = capabilityMatches && !missing.length;
  if (!capabilityMatches) result.reason = `Expected ${result.expectedCapability} capability`;
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
    "| Tool | Version / revision |",
    "| --- | --- |",
    ...Object.entries(report.tools ?? {}).map(
      ([tool, metadata]) => `| ${tool} | ${metadata.version} |`,
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
  if (report.error) lines.push(`Run error: ${report.error}`);
  return `${lines.join("\n")}\n`;
}
