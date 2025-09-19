import type { Rule } from "eslint";
import esx from "eslint-plugin-es-x";
import { getEsxRule, resolveEsxRulesFrom } from "./rule-resolver";

type RuleMap = Record<string, Rule.RuleModule>;

let selfRules: RuleMap | null = null;

export function registerSelfRules(rules: RuleMap) {
  selfRules = rules;
}

function resolveEsx(name: string): Rule.RuleModule | undefined {
  const rules = resolveEsxRulesFrom(esx);
  return rules?.[name] || getEsxRule(name);
}

const registry: Record<string, (ruleName: string) => Rule.RuleModule | undefined> = {
  "es-x": resolveEsx,
  self: (name) => (selfRules ? selfRules[name] : undefined),
};

export function resolveDelegateRule(plugin: string, name: string): Rule.RuleModule | undefined {
  const resolver = registry[plugin];
  if (!resolver) return undefined;
  return resolver(name);
}
