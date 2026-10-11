import { promises as fs } from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { ESLint } from "eslint";
import ts from "typescript";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CommonRuleOptions } from "../src/config";
import { reportingPolicyFor } from "./utils/policy";

const webFeatures = ["check-visibility", "abortsignal-any"];
const jsFeatures = ["set-methods", "array-group"];
const safeFeatures = ["abortsignal-any", "array-group"];
const cases: Array<{
  name: string;
  web: CommonRuleOptions["includeWebApis"];
  js: CommonRuleOptions["includeJsBuiltins"];
  ignoreFeatures?: string[];
  expected: string[];
}> = [
  {
    name: "Web safe and JS typed",
    web: { preset: "safe", only: webFeatures },
    js: { preset: "type-aware", only: jsFeatures },
    expected: ["set-methods", ...safeFeatures],
  },
  {
    name: "Web typed and JS safe",
    web: { preset: "type-aware", only: webFeatures },
    js: { preset: "safe", only: jsFeatures },
    expected: ["check-visibility", ...safeFeatures],
  },
  {
    name: "both domains typed",
    web: { preset: "type-aware", only: webFeatures },
    js: { preset: "type-aware", only: jsFeatures },
    expected: ["check-visibility", "set-methods", ...safeFeatures],
  },
  {
    name: "both domains safe",
    web: { preset: "safe", only: webFeatures },
    js: { preset: "safe", only: jsFeatures },
    expected: safeFeatures,
  },
  {
    name: "explicit Web types off overrides its preset",
    web: { preset: "type-aware", useTypes: "off", only: webFeatures },
    js: { preset: "type-aware", only: jsFeatures },
    expected: ["set-methods", ...safeFeatures],
  },
  {
    name: "boolean Web inclusion stays safe when JS uses types",
    web: true,
    js: { preset: "type-aware", only: jsFeatures },
    expected: ["set-methods", ...safeFeatures],
  },
  {
    name: "domain only filters",
    web: { preset: "type-aware", only: ["abortsignal-any"] },
    js: { preset: "type-aware", only: ["array-group"] },
    expected: safeFeatures,
  },
  {
    name: "domain ignore filters",
    web: { preset: "type-aware", only: webFeatures, ignore: ["check-visibility"] },
    js: { preset: "type-aware", only: jsFeatures, ignore: ["set-methods"] },
    expected: safeFeatures,
  },
  {
    name: "global ignore filters",
    web: { preset: "type-aware", only: webFeatures },
    js: { preset: "type-aware", only: jsFeatures },
    ignoreFeatures: ["check-visibility", "set-methods"],
    expected: safeFeatures,
  },
];

describe("independent Web API and JS builtin type options", () => {
  let root: string;
  let samplePath: string;
  let tsconfigPath: string;
  let configPath: string;

  beforeAll(async () => {
    root = await fs.mkdtemp(join(os.tmpdir(), "baseline-js-type-options-"));
    samplePath = join(root, "sample.ts");
    tsconfigPath = join(root, "tsconfig.json");
    configPath = join(root, "eslint.config.mjs");
    await fs.writeFile(
      samplePath,
      `
        declare const element: Element;
        element.checkVisibility();
        declare const values: Set<unknown>;
        values.union(new Set());
        AbortSignal.any([]);
        Object.groupBy([], String);
        export {};
      `,
    );
    await fs.writeFile(
      tsconfigPath,
      JSON.stringify({
        compilerOptions: {
          target: "ESNext",
          module: "ESNext",
          moduleResolution: "Bundler",
          lib: ["ESNext", "DOM"],
          noEmit: true,
          strict: true,
          skipLibCheck: true,
        },
        include: ["sample.ts"],
      }),
    );
    await fs.writeFile(configPath, "export default [{}];\n");
    const program = ts.createProgram([samplePath], {
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      lib: ["lib.esnext.d.ts", "lib.dom.d.ts"],
      noEmit: true,
      strict: true,
      skipLibCheck: true,
    });
    expect(
      ts
        .getPreEmitDiagnostics(program)
        .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")),
    ).toEqual([]);
  });

  afterAll(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it.each(cases)("respects $name", async ({ web, js, ignoreFeatures, expected }) => {
    const parser = (await import("@typescript-eslint/parser")).default;
    const plugin = (await import("../dist/index.mjs")).default;
    const eslint = new ESLint({
      cwd: root,
      overrideConfigFile: configPath,
      overrideConfig: [
        {
          files: ["**/*.ts"],
          languageOptions: {
            parser,
            parserOptions: {
              project: [tsconfigPath],
              tsconfigRootDir: root,
              // These repeated config checks are separate lint passes, not an autofix cycle.
              disallowAutomaticSingleRunInference: true,
            },
          },
          plugins: { "baseline-js": plugin },
          rules: {
            "baseline-js/use-baseline": [
              "error",
              {
                available: reportingPolicyFor(...webFeatures, ...jsFeatures),
                includeWebApis: web,
                includeJsBuiltins: js,
                ignoreFeatures,
              },
            ],
          },
        },
      ],
    });
    const results = await eslint.lintFiles([samplePath]);
    expect(results.flatMap((result) => result.messages).some((message) => message.fatal)).toBe(
      false,
    );
    const messages = results
      .flatMap((result) => result.messages)
      .filter((message) => message.ruleId === "baseline-js/use-baseline");
    expect(messages.map((message) => message.message.match(/\(([^)]+)\)\.$/)?.[1])).toEqual(
      expected,
    );
  });
});
