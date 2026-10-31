import { promises as fs } from "node:fs";
import { ESLint } from "eslint";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import plugin from "../dist/index.mjs";
import type { CommonRuleOptions } from "../src/config";
import { createTypedFixture, lintTypedFixture } from "./utils/typed-fixture";

const symbolFixtures = [
  ["ViewTransitionTypeSet", "iterator", "active-view-transition"],
  ["ReadableStream", "asyncIterator", "async-iterable-streams"],
  ["CSSStyleDeclaration", "iterator", "css-object-model"],
  ["CSSNumericArray", "iterator", "css-typed-om"],
  ["CSSTransformValue", "iterator", "css-typed-om"],
  ["CSSUnparsedValue", "iterator", "css-typed-om"],
  ["StylePropertyMapReadOnly", "iterator", "css-typed-om"],
  ["DOMTokenList", "iterator", "dom"],
  ["NodeList", "iterator", "dom"],
  ["MediaKeyStatusMap", "iterator", "encrypted-media-extensions"],
  ["EventCounts", "iterator", "event-timing"],
  ["Headers", "iterator", "fetch"],
  ["FileSystemDirectoryHandle", "asyncIterator", "file-system-access"],
  ["FontFaceSet", "iterator", "font-loading"],
  ["Highlight", "iterator", "highlight"],
  ["HighlightRegistry", "iterator", "highlight"],
  ["CustomStateSet", "iterator", "state"],
  ["URLSearchParams", "iterator", "url"],
  ["AudioParamMap", "iterator", "web-audio"],
  ["MIDIInputMap", "iterator", "web-midi"],
  ["MIDIOutputMap", "iterator", "web-midi"],
  ["GPUSupportedFeatures", "iterator", "webgpu"],
  ["WGSLLanguageFeatures", "iterator", "webgpu"],
  ["RTCStatsReport", "iterator", "webrtc-stats"],
  ["FormData", "iterator", "xhr"],
];

const streamOptions: CommonRuleOptions = {
  available: 2023,
  includeWebApis: { preset: "type-aware", only: ["async-iterable-streams"] },
  includeJsBuiltins: false,
};
const bufferOptions: CommonRuleOptions = {
  available: 2023,
  includeWebApis: false,
  includeJsBuiltins: { preset: "type-aware", only: ["resizable-buffers"] },
};

async function lintTyped(source: string, options: CommonRuleOptions) {
  const fixture = await createTypedFixture(source, {
    target: "ESNext",
    lib: ["ESNext", "DOM", "DOM.Iterable", "DOM.AsyncIterable"],
  });
  try {
    const program = ts.createProgram([fixture.samplePath], {
      ...fixture.compilerOptions,
      skipLibCheck: false,
    });
    expect(
      ts
        .getPreEmitDiagnostics(program)
        .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")),
    ).toEqual([]);
    const messages = await lintTypedFixture(fixture, options);
    expect(messages.some((message) => message.fatal)).toBe(false);
    return messages;
  } finally {
    await fs.rm(fixture.root, { recursive: true, force: true });
  }
}

async function lintUntyped(source: string, options: CommonRuleOptions) {
  const eslint = new ESLint({
    overrideConfigFile: true,
    overrideConfig: {
      languageOptions: { ecmaVersion: "latest", sourceType: "module" },
      plugins: { "baseline-js": { meta: plugin.meta, rules: plugin.rules } },
      rules: { "baseline-js/use-baseline": ["error", options] },
    },
  });
  const [result] = await eslint.lintText(source);
  expect(result.messages.some((message) => message.fatal)).toBe(false);
  return result.messages;
}

