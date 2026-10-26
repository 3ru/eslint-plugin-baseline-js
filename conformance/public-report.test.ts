import assert from "node:assert/strict";
import { test } from "node:test";
import {
  caseOutcome,
  parseExampleEvidence,
  parseManifest,
  parseSnapshot,
  renderSnapshotMarkdown,
  type Snapshot,
} from "../docs/website/lib/compatibility-report.ts";

const observed = {
  kind: "observed",
  capability: "unavailable",
  correctness: "not-assessed",
  status: "unsupported",
  expectationMatched: true,
  reason: "The host does not provide a TypeScript program.",
} as const;

function snapshot(): Snapshot {
  const measurement = {
    kind: "measured",
    capturedAt: "2026-10-25T00:00:00.000Z",
    parser: "8.72.0",
    typescript: "6.0.3",
    hosts: {
      eslint: { kind: "not-measured", reason: "Version command failed." },
      oxlint: {
        kind: "measured",
        packageVersion: "1.88.0",
        reportedVersion: "Version: 1.88.0",
        channel: "pinned",
        cases: { types: observed, interrupted: { kind: "not-measured", reason: "Interrupted." } },
      },
      bun: { kind: "not-measured", reason: "Version command failed." },
    },
  } as const;
  return {
    schemaVersion: 1,
    run: {
      repository: "3ru/eslint-plugin-baseline-js",
      id: "123",
      number: 1,
      attempt: 1,
      commit: "a".repeat(40),
      startedAt: "2026-10-25T00:00:00.000Z",
    },
    subject: { kind: "unresolved", reason: "Registry unavailable." },
    cases: [
      { id: "types", label: "Typed receivers", suite: "host" },
      { id: "interrupted", label: "Interrupted case", suite: "baseline" },
    ],
    profiles: { pinned: measurement, latest: { kind: "not-measured", reason: "Install failed." } },
  };
}

test("public reports preserve unsupported observations beside interrupted and failed measurements", () => {
  const parsed = parseSnapshot(JSON.parse(JSON.stringify(snapshot())));
  assert.deepEqual(parsed, snapshot());
  const markdown = renderSnapshotMarkdown({
    snapshot: parsed,
    evidenceBaseUrl: "https://example.test/run",
  });
  assert.match(markdown, /Unsupported/);
  assert.match(markdown, /Not measured/);
  assert.match(markdown, /Install failed\./);
  assert.match(markdown, /https:\/\/example\.test\/run\/pinned\/report\.json/);
  assert.match(markdown, /Expected result/);
});

test("public reports compare recorded code, warnings, and correct silence across three hosts", () => {
  const input = snapshot();
  const cases = [
    {
      id: "warning",
      label: "Object.groupBy",
      suite: "baseline",
      example: {
        code: "Object.groupBy([], String);\n",
        language: "js",
        expected: [{ featureId: "array-group", line: 1, column: 8 }],
      },
    },
    {
      id: "silence",
      label: "Local Object",
      suite: "baseline",
      example: {
        code: "const Object = { groupBy() { return '```'; } };\nObject.groupBy();\n",
        language: "js",
        expected: [],
      },
    },
    {
      id: "typed",
      label: "Set.union",
      suite: "baseline",
      example: {
        code: "declare const values: Set<unknown>;\nvalues.union(new Set());\n",
        language: "ts",
        expected: [{ featureId: "set-methods", line: 2, column: 8 }],
      },
    },
  ] as const;
  const matched = {
    kind: "observed",
    capability: "supported",
    correctness: "matched",
    status: "matched",
    expectationMatched: true,
    reason: null,
  } as const;
  const measurement = {
    kind: "measured",
    capturedAt: "2026-10-25T00:00:00.000Z",
    parser: "8.72.0",
    typescript: "6.0.3",
    hosts: Object.fromEntries(
      ["eslint", "oxlint", "bun"].map((host) => [
        host,
        {
          kind: "measured",
          packageVersion: "1.0.0",
          reportedVersion: "1.0.0",
          channel: "latest",
          cases: {
            warning:
              host === "bun"
                ? { ...matched, status: "coverage-loss", correctness: "missing" }
                : matched,
            silence:
              host === "oxlint"
                ? { ...matched, status: "incorrect", correctness: "unexpected" }
                : matched,
            typed: host === "eslint" ? matched : observed,
          },
        },
      ]),
    ),
  };
  const parsed = parseSnapshot({
    ...input,
    cases,
    profiles: { pinned: { kind: "not-measured", reason: "Install failed." }, latest: measurement },
  });
  assert.deepEqual(parsed.cases, cases);
  const markdown = renderSnapshotMarkdown({
    snapshot: parsed,
    evidenceBaseUrl: "https://example.test/run",
  });
  assert.match(markdown, /```js\nObject\.groupBy\(\[\], String\);\n```/);
  assert.match(
    markdown,
    /````js\nconst Object = \{ groupBy\(\) \{ return '```'; \} \};\nObject\.groupBy\(\);\n````/,
  );
  assert.match(markdown, /Expected warning for array-group at line 1, column 8\./);
  assert.match(markdown, /Expected no warning\./);
  assert.match(markdown, /\| ESLint \| Oxlint \| Bun \|/);
  assert.match(markdown, /\| ✅ Warns \| ✅ Warns \| ❌ Missed warning \|/);
  assert.match(markdown, /\| ✅ No warning \| ❌ False positive \| ✅ No warning \|/);
  assert.match(markdown, /\| ✅ Warns \| ❌ Unsupported \| ❌ Unsupported \|/);
  assert.ok(markdown.indexOf("## Latest toolchain") < markdown.indexOf("Pinned toolchain"));
});

