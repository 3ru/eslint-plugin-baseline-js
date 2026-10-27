import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import parser from "@typescript-eslint/parser";
import { ESLint } from "eslint";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import plugin from "../dist/index.mjs";
import type { CommonRuleOptions } from "../src/config";
import {
  baselineYearOf,
  compatYearPolicyMessage,
  LIMITED_ONLY_YEAR,
  reportingPolicyFor,
  reportingPolicyForCompat,
} from "./utils/policy";

const setCode = [
  "const left = new Set([1, 2]);",
  "const right = new Set([2]);",
  "left.difference(right);",
  "left.union(right);",
  "left.difference;",
].join("\n");

let root: string;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "baseline-diagnostic-subjects-"));
  await writeFile(
    join(root, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: { lib: ["ESNext"], noEmit: true, strict: true, types: [] },
      files: ["sample.ts"],
    }),
  );
  await writeFile(join(root, "sample.ts"), setCode);
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

async function lint(code: string, options: CommonRuleOptions, typed = false) {
  const eslint = new ESLint({
    cwd: root,
    overrideConfigFile: true,
    overrideConfig: {
      files: ["**/*.js", "**/*.ts"],
      languageOptions: {
        ecmaVersion: "latest",
        sourceType: "script",
        ...(typed && {
          parser,
          parserOptions: {
            project: "./tsconfig.json",
            tsconfigRootDir: root,
            disallowAutomaticSingleRunInference: true,
          },
        }),
      },
      plugins: { "baseline-js": plugin },
      rules: { "baseline-js/use-baseline": ["error", options] },
    },
  });

  const [result] = await eslint.lintText(code, { filePath: typed ? "sample.ts" : "sample.js" });
  expect(result.fatalErrorCount).toBe(0);
  expect(result.messages.every((message) => message.ruleId === "baseline-js/use-baseline")).toBe(
    true,
  );

  return result.messages;
}

