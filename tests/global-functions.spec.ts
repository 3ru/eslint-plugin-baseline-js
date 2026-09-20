import type { Rule } from "eslint";
import { RuleTester } from "eslint";
import { describe, it } from "vitest";
import plugin from "../dist/index.mjs";
import { baselineYearOf, reportingPolicyFor, yearPolicyMessage } from "./utils/policy";

/**
 * Tests for global function detection (callGlobal descriptor).
 * Verifies Issue #59: structuredClone detection.
 *
 * Policies and expected messages are derived from each feature's bundled
 * record, so the cases keep testing detection, shadowing and the year-policy
 * boundary whatever the current Baseline data says.
 */

const rule = (plugin as unknown as { rules: Record<string, Rule.RuleModule> }).rules[
  "use-baseline"
] as Rule.RuleModule;

const tester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: "module",
  },
});

const safe = { preset: "safe" } as const;

describe("global function detection (callGlobal)", () => {
  it("detects structuredClone (Issue #59)", () => {
    const policy = reportingPolicyFor("structured-clone");
    tester.run("baseline-js/use-baseline (structuredClone)", rule, {
      valid: [
        {
          // a year policy equal to the Baseline year does not report
          code: "structuredClone({ a: 1 });",
          options: [{ available: baselineYearOf("structured-clone"), includeWebApis: safe }],
        },
        {
          // Shadowed global in module scope should not report
          code: "function structuredClone() { return 1; } structuredClone({ a: 1 });",
          options: [{ available: policy, includeWebApis: safe }],
        },
        {
          // Shadowed global in script scope should not report
          code: "var structuredClone = () => {}; structuredClone({ a: 1 });",
          options: [{ available: policy, includeWebApis: safe }],
          languageOptions: { ecmaVersion: 2022, sourceType: "script" },
        },
      ],
      invalid: [
        {
          // a year policy before the Baseline year reports with the year message
          code: "structuredClone({ a: 1 });",
          options: [{ available: policy, includeWebApis: safe }],
          errors: [{ message: yearPolicyMessage("structured-clone", policy) }],
        },
      ],
    });
  });

  it("detects queueMicrotask", () => {
    const policy = reportingPolicyFor("queuemicrotask");
    tester.run("baseline-js/use-baseline (queueMicrotask)", rule, {
      valid: [
        {
          // a year policy equal to the Baseline year does not report
          code: "queueMicrotask(callback);",
          options: [{ available: baselineYearOf("queuemicrotask"), includeWebApis: safe }],
        },
        {
          // Shadowed import should not report
          code: "import { queueMicrotask } from 'x'; queueMicrotask(cb);",
          options: [{ available: policy, includeWebApis: safe }],
        },
        {
          // Shadowed global in script scope should not report
          code: "var queueMicrotask = () => {}; queueMicrotask(cb);",
          options: [{ available: policy, includeWebApis: safe }],
          languageOptions: { ecmaVersion: 2022, sourceType: "script" },
        },
      ],
      invalid: [
        {
          code: "queueMicrotask(callback);",
          options: [{ available: policy, includeWebApis: safe }],
          errors: [{ message: yearPolicyMessage("queuemicrotask", policy) }],
        },
      ],
    });
  });
});