describe("well-known Symbol instance members", () => {
  it("reports every supported standard-library fixture with its exact feature ID", async () => {
    const source = symbolFixtures
      .map(
        ([iface, key], index) =>
          `declare var value${index}: ${iface}; value${index}[Symbol.${key}];`,
      )
      .join("\n");
    const messages = await lintTyped(source, {
      available: 0,
      includeWebApis: { preset: "type-aware", only: symbolFixtures.map(([, , id]) => id) },
      includeJsBuiltins: false,
    });
    expect(
      messages.map((message) => [
        message.line,
        message.message.match(/Feature ID: ([\w-]+)\./)?.[1],
      ]),
    ).toEqual(symbolFixtures.map(([, , id], index) => [index + 1, id]));
  });

  it("preserves key identity through native aliases, inheritance, unions and merges", async () => {
    const source = [
      "stream[Symbol.asyncIterator];",
      "stream[Symbol['asyncIterator']];",
      "stream[globalThis.Symbol.asyncIterator];",
      "const preserved: typeof Symbol.asyncIterator = Symbol.asyncIterator;",
      "stream[preserved];",
      "nullable?.[Symbol.asyncIterator];",
      "declare const stream: ReadableStream;",
      "declare const nullable: ReadableStream | null;",
      "class Inherited extends ReadableStream<Uint8Array> {}",
      "declare const inherited: Inherited;",
      "inherited[Symbol.asyncIterator];",
      "function generic<T extends ReadableStream>(value: T) { value[Symbol.asyncIterator]; }",
      "declare const harmless: ReadableStream & { marker: true };",
      "harmless[Symbol.asyncIterator];",
      "declare const union: ReadableStream | { [Symbol.asyncIterator](): number };",
      "union[Symbol.asyncIterator];",
      "declare global { interface SymbolConstructor { readonly asyncIterator: typeof Symbol.asyncIterator; } }",
      "const alias = Symbol;",
      "stream[alias.asyncIterator];",
      "const frozen = { asyncIterator: Symbol.asyncIterator } as const;",
      "stream[frozen.asyncIterator];",
    ].join("\n");
    const messages = await lintTyped(source, streamOptions);
    expect(messages.map((message) => message.line)).toEqual([
      1, 2, 3, 5, 6, 11, 12, 14, 16, 19, 21,
    ]);
    expect(
      messages.every(
        (message) =>
          message.message ===
          "The '[Symbol.asyncIterator]' member of ReadableStream instances does not meet your Baseline 2023 target. Its Baseline year is 2026. Feature ID: async-iterable-streams.",
      ),
    ).toBe(true);
    expect(messages.slice(0, 5)).toMatchObject([
      { line: 1, column: 8, endLine: 1, endColumn: 28 },
      { line: 2, column: 8, endLine: 2, endColumn: 31 },
      { line: 3, column: 8, endLine: 3, endColumn: 39 },
      { line: 5, column: 8, endLine: 5, endColumn: 17 },
      { line: 6, column: 12, endLine: 6, endColumn: 32 },
    ]);
  });

  it("rejects custom keys, widened aliases, own overrides and literal @@ strings", async () => {
    expect(
      await lintTyped(
        `
      declare const custom: { [Symbol.asyncIterator](): number };
      custom[Symbol.asyncIterator];
      declare const customKey: unique symbol;
      declare const indexed: ReadableStream & { [key: symbol]: unknown };
      indexed[customKey];
      function shadow(Symbol: { asyncIterator: typeof customKey }) { indexed[Symbol.asyncIterator]; }
      const widened = Symbol.asyncIterator;
      indexed[widened];
      const { asyncIterator: destructured } = Symbol;
      indexed[destructured];
      const copied = { asyncIterator: Symbol.asyncIterator };
      indexed[copied.asyncIterator];
      class Overridden extends ReadableStream<Uint8Array> {
        [Symbol.asyncIterator](options?: ReadableStreamIteratorOptions): ReadableStreamAsyncIterator<Uint8Array> { throw new Error(); }
      }
      declare const overridden: Overridden;
      overridden[Symbol.asyncIterator];
      declare const conflicting: ReadableStream & { [Symbol.asyncIterator](): number };
      conflicting[Symbol.asyncIterator];
      declare const textual: ReadableStream & { '@@asyncIterator': number };
      textual['@@asyncIterator'];
    `,
        streamOptions,
      ),
    ).toEqual([]);
  });

  it("retains independent domain activation, target and ignore boundaries", async () => {
    const source = "declare const stream: ReadableStream; stream[Symbol.asyncIterator];";
    expect(
      await lintTyped(source, { ...streamOptions, ignoreFeatures: ["async-iterable-streams"] }),
    ).toEqual([]);
    expect(await lintTyped(source, { ...streamOptions, available: 2026 })).toEqual([]);
    expect(
      await lintTyped(source, {
        ...streamOptions,
        includeWebApis: { preset: "safe", only: ["async-iterable-streams"] },
        includeJsBuiltins: { preset: "type-aware" },
      }),
    ).toEqual([]);
    expect(await lintUntyped("stream[Symbol.asyncIterator];", streamOptions)).toEqual([]);
  });
});

