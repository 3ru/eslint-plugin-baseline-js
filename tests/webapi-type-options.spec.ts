import { promises as fs } from "node:fs";
import ts from "typescript";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CommonRuleOptions } from "../src/config";
import { reportingPolicyFor } from "./utils/policy";
import { createTypedFixture, lintTypedFixture, type TypedFixture } from "./utils/typed-fixture";

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
  let fixture: TypedFixture;

  beforeAll(async () => {
    fixture = await createTypedFixture(
      `
      declare const element: Element;
      element.checkVisibility();
      declare const values: Set<unknown>;
      values.union(new Set());
      AbortSignal.any([]);
      Object.groupBy([], String);
    `,
      { target: "ESNext" },
    );
    const program = ts.createProgram([fixture.samplePath], fixture.compilerOptions);
    expect(
      ts
        .getPreEmitDiagnostics(program)
        .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")),
    ).toEqual([]);
  });

  afterAll(async () => {
    await fs.rm(fixture.root, { recursive: true, force: true });
  });

  it.each(cases)("respects $name", async ({ web, js, ignoreFeatures, expected }) => {
    const messages = await lintTypedFixture(fixture, {
      available: reportingPolicyFor(...webFeatures, ...jsFeatures),
      includeWebApis: web,
      includeJsBuiltins: js,
      ignoreFeatures,
    });
    expect(messages.some((message) => message.fatal)).toBe(false);
    expect(
      messages
        .filter((message) => message.ruleId === "baseline-js/use-baseline")
        .map((message) => message.message.match(/\(([^)]+)\)\.$/)?.[1]),
    ).toEqual(expected);
  });
});
