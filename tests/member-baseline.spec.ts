import { promises as fs } from "node:fs";
import ts from "typescript";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { lintWithBaseline } from "./helpers";
import {
  compatReportedUnder,
  compatStatusOf,
  compatYearPolicyMessage,
  reportingPolicyFor,
  reportingPolicyForCompat,
} from "./utils/policy";
import { createTypedFixture, lintTypedFixture, type TypedFixture } from "./utils/typed-fixture";

// Expectations derive from the member's own `status.by_compat_key` entry in the
// canonical web-features package, never from a status or year written here.
// Each subject is the rule's detection label for the matched pattern.
const include = {
  includeWebApis: { preset: "safe" },
  includeJsBuiltins: { preset: "safe" },
};

const members = [
  {
    code: "URL.parse('https://example.com');",
    featureId: "url",
    compatKey: "api.URL.parse_static",
    subject: "'parse' on URL",
  },
  {
    code: "new URL('https://example.com');",
    featureId: "url",
    compatKey: "api.URL.URL",
    subject: "'URL'",
  },
  {
    code: "navigator.clipboard.writeText('hello');",
    featureId: "async-clipboard",
    compatKey: "api.Navigator.clipboard",
    subject: "'clipboard' on navigator",
  },
  {
    code: "window.cookieStore;",
    featureId: "cookie-store",
    compatKey: "api.Window.cookieStore",
    subject: "'cookieStore' on window",
  },
  {
    code: "window.open('https://example.com');",
    featureId: "window",
    compatKey: "api.Window.open",
    subject: "'open'",
  },
  {
    code: "new EventTarget();",
    featureId: "events",
    compatKey: "api.EventTarget.EventTarget",
    subject: "'EventTarget'",
  },
  {
    code: "Object.fromEntries([]);",
    featureId: "object-object",
    compatKey: "javascript.builtins.Object.fromEntries",
    subject: "'fromEntries' on Object",
  },
] as const;

function ownMessages(messages: string[], featureId: string) {
  return messages.filter((message) => message.endsWith(`(${featureId}).`));
}

describe("individual API Baseline status", () => {
  it.each(members)(
    "$code is reported with its own status under the policy just below it",
    async ({ code, featureId, compatKey, subject }) => {
      const policy = reportingPolicyForCompat(featureId, compatKey);
      const messages = await lintWithBaseline(code, policy, {}, include);
      expect(ownMessages(messages, featureId)).toEqual([
        compatYearPolicyMessage(featureId, compatKey, policy, subject),
      ]);
    },
  );

  it.each(
    members.filter(
      ({ featureId, compatKey }) => compatStatusOf(featureId, compatKey)?.baseline !== false,
    ),
  )(
    "$code is silent once the policy reaches its own Baseline year",
    async ({ code, featureId, compatKey }) => {
      const policy = reportingPolicyForCompat(featureId, compatKey) + 1;
      const messages = await lintWithBaseline(code, policy, {}, include);
      expect(ownMessages(messages, featureId)).toEqual([]);
    },
  );

  it.each(members)(
    "$code follows its own status, not the feature headline",
    async ({ code, featureId, compatKey }) => {
      // The headline-derived policy reports the member only when the member's
      // own status is beyond it, whichever of the two is newer.
      const policy = reportingPolicyFor(featureId);
      const messages = await lintWithBaseline(code, policy, {}, include);
      expect(ownMessages(messages, featureId)).toHaveLength(
        compatReportedUnder(featureId, compatKey, policy) ? 1 : 0,
      );
    },
  );

  it("keeps a widely available member silent under widely", async () => {
    // Widely available members stay silent as data is refreshed, so the
    // literal policy is stable here (see tests/README.md).
    expect(compatStatusOf("async-clipboard", "api.Navigator.clipboard")?.baseline).toBe("high");
    await expect(
      lintWithBaseline("navigator.clipboard.writeText('hello');", "widely", {}, include),
    ).resolves.toEqual([]);
  });

  it("keeps feature IDs as the inclusion and ignore boundary", async () => {
    const code = "URL.parse('https://example.com');";
    const policy = reportingPolicyForCompat("url", "api.URL.parse_static");
    await expect(
      lintWithBaseline(code, policy, {}, { includeWebApis: { preset: "safe", only: ["url"] } }),
    ).resolves.toEqual([
      compatYearPolicyMessage("url", "api.URL.parse_static", policy, "'parse' on URL"),
    ]);
    for (const options of [
      { includeWebApis: { preset: "safe", only: ["url-canparse"] } },
      { includeWebApis: { preset: "safe", ignore: ["url"] } },
      { includeWebApis: true, ignoreFeatures: ["/^url$/"] },
    ]) {
      await expect(lintWithBaseline(code, policy, {}, options)).resolves.toEqual([]);
    }
  });
});

describe("individual typed member Baseline status", () => {
  // Fixture order; each member is detected through its receiver type.
  const typedMembers = [
    { featureId: "async-clipboard", compatKey: "api.Clipboard.writeText", subject: "writeText" },
    { featureId: "async-clipboard", compatKey: "api.Clipboard.read", subject: "read" },
    { featureId: "url", compatKey: "api.URLSearchParams.delete", subject: "delete" },
    { featureId: "url", compatKey: "api.URLSearchParams.size", subject: "size" },
    {
      featureId: "async-clipboard",
      compatKey: "api.ClipboardItem.presentationStyle",
      subject: "presentationStyle",
    },
  ] as const;

  let fixture: TypedFixture;

  beforeAll(async () => {
    fixture = await createTypedFixture(
      `
      declare const clipboard: Clipboard;
      clipboard.writeText('hello');
      clipboard.read();
      declare const params: URLSearchParams;
      params.delete('name');
      params.size;
      declare const item: ClipboardItem;
      item.presentationStyle;
    `,
      { target: "ESNext" },
    );
    const program = ts.createProgram([fixture.samplePath], fixture.compilerOptions);
    expect(
      ts
        .getPreEmitDiagnostics(program)
        .map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n")),
    ).toEqual([]);
  });

  afterAll(async () => {
    await fs.rm(fixture.root, { recursive: true, force: true });
  });

  it.each(typedMembers)(
    "$compatKey sets the reporting floor for its own feature",
    async ({ featureId, compatKey }) => {
      const policy = reportingPolicyForCompat(featureId, compatKey);
      const messages = await lintTypedFixture(fixture, {
        available: policy,
        includeWebApis: { preset: "type-aware", only: [featureId] },
      });
      expect(messages.some((message) => message.fatal)).toBe(false);
      const expected = typedMembers
        .filter(
          (m) => m.featureId === featureId && compatReportedUnder(featureId, m.compatKey, policy),
        )
        .map((m) => m.subject);
      expect(messages.map((message) => message.message.match(/^'([^']+)'/)?.[1])).toEqual(expected);
    },
  );
});
