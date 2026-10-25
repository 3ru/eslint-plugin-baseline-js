import assert from "node:assert/strict";
import { test } from "node:test";
import {
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

test("Markdown keeps untrusted reasons inside their table cells", () => {
  const input = snapshot();
  input.profiles.latest = {
    kind: "not-measured",
    reason: "failed | <script>\n[link](javascript:alert(1))",
  };
  const markdown = renderSnapshotMarkdown({ snapshot: input, evidenceBaseUrl: "" });
  assert.doesNotMatch(markdown, /<script>|\[link\]\(javascript:/);
  assert.match(markdown, /failed \\?&#124;|failed \\\|/);
});
