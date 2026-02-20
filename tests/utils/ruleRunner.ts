import type { Rule } from "eslint";
import plugin from "../../dist/index.mjs";
import { RuleTester } from "../compat";

export function makeRuleTester(opts?: { ecmaVersion?: number; sourceType?: "script" | "module" }) {
  return new RuleTester({
    languageOptions: {
      ecmaVersion: opts?.ecmaVersion || 2022,
      sourceType: opts?.sourceType ?? "module",
    },
  });
}

export const useBaselineRule = (plugin as unknown as { rules: Record<string, Rule.RuleModule> })
  .rules["use-baseline"] as Rule.RuleModule;
