import { createRequire } from "node:module";
import type { Rule } from "eslint";

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

/**
 * Resolve rules for eslint-plugin-es-x in a robust way.
 * Why: In CI (Node 22 / ESLint 9), ESM interop may attach rules under
 * `default.rules` instead of `rules`. Only checking `esx.rules` meant no
 * delegates were created and tests failed.
 * Approach: Prefer loading the CommonJS entry via `createRequire` to avoid
 * interop variance, then normalize the export with `resolvePluginRules()`.
 */
export function resolveEsxRules(): Record<string, Rule.RuleModule> | undefined {
  // Prefer requiring the CJS entry directly to avoid ESM interop variance.
  try {
    const req = createRequire(import.meta.url);
    const m = req("eslint-plugin-es-x");
    const rules = resolvePluginRules(m);
    if (rules) return rules;
  } catch {
    // ignore
  }
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
