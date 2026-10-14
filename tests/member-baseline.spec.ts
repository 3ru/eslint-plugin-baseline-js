import { promises as fs } from "node:fs";
import ts from "typescript";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { lintWithBaseline } from "./helpers";
import { createTypedFixture, lintTypedFixture, type TypedFixture } from "./utils/typed-fixture";

const include = {
  includeWebApis: { preset: "safe" },
  includeJsBuiltins: { preset: "safe" },
};

const cases = [
  { code: "URL.parse('https://example.com');", available: "widely", count: 1 },
  { code: "URL.parse('https://example.com');", available: "newly", count: 0 },
  { code: "URL.parse('https://example.com');", available: 2023, count: 1, year: 2024 },
  { code: "URL.parse('https://example.com');", available: 2024, count: 0 },
  { code: "globalThis.URL['parse']?.('https://example.com');", available: 2023, count: 1 },
  { code: "AbortSignal.abort();", available: 2020, count: 1, year: 2021 },
  { code: "AbortSignal.abort();", available: 2021, count: 0 },
  { code: "navigator.clipboard.writeText('hello');", available: "widely", count: 0 },
  { code: "navigator.clipboard.writeText('hello');", available: 2020, count: 0 },
  { code: "navigator.mediaSession;", available: "widely", count: 0 },
  { code: "window.cookieStore;", available: "newly", count: 0 },
  { code: "window.open('https://example.com');", available: "newly", count: 1 },
  { code: "new EventTarget();", available: 2019, count: 1, year: 2020 },
  { code: "new EventTarget();", available: 2020, count: 0 },
  { code: "new ClipboardItem({});", available: 2024, count: 1, year: 2025 },
  { code: "new ClipboardItem({});", available: 2025, count: 0 },
  { code: "new IntersectionObserverEntry({});", available: "newly", count: 1 },
  { code: "console.timeLog('task');", available: 2019, count: 1, year: 2020 },
  { code: "Object.fromEntries([]);", available: 2019, count: 1, year: 2020 },
  { code: "Object.fromEntries([]);", available: 2020, count: 0 },
  { code: "Array.from([]);", available: 2015, count: 0 },
  { code: "Proxy.revocable({}, {});", available: 2016, count: 1, year: 2017 },
  { code: "Proxy.revocable({}, {});", available: 2017, count: 0 },
  {
    code: "function check(URL) { return URL.parse('https://example.com'); }",
    available: 2020,
    count: 0,
  },
  { code: "const console = { timeLog() {} }; console.timeLog('task');", available: 2019, count: 0 },
] as const;

describe("individual API Baseline status", () => {
  it.each(cases)("$code under $available", async ({ code, available, count, ...expected }) => {
    const messages = await lintWithBaseline(code, available, {}, include);
    expect(messages).toHaveLength(count);
    if ("year" in expected) {
      expect(messages[0]).toContain(`became Baseline in ${expected.year} and exceeds ${available}`);
    }
  });

  it("keeps feature IDs as the inclusion and ignore boundary", async () => {
    const code = "URL.parse('https://example.com');";
    await expect(
      lintWithBaseline(
        code,
        2020,
        {},
        {
          includeWebApis: { preset: "safe", only: ["url"] },
        },
      ),
    ).resolves.toEqual(["'parse' on URL became Baseline in 2024 and exceeds 2020 (url)."]);
    for (const options of [
      { includeWebApis: { preset: "safe", only: ["url-canparse"] } },
      { includeWebApis: { preset: "safe", ignore: ["url"] } },
      { includeWebApis: true, ignoreFeatures: ["/^url$/"] },
      { includeWebApis: true, ignoreNodeTypes: ["Identifier"] },
    ]) {
      await expect(lintWithBaseline(code, 2020, {}, options)).resolves.toEqual([]);
    }
  });
});

describe("individual typed member Baseline status", () => {
  let fixture: TypedFixture;

  beforeAll(async () => {
    fixture = await createTypedFixture(
      `
      declare const element: Element;
      element.ariaActiveDescendantElement;
      element.ariaOwnsElements;
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

  it.each([
    {
      feature: "aria-attribute-reflection",
      available: "widely",
      subjects: ["ariaActiveDescendantElement", "ariaOwnsElements"],
    },
    { feature: "aria-attribute-reflection", available: "newly", subjects: ["ariaOwnsElements"] },
    { feature: "async-clipboard", available: "widely", subjects: ["read", "presentationStyle"] },
    { feature: "async-clipboard", available: "newly", subjects: ["presentationStyle"] },
    { feature: "url", available: 2020, subjects: ["size"] },
    { feature: "url", available: 2023, subjects: [] },
  ] as const)("$feature under $available", async ({ feature, available, subjects }) => {
    const messages = await lintTypedFixture(fixture, {
      available,
      includeWebApis: { preset: "type-aware", only: [feature] },
    });
    expect(messages.some((message) => message.fatal)).toBe(false);
    expect(messages.map((message) => message.message.match(/^'([^']+)'/)?.[1])).toEqual(subjects);
  });
});
