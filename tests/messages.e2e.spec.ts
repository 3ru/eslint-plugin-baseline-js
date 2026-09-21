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

// Each case uses a feature that web-features marks as discouraged. Discouraged
// features never leave Limited availability, so the exact "not a widely
// available" wording asserted here cannot go stale as the data is refreshed.
describe("Baseline messages are unified across delegates", () => {
  it("es-x delegate: uses Baseline message", () => {
    tester.run("es-x message", rule, {
      valid: [],
      invalid: [
        {
          code: "'x'.bold();",
          options: [{ available: "widely" }],
          errors: [
            {
              message:
                "Feature 'HTML wrapper methods' (html-wrapper-methods) is not a widely available Baseline feature.",
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
          code: "function f() {} const x = f.caller;",
          options: [{ available: "widely" }],
          errors: [
            {
              message:
                "Feature 'Function caller and arguments' (functions-caller-arguments) is not a widely available Baseline feature.",
            },
          ],
        },
      ],
    });
  });
});