describe("diagnostic subjects", () => {
  it("distinguishes Set calls and references without widening their diagnostic ranges", async () => {
    const policy = reportingPolicyFor("set-methods");

    const messages = await lint(
      setCode,
      { available: policy, includeJsBuiltins: { preset: "type-aware" } },
      true,
    );

    expect(messages).toHaveLength(3);
    expect(messages).toMatchObject([
      {
        message: `The 'difference' member of Set instances does not meet your Baseline ${policy} target. Its Baseline year is ${baselineYearOf("set-methods")}. Feature ID: set-methods.`,
        line: 3,
        column: 6,
        endLine: 3,
        endColumn: 16,
      },
      {
        message: `The 'union' member of Set instances does not meet your Baseline ${policy} target. Its Baseline year is ${baselineYearOf("set-methods")}. Feature ID: set-methods.`,
        line: 4,
        column: 6,
        endLine: 4,
        endColumn: 11,
      },
      {
        message: `The 'difference' member of Set instances does not meet your Baseline ${policy} target. Its Baseline year is ${baselineYearOf("set-methods")}. Feature ID: set-methods.`,
        line: 5,
        column: 6,
        endLine: 5,
        endColumn: 16,
      },
    ]);
  });

  it.each([
    ["Promise.try(() => 42);", "promise-try", "'Promise.try'"],
    ["structuredClone({});", "structured-clone", "'structuredClone'"],
    ["new BroadcastChannel('events');", "broadcast-channel", "'BroadcastChannel'"],
  ])("names the API in %s", async (code, id, subject) => {
    const policy = reportingPolicyFor(id);

    const messages = await lint(code, {
      available: policy,
      includeJsBuiltins: { preset: "safe", only: [id] },
      includeWebApis: { preset: "safe", only: [id] },
    });

    expect(messages).toHaveLength(1);
    expect(messages[0].message).toBe(
      `${subject} does not meet your Baseline ${policy} target. Its Baseline year is ${baselineYearOf(id)}. Feature ID: ${id}.`,
    );
  });

  it("does not render scalar properties as calls", async () => {
    const messages = await lint("window.devicePixelRatio;", {
      available: reportingPolicyFor("devicepixelratio"),
      includeWebApis: { preset: "safe", only: ["devicepixelratio"] },
    });

    expect(messages).toHaveLength(1);
    expect(messages[0].message.startsWith("'window.devicePixelRatio' ")).toBe(true);
    expect(messages[0].message.endsWith("Feature ID: devicepixelratio.")).toBe(true);
  });

  it("names typed own properties and methods without claiming prototype ownership", async () => {
    const code = ["var pattern = /value/g;", "pattern.lastIndex;", "pattern.exec('value');"].join(
      "\n",
    );
    const policy = reportingPolicyForCompat("regexp", "javascript.builtins.RegExp.lastIndex");
    const messages = await lint(
      code,
      { available: policy, includeJsBuiltins: { preset: "type-aware", only: ["regexp"] } },
      true,
    );

    expect(messages).toHaveLength(2);
    expect(messages).toMatchObject([
      {
        message: compatYearPolicyMessage(
          "regexp",
          "javascript.builtins.RegExp.lastIndex",
          policy,
          "The 'lastIndex' member of RegExp instances",
        ),
        line: 2,
        column: 9,
        endLine: 2,
        endColumn: 18,
      },
      {
        message: compatYearPolicyMessage(
          "regexp",
          "javascript.builtins.RegExp.exec",
          policy,
          "The 'exec' member of RegExp instances",
        ),
        line: 3,
        column: 9,
        endLine: 3,
        endColumn: 13,
      },
    ]);
  });

  it.each([
    [
      "new Worker('worker.js', { type: 'module' });",
      "js-modules-workers",
      'new Worker(..., { type: "module" })',
    ],
    [
      "canvas.getContext('2d', { alpha: true });",
      "canvas-2d-alpha",
      'getContext("2d", { alpha: ... })',
    ],
    [
      "gl.getSupportedExtensions().includes('EXT_sRGB');",
      "ext-srgb",
      'getSupportedExtensions().includes("EXT_sRGB")',
    ],
    [
      "canvas.getContext('experimental-webgl', { desynchronized: true });",
      "webgl-desynchronized",
      'getContext("webgl" | "experimental-webgl", { desynchronized: ... })',
    ],
  ])("identifies the call pattern in %s", async (code, id, subject) => {
    const messages = await lint(code, {
      available: reportingPolicyFor(id),
      includeJsBuiltins: false,
      includeWebApis: { preset: "safe", only: [id] },
    });

    expect(messages).toHaveLength(1);
    expect(messages[0].message.startsWith(`${subject} `)).toBe(true);
    expect(messages[0].message.endsWith(`Feature ID: ${id}.`)).toBe(true);
  });

  it.each([
    ["widely", "Widely"],
    ["newly", "Newly"],
  ] as const)("distinguishes deprecated Date methods under %s", async (available, label) => {
    const messages = await lint("new Date().getYear();\nnew Date().setYear(99);", { available });
    expect(messages.map((message) => message.message)).toEqual([
      `'Date.prototype.getYear' does not meet your Baseline ${label} available target. It has Limited availability. Feature ID: date-get-year-set-year.`,
      `'Date.prototype.setYear' does not meet your Baseline ${label} available target. It has Limited availability. Feature ID: date-get-year-set-year.`,
    ]);
  });

  it("keeps the API subject for Limited availability under a year policy", async () => {
    const messages = await lint("new Date().getYear();", { available: LIMITED_ONLY_YEAR });
    expect(messages.map((message) => message.message)).toEqual([
      `'Date.prototype.getYear' does not meet your Baseline ${LIMITED_ONLY_YEAR} target. It has Limited availability. Feature ID: date-get-year-set-year.`,
    ]);
  });

  it("keeps Date subjects and ranges consistent for calls, references, and destructuring", async () => {
    const code = [
      "const date = new Date();",
      "date.getYear();",
      "const readYear = date.getYear;",
      "const { getYear } = date;",
    ].join("\n");

    const messages = await lint(code, { available: "widely" });

    const message =
      "'Date.prototype.getYear' does not meet your Baseline Widely available target. It has Limited availability. Feature ID: date-get-year-set-year.";

    expect(messages).toHaveLength(3);
    expect(messages).toMatchObject([
      { message, line: 2, column: 1, endLine: 2, endColumn: 13 },
      { message, line: 3, column: 18, endLine: 3, endColumn: 30 },
      { message, line: 4, column: 9, endLine: 4, endColumn: 16 },
    ]);
  });

  it("uses the same member format for delegated static APIs", async () => {
    const policy = reportingPolicyFor("object-hasown");

    const messages = await lint("Object.hasOwn({}, 'key');", {
      available: policy,
      includeJsBuiltins: false,
      includeWebApis: false,
    });

    expect(messages.map((message) => message.message)).toEqual([
      `'Object.hasOwn' does not meet your Baseline ${policy} target. Its Baseline year is ${baselineYearOf("object-hasown")}. Feature ID: object-hasown.`,
    ]);
  });

  it("keeps a meaningful feature name when syntax has no API subject", async () => {
    const messages = await lint("with (object) {}", { available: "widely" });
    expect(messages.map((message) => message.message)).toEqual([
      "'with' does not meet your Baseline Widely available target. It has Limited availability. Feature ID: with.",
    ]);
  });

  it.each([{ ignoreFeatures: ["set-methods"] }, { ignoreNodeTypes: ["Identifier"] }])(
    "preserves descriptor ignores: %j",
    async (ignore) => {
      const options: CommonRuleOptions = {
        available: reportingPolicyFor("set-methods"),
        includeJsBuiltins: { preset: "type-aware" },
      };

      await expect(lint(setCode, options, true)).resolves.toHaveLength(3);
      await expect(lint(setCode, { ...options, ...ignore }, true)).resolves.toEqual([]);
    },
  );
});
