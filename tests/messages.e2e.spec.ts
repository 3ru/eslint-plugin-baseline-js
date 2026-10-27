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
          code: "'x'.bold();",
          options: [{ available: "widely" }],
          errors: [
            {
              message:
                "'String.prototype.bold' does not meet your Baseline Widely available target. It has Limited availability. Feature ID: html-wrapper-methods.",
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
              message:
                "'with' does not meet your Baseline Widely available target. It has Limited availability. Feature ID: with.",
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
                "'Function caller and arguments' does not meet your Baseline Widely available target. It has Limited availability. Feature ID: functions-caller-arguments.",
            },
          ],
        },
      ],
    });
  });
});
