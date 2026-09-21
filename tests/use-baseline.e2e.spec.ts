/**
 * Representative E2E tests inspired by eslint-plugin-compat strategy.
 * - Cover typical patterns instead of exhaustively generating every case
 * - Verify rule behavior for baseline buckets and include* flags
 */

import type { Rule } from "eslint";
import { RuleTester } from "eslint";
import { describe, it } from "vitest";
import plugin from "../dist/index.mjs";
import { reportingPolicyFor } from "./utils/policy";

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
    tester.run("baseline-js/use-baseline (syntax)", rule, {
      valid: [
        {
          // nullish coalescing is Baseline widely → no report under the default policy
          code: "const x = a ?? b;",
        },
      ],
      invalid: [
        {
          // self delegate (Temporal), reported whatever its current Baseline status is
          code: "Temporal.Now.instant();",
          errors: [{ message: /\(temporal\)/ }],
          options: [{ available: reportingPolicyFor("temporal") }],
        },
        {
          // es-x delegate (Atomics.waitAsync), reported whatever its current Baseline status is
          code: "Atomics.waitAsync();",
          errors: [{ message: /\(atomics-wait-async\)/ }],
          options: [{ available: reportingPolicyFor("atomics-wait-async") }],
        },
        {
          // with statement is discouraged, so it stays Limited → reported under widely
          code: "with (obj) { const a = 1; }",
          errors: [{ message: /Feature '.*' \(with\).*Baseline/i }],
          options: [{ available: "widely" }],
        },
      ],
    });

    tester.run("baseline-js/use-baseline (Web API safe patterns via includeWebApis)", rule, {
      valid: [
        {
          // By default (no includeWebApis), AbortSignal.any is not checked → no report,
          // even under a policy that would otherwise report abortsignal-any
          code: "AbortSignal.any([]);",
          options: [{ available: reportingPolicyFor("abortsignal-any") }],
        },
      ],
      invalid: [
        {
          // includeWebApis: safe → AbortSignal.any() is detected and mapped to abortsignal-any
          code: "AbortSignal.any([]);",
          options: [
            {
              available: reportingPolicyFor("abortsignal-any"),
              includeWebApis: { preset: "safe" },
            },
          ],
          errors: [{ message: /\(abortsignal-any\)/ }],
        },
      ],
    });
  });
});
