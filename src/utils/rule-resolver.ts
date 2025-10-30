import type { Rule } from "eslint";
import { requireOptional } from "./optional-module";

/**
 * Normalize ESM/CJS export shapes for ESLint plugins.
 * Some toolchains expose plugins as `{ rules }` or under `{ default: { rules } }`.
 * This helper selects whichever shape is present and returns the rules map.
 */
export function resolvePluginRules(mod: unknown): Record<string, Rule.RuleModule> | undefined {
  if (!mod || (typeof mod !== "object" && typeof mod !== "function")) return undefined;
  const m = mod as { rules?: unknown; default?: { rules?: unknown } };
  const rules = (m.rules ?? m.default?.rules) as Record<string, Rule.RuleModule> | undefined;
  if (rules && typeof rules === "object") return rules;
  return undefined;
}

/** Resolve eslint-plugin-es-x rules, handling ESM/CJS export variance. */
export function resolveEsxRules(): Record<string, Rule.RuleModule> | undefined {
  const pluginName = "eslint-plugin-es-x";
  const mod = requireOptional(pluginName);
  if (mod === undefined) return undefined;
  const rules = resolvePluginRules(mod);
  if (rules) return rules;
  return undefined;
}

/**
 * Try resolving es-x rules from a provided module first (ESM import),
 * then fall back to the CommonJS `require` path if needed.
 */
export function resolveEsxRulesFrom(mod?: unknown): Record<string, Rule.RuleModule> | undefined {
  const fromImport = mod ? resolvePluginRules(mod) : undefined;
  if (fromImport) return fromImport;
  return resolveEsxRules();
}

export function getEsxRule(name: string): Rule.RuleModule | undefined {
  if (!esxRulesResolved) {
    esxRulesCache = resolveEsxRules();
    esxRulesResolved = true;
  }
  return esxRulesCache?.[name];
}

let esxRulesCache: Record<string, Rule.RuleModule> | undefined;
let esxRulesResolved = false;
