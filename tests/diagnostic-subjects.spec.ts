import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import parser from "@typescript-eslint/parser";
import { ESLint } from "eslint";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import plugin from "../dist/index.mjs";
import type { CommonRuleOptions } from "../src/config";
import { baselineYearOf, LIMITED_ONLY_YEAR, reportingPolicyFor } from "./utils/policy";

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
        message: `'difference' on Set became Baseline in ${baselineYearOf("set-methods")} and exceeds ${policy} (set-methods).`,
        line: 3,
        column: 6,
        endLine: 3,
        endColumn: 16,
      },
      {
        message: `'union' on Set became Baseline in ${baselineYearOf("set-methods")} and exceeds ${policy} (set-methods).`,
        line: 4,
        column: 6,
        endLine: 4,
        endColumn: 11,
      },
      {
        message: `'difference' on Set became Baseline in ${baselineYearOf("set-methods")} and exceeds ${policy} (set-methods).`,
        line: 5,
        column: 6,
        endLine: 5,
        endColumn: 16,
      },
    ]);
  });

  it.each([
    ["Promise.try(() => 42);", "promise-try", "'try' on Promise"],
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
      `${subject} became Baseline in ${baselineYearOf(id)} and exceeds ${policy} (${id}).`,
    );
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
    expect(messages[0].message.endsWith(`(${id}).`)).toBe(true);
  });

  it.each([
    ["widely", "Widely"],
    ["newly", "Newly"],
  ] as const)("distinguishes deprecated Date methods under %s", async (available, label) => {
    const messages = await lint("new Date().getYear();\nnew Date().setYear(99);", { available });
    expect(messages.map((message) => message.message)).toEqual([
      `'Date.prototype.getYear' is not Baseline ${label} available (date-get-year-set-year).`,
      `'Date.prototype.setYear' is not Baseline ${label} available (date-get-year-set-year).`,
    ]);
  });

  it("keeps the API subject for Limited availability under a year policy", async () => {
    const messages = await lint("new Date().getYear();", { available: LIMITED_ONLY_YEAR });
    expect(messages.map((message) => message.message)).toEqual([
      `'Date.prototype.getYear' has Limited availability and exceeds ${LIMITED_ONLY_YEAR} (date-get-year-set-year).`,
    ]);
  });

  it("keeps a meaningful feature name when syntax has no API subject", async () => {
    const messages = await lint("with (object) {}", { available: "widely" });
    expect(messages.map((message) => message.message)).toEqual([
      "'with' is not Baseline Widely available (with).",
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
