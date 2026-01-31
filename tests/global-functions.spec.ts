import type { Rule } from "eslint";
import { RuleTester } from "eslint";
import { describe, it } from "vitest";
import plugin from "../dist/index.mjs";

/**
 * Tests for global function detection (callGlobal descriptor).
 * Verifies Issue #59: structuredClone detection.
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

describe("global function detection (callGlobal)", () => {
  it("detects structuredClone (Issue #59)", () => {
    tester.run("baseline-js/use-baseline (structuredClone)", rule, {
      valid: [
        {
          // structuredClone is baseline widely 2022, so year >= 2022 should not report
          code: "structuredClone({ a: 1 });",
          options: [{ available: 2022, includeWebApis: { preset: "safe" } }],
        },
        {
          // 'widely' should not flag structuredClone (it's baseline high)
          code: "structuredClone(obj);",
          options: [{ available: "widely", includeWebApis: { preset: "safe" } }],
        },
      ],
      invalid: [
        {
          // structuredClone became baseline in 2022, so year 2015 should report
          code: "structuredClone({ a: 1 });",
          options: [{ available: 2015, includeWebApis: { preset: "safe" } }],
          errors: [{ message: /Feature 'structuredClone\(\)' \(structured-clone\).*2022.*2015/i }],
        },
        {
          // structuredClone with year 2021 should report
          code: "structuredClone(data);",
          options: [{ available: 2021, includeWebApis: { preset: "safe" } }],
          errors: [{ message: /Feature 'structuredClone\(\)' \(structured-clone\).*2022.*2021/i }],
        },
      ],
    });
  });

  it("detects queueMicrotask", () => {
    tester.run("baseline-js/use-baseline (queueMicrotask)", rule, {
      valid: [
        {
          // queueMicrotask is baseline widely 2020, so year >= 2020 should not report
          code: "queueMicrotask(callback);",
          options: [{ available: 2020, includeWebApis: { preset: "safe" } }],
        },
        {
          // 'widely' should not flag queueMicrotask (it's baseline high)
          code: "queueMicrotask(fn);",
          options: [{ available: "widely", includeWebApis: { preset: "safe" } }],
        },
      ],
      invalid: [
        {
          // queueMicrotask became baseline in 2020, so year 2019 should report
          code: "queueMicrotask(callback);",
          options: [{ available: 2019, includeWebApis: { preset: "safe" } }],
          errors: [{ message: /Feature 'queueMicrotask\(\)' \(queuemicrotask\).*2020.*2019/i }],
        },
      ],
    });
  });
});