describe("buffer maxByteLength options", () => {
  it.each(["ArrayBuffer", "SharedArrayBuffer"])(
    "reports the exact %s constructor and message",
    async (name) => {
      const messages = await lintTyped(`new ${name}(8, { maxByteLength: 16 });`, bufferOptions);
      expect(messages).toHaveLength(1);
      expect(messages[0]).toMatchObject({
        message: `new ${name}(..., { maxByteLength: ... }) does not meet your Baseline 2023 target. Its Baseline year is 2024. Feature ID: resizable-buffers.`,
        line: 1,
        column: 5,
        endLine: 1,
        endColumn: name === "ArrayBuffer" ? 16 : 22,
      });
    },
  );

  it.each(["ArrayBuffer", "SharedArrayBuffer"])(
    "requires a known final defined value for %s",
    async (name) => {
      const cases = [
        "{ maxByteLength: 16 }",
        "{ ['maxByteLength']: 16 }",
        "{ ...options, maxByteLength: 16 }",
        "{ [key]: value, maxByteLength: 16 }",
        "{}",
        "{ maxByteLength: undefined }",
        "{ maxByteLength: void 0 }",
        "{ maxByteLength: unknownNumber }",
        "{ get maxByteLength() { return 16; } }",
        "{ maxByteLength: 16, ...options }",
        "{ maxByteLength: 16, [key]: value }",
        "options",
      ];
      const source = [
        ...cases.map((options) => `new ${name}(8, ${options});`),
        "declare const options: { maxByteLength?: number };",
        "declare const key: string;",
        "declare const value: number;",
        "declare const unknownNumber: number;",
      ].join("\n");
      const messages = await lintTyped(source, bufferOptions);
      expect(messages.map((message) => message.line)).toEqual([1, 2, 3, 4]);
      expect(
        messages.every((message) => message.message.endsWith("Feature ID: resizable-buffers.")),
      ).toBe(true);
    },
  );

  it("keeps ArrayBuffer options available without types and respects duplicate ordering", async () => {
    const messages = await lintUntyped(
      [
        "new ArrayBuffer(8, { maxByteLength: 16 });",
        "new ArrayBuffer(8, { maxByteLength: undefined, maxByteLength: 16 });",
        "new ArrayBuffer(8, { maxByteLength: 16, maxByteLength: undefined });",
        "new ArrayBuffer(8, { maxByteLength() { return 16; } });",
        "new ArrayBuffer(8, { maxByteLength: /16/ });",
        "new ArrayBuffer(8, { maxByteLength: '16' });",
        "new ArrayBuffer(8, { maxByteLength: null });",
      ].join("\n"),
      { ...bufferOptions, includeJsBuiltins: { preset: "safe", only: ["resizable-buffers"] } },
    );
    expect(messages.map((message) => message.line)).toEqual([1, 2, 6, 7]);
  });

  it("keeps SharedArrayBuffer typed-only, ignores shadows and honors reporting policy", async () => {
    const source = "new SharedArrayBuffer(8, { maxByteLength: 16 });";
    expect(await lintUntyped(source, bufferOptions)).toEqual([]);
    expect(
      await lintTyped(source, {
        ...bufferOptions,
        includeJsBuiltins: { preset: "safe", only: ["resizable-buffers"] },
        includeWebApis: { preset: "type-aware" },
      }),
    ).toEqual([]);
    expect(
      await lintTyped(
        `class SharedArrayBuffer { constructor(length: number, options: { maxByteLength: number }) {} } ${source}`,
        bufferOptions,
      ),
    ).toEqual([]);
    expect(await lintTyped(source, { ...bufferOptions, available: 2024 })).toEqual([]);
    expect(
      await lintTyped(source, { ...bufferOptions, ignoreFeatures: ["resizable-buffers"] }),
    ).toEqual([]);
  });

  it("preserves Error cause presence when its value is undefined", async () => {
    const messages = await lintUntyped(
      "new Error('x', { cause: undefined });\nnew AggregateError([], 'x', { cause: undefined });",
      {
        available: 0,
        includeJsBuiltins: { preset: "safe", only: ["error-cause"] },
      },
    );
    expect(
      messages.map((message) => [
        message.line,
        message.message.match(/Feature ID: ([\w-]+)\./)?.[1],
      ]),
    ).toEqual([
      [1, "error-cause"],
      [2, "error-cause"],
    ]);
  });
});