test("public parsing rejects invalid example metadata and host examples", () => {
  const input = snapshot();
  const example = {
    code: "Object.groupBy([], String);\n",
    language: "js",
    expected: [{ featureId: "array-group", line: 1, column: 8 }],
  };
  const withExample = (value: unknown, suite = "baseline") => ({
    ...input,
    cases: [{ ...input.cases[0], suite, example: value }, input.cases[1]],
  });
  assert.throws(() => parseSnapshot(withExample({ ...example, language: "tsx" })), /language/);
  assert.throws(() => parseSnapshot(withExample({ ...example, code: "" })), /code/);
  assert.throws(
    () =>
      parseSnapshot(
        withExample({ ...example, expected: [{ featureId: "array-group", line: 0, column: 8 }] }),
      ),
    /line/,
  );
  assert.throws(() => parseSnapshot(withExample(example, "host")), /host/);
});

test("case outcomes never turn expected unsupported or unverified results into success", () => {
  const testCase = { id: "typed", label: "Typed receiver", suite: "baseline" } as const;
  assert.equal(caseOutcome({ testCase, observation: observed }).icon, "❌");
  assert.equal(
    caseOutcome({
      testCase,
      observation: {
        ...observed,
        capability: "supported",
        status: "matched",
        correctness: "not-verified",
      },
    }).icon,
    "❌",
  );
  assert.equal(
    caseOutcome({
      testCase,
      observation: { ...observed, capability: "unknown", status: "unknown" },
    }).label,
    "Unknown",
  );
  assert.equal(
    caseOutcome({ testCase, observation: { ...observed, status: "execution-error" } }).label,
    "Run error",
  );
  assert.equal(
    caseOutcome({ testCase, observation: { kind: "not-measured", reason: "Interrupted." } }).label,
    "Not measured",
  );
  assert.equal(
    caseOutcome({
      testCase,
      observation: {
        ...observed,
        capability: "supported",
        correctness: "matched",
        status: "matched",
        expectationMatched: false,
      },
    }).icon,
    "✅",
  );
});

