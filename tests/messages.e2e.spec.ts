import type { Rule } from "eslint";
import { RuleTester } from "eslint";
import { describe, it } from "vitest";
import plugin from "../dist/index.mjs";

const rule = (plugin as unknown as { rules: Record<string, Rule.RuleModule> }).rules[
  "use-baseline"
] as Rule.RuleModule;

const tester = new RuleTester({
  languageOptions: { ecmaVersion: 2022, sourceType: "script" },
});

describe("Baseline messages are unified across delegates", () => {
  it("es-x delegate: uses Baseline message", () => {
    tester.run("es-x message", rule, {
      valid: [],
      invalid: [
        {
          code: "Atomics.waitAsync();",
          options: [{ available: "widely" }],
          errors: [
            {
              message:
                "Feature 'Atomics.waitAsync()' (atomics-wait-async) is not a widely available Baseline feature.",
            },
          ],
        },
      ],
    });
  });

  it("core delegate: uses Baseline message", () => {
    tester.run("core message", rule, {
      valid: [],
      invalid: [
        {
          code: "with (obj) { const a = 1; }",
          options: [{ available: "widely" }],
          errors: [
            {
              message: "Feature 'with' (with) is not a widely available Baseline feature.",
            },
          ],
        },
      ],
    });
  });

  it("self delegate: uses Baseline message", () => {
    tester.run("self message", rule, {
      valid: [],
      invalid: [
        {
          code: "Temporal.Now.instant();",
          options: [{ available: "widely" }],
          errors: [
            {
              message: "Feature 'Temporal' (temporal) is not a widely available Baseline feature.",
            },
          ],
        },
      ],
    });
  });
});
