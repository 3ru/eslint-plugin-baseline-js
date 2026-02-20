/**
 * Representative E2E tests inspired by eslint-plugin-compat strategy.
 * - Cover typical patterns instead of exhaustively generating every case
 * - Verify rule behavior for baseline buckets and include* flags
 */

import type { Rule } from "eslint";
import { describe, it } from "vitest";
import plugin from "../dist/index.mjs";
import { RuleTester } from "./compat";

const rule = (plugin as unknown as { rules: Record<string, Rule.RuleModule> }).rules[
  "use-baseline"
] as Rule.RuleModule;

const tester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: "script",
  },
});

describe("use-baseline e2e", () => {
  it("runs representative RuleTester suites", () => {
    tester.run("baseline-js/use-baseline (syntax, available: widely)", rule, {
      valid: [
        {
          // nullish coalescing is Baseline widely → no report
          code: "const x = a ?? b;",
        },
      ],
      invalid: [
        {
          // Temporal is Baseline limited → should report
          code: "Temporal.Now.instant();",
          errors: [{ message: /Feature '.*' \(temporal\).*Baseline/i }],
          options: [{ available: "widely" }],
        },
        {
          // Atomics.waitAsync is Baseline limited → should report
          code: "Atomics.waitAsync();",
          errors: [{ message: /Feature '.*' \(atomics-wait-async\).*Baseline/i }],
          options: [{ available: "widely" }],
        },
        {
          // with statement is discouraged/limited → should report
          code: "with (obj) { const a = 1; }",
          errors: [{ message: /Feature '.*' \(with\).*Baseline/i }],
          options: [{ available: "widely" }],
        },
      ],
    });

    tester.run("baseline-js/use-baseline (Web API safe patterns via includeWebApis)", rule, {
      valid: [
        {
          // By default (no includeWebApis), AbortSignal.any is not checked → no report
          code: "AbortSignal.any([]);",
          options: [{ available: "widely" }],
        },
      ],
      invalid: [
        {
          // includeWebApis: safe → AbortSignal.any() is Baseline newly → should report
          code: "AbortSignal.any([]);",
          options: [{ available: "widely", includeWebApis: { preset: "safe" } }],
          errors: [{ message: /Feature '.*' \(abortsignal-any\).*Baseline/i }],
        },
      ],
    });
  });
});