test("historical examples require matching measurement identity and agreement between observed hosts", () => {
  const input = snapshot();
  input.subject = {
    kind: "npm",
    version: "0.7.5",
    tarball:
      "https://registry.npmjs.org/eslint-plugin-baseline-js/-/eslint-plugin-baseline-js-0.7.5.tgz",
    integrity: `sha512-${Buffer.alloc(64).toString("base64")}`,
    resolvedAt: "2026-10-25T00:00:00.000Z",
  };
  const measurement = input.profiles.pinned;
  assert.ok(measurement.kind === "measured");
  assert.ok(measurement.hosts.oxlint.kind === "measured");
  measurement.hosts.oxlint.cases.interrupted = observed;
  const testCase = input.cases.find(({ id }) => id === "interrupted");
  assert.ok(testCase?.suite === "baseline");
  const row = {
    caseId: "interrupted",
    suite: "baseline",
    tool: "oxlint",
    expected: [{ featureId: "array-group", line: 1, column: 8 }],
    fixtureSha256: "b".repeat(64),
    run: { command: ["node", "linter", "input.js"] },
  };
  const evidence = {
    profile: "pinned",
    capturedAt: measurement.capturedAt,
    source: { commit: input.run.commit },
    subject: input.subject,
    results: [row],
  };
  const read = (evidence: unknown) =>
    parseExampleEvidence({ input: evidence, snapshot: input, profile: "pinned", testCase });
  assert.deepEqual(read(evidence), {
    language: "js",
    expected: [{ featureId: "array-group", line: 1, column: 8 }],
    fixtureSha256: "b".repeat(64),
  });
  assert.throws(() => read({ ...evidence, profile: "latest" }), /profile/);
  assert.throws(() => read({ ...evidence, capturedAt: "2026-10-24T00:00:00.000Z" }), /profile/);
  assert.throws(() => read({ ...evidence, source: { commit: "c".repeat(40) } }), /revision/);
  assert.throws(
    () =>
      read({ ...evidence, subject: { ...input.subject, resolvedAt: "2026-10-24T00:00:00.000Z" } }),
    /npm release/,
  );
  assert.throws(
    () => read({ ...evidence, results: [{ ...row, run: { command: ["node", "../input.js"] } }] }),
    /input.js or input.ts/,
  );
  assert.throws(
    () =>
      read({ ...evidence, results: [{ ...row, run: { command: ["node", "input.ts", "--fix"] } }] }),
    /input.js or input.ts/,
  );
  measurement.hosts.bun = { ...measurement.hosts.oxlint };
  assert.throws(
    () => read({ ...evidence, results: [row, { ...row, tool: "bun", expected: [] }] }),
    /disagree/,
  );
  assert.throws(
    () =>
      read({ ...evidence, results: [row, { ...row, tool: "bun", fixtureSha256: "c".repeat(64) }] }),
    /disagree/,
  );
  assert.throws(
    () =>
      read({
        ...evidence,
        results: [row, { ...row, tool: "bun", run: { command: ["node", "input.ts"] } }],
      }),
    /disagree/,
  );
});

test("public parsing rejects missing cases, foreign identities, and unknown schema versions", () => {
  const missing = snapshot();
  if (
    missing.profiles.pinned.kind === "measured" &&
    missing.profiles.pinned.hosts.oxlint.kind === "measured"
  ) {
    delete missing.profiles.pinned.hosts.oxlint.cases.interrupted;
  }
  assert.throws(() => parseSnapshot(missing), /cases/);
  assert.throws(
    () => parseSnapshot({ ...snapshot(), run: { ...snapshot().run, id: "../123" } }),
    /run.id/,
  );
  assert.throws(() => parseSnapshot({ ...snapshot(), schemaVersion: 2 }), /schemaVersion/);
  assert.throws(
    () =>
      parseSnapshot({
        ...snapshot(),
        run: { ...snapshot().run, startedAt: "2026-02-30T00:00:00.000Z" },
      }),
    /run.startedAt/,
  );
  assert.throws(
    () => parseManifest({ schemaVersion: 1, latest: { commit: "main" }, lastComplete: null }),
    /commit/,
  );
});

test("Markdown preserves untrusted reasons as literal text", () => {
  const input = snapshot();
  input.profiles.latest = {
    kind: "not-measured",
    reason: "failed | <script>\n<SCRIPT> [link](javascript:alert(1))",
  };
  const markdown = renderSnapshotMarkdown({ snapshot: input, evidenceBaseUrl: "" });
  assert.ok(
    markdown.includes(
      "failed &#124; &lt;script&gt; &lt;SCRIPT&gt; \\[link\\]\\(javascript:alert\\(1\\)\\)",
    ),
  );
});
