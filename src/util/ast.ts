import type { Rule, Scope } from "eslint";

export function isUnboundIdentifier(
  context: Rule.RuleContext,
  name: string,
  refNode?: unknown,
): boolean {
  const sc = context.sourceCode.scopeManager;
  let scope = refNode ? sc.acquire(refNode as Rule.Node) : sc.globalScope;
  while (scope) {
    if (scope.set.has(name)) return false;
    scope = scope.upper;
  }
  return true;
}

/**
 * Checks if an identifier refers to the global (not shadowed by a local declaration).
 * Unlike isUnboundIdentifier, this treats global built-ins (like Atomics, structuredClone)
 * as allowed, while still respecting explicit global declarations that shadow them.
 *
 * @param context - The ESLint rule context
 * @param name - The identifier name to check
 * @param parentNode - The parent node (CallExpression or MemberExpression)
 */
export function isGlobalNotShadowed(
  context: Rule.RuleContext,
  name: string,
  parentNode: unknown,
): boolean {
  let scope: Scope.Scope | null = context.sourceCode.getScope(parentNode as Rule.Node);
  while (scope) {
    const variable = scope.set.get(name);
    if (variable) {
      if (scope.type !== "global") return false; // Shadowed by local declaration
      // In script files, top-level `var`/`function` live in global scope.
      // Only treat them as shadowing when ESLint marks them with defs; built-ins have none.
      if (variable.defs.length > 0) return false;
      return true;
    }
    scope = scope.upper;
  }
  return true;
}

export function isGlobalBase(_context: Rule.RuleContext, node: unknown, baseName: string): boolean {
  if (!node) return false;
  const id = node as { type?: string; name?: string };
  if (id.type === "Identifier" && id.name === baseName) {
    // Treat matching identifiers as global base by default.
    // Shadowing avoidance can be added per-rule if needed.
    return true;
  }
  const me = node as { type?: string; computed?: boolean; object?: unknown; property?: unknown };
  if (me.type === "MemberExpression" && me.computed === false) {
    const obj = me.object as { type?: string; name?: string } | undefined;
    const prop = me.property as { type?: string; name?: string } | undefined;
    const isWin =
      obj?.type === "Identifier" && (obj.name === "window" || obj.name === "globalThis");
    if (!isWin) return false;
    return prop?.type === "Identifier" && prop.name === baseName;
  }
  return false;
}

export function isMemberWithProperty(node: unknown, propName: string): boolean {
  const me = node as { type?: string; computed?: boolean; property?: unknown };
  if (!me || me.type !== "MemberExpression" || me.computed) return false;
  const prop = me.property as { type?: string; name?: string } | undefined;
  return prop?.type === "Identifier" && prop.name === propName;
}

// --- Additional lightweight AST helpers for safe argument-based detection ---

export function stripChain(node: unknown): unknown {
  const n = node as { type?: string; expression?: unknown };
  if (n && n.type === "ChainExpression") return n.expression;
  return node;
}

export function isMemberName(node: unknown, name: string): boolean {
  const me = node as { type?: string; computed?: boolean; property?: unknown };
  const prop = me?.property as { type?: string; name?: string; value?: unknown } | undefined;
  if (!me || me.type !== "MemberExpression") return false;
  if (!me.computed) return prop?.type === "Identifier" && prop.name === name;
  return prop?.type === "Literal" && String(prop.value) === name;
}

export function getMemberPropertyNode(node: unknown): unknown | null {
  const me = node as { type?: string; property?: unknown };
  return me && me.type === "MemberExpression" ? (me.property ?? null) : null;
}

export function getCallStringArg(call: unknown, index: number): string | null {
  const args = (call as { arguments?: unknown[] }).arguments || [];
  const a = args[index] as { type?: string; value?: unknown } | undefined;
  if (!a) return null;
  if (a.type === "Literal" && typeof a.value === "string") return a.value as string;
  return null; // conservative: only plain string literals
}

export function getCallObjectArg(call: unknown, index: number): unknown | null {
  const args = (call as { arguments?: unknown[] }).arguments || [];
  const a = args[index] as { type?: string } | undefined;
  if (!a) return null;
  if (a.type === "ObjectExpression") return a;
  return null;
}

export function objectHasKey(obj: unknown, key: string): boolean {
  const o = obj as { type?: string; properties?: unknown[] };
  if (!o || o.type !== "ObjectExpression") return false;
  for (const p of (o.properties as unknown[] | undefined) || []) {
    const prop = p as { type?: string; computed?: boolean; key?: unknown };
    if (prop.type !== "Property") continue;
    if (prop.computed) continue;
    const k = prop.key as { type?: string; name?: string; value?: unknown } | undefined;
    if (k?.type === "Identifier" && k.name === key) return true;
    if (k?.type === "Literal" && k.value === key) return true;
  }
  return false;
}

export function isMethodKey(prop: unknown): boolean {
  const pr = prop as { type?: string; method?: boolean; value?: { type?: string } };
  if (!pr || pr.type !== "Property") return false;
  if (pr.method === true) return true; // shorthand method
  const v = pr.value;
  return !!v && (v.type === "FunctionExpression" || v.type === "ArrowFunctionExpression");
}

export function objectHasKeyWithValues(
  obj: unknown,
  cfg: { key: string; values?: string[] },
): boolean {
  const o = obj as { type?: string; properties?: unknown[] };
  if (!o || o.type !== "ObjectExpression") return false;
  for (const p of (o.properties as unknown[] | undefined) || []) {
    const prop = p as {
      type?: string;
      computed?: boolean;
      key?: { type?: string; name?: string; value?: unknown };
      value?: { type?: string; value?: unknown };
    };
    if (prop.type !== "Property") continue;
    if (prop.computed) continue;
    const k = prop.key;
    const matchKey =
      (k?.type === "Identifier" && k.name === cfg.key) ||
      (k?.type === "Literal" && k.value === cfg.key);
    if (!matchKey) continue;
    if (!cfg.values || cfg.values.length === 0) return true; // key presence only
    const v = prop.value;
    if (v?.type === "Literal" && cfg.values.includes(String(v.value))) return true;
  }
  return false;
}

export function isCallOfMember(node: unknown, prop: string): boolean {
  const n = stripChain(node) as { type?: string; callee?: unknown } | unknown;
  if (!n || (n as { type?: string }).type !== "CallExpression") return false;
  const callee = (n as { callee?: unknown }).callee;
  return isMemberWithProperty(callee, prop);
}

/**
 * Recognize patterns like: obj.getSupportedExtensions()?.includes('EXT')
 * This is covered by a generic viaCall check, but we keep a helper for clarity and reuse.
 */
export function isIncludesOfGetSupportedExtensions(node: unknown): boolean {
  const n = node as { type?: string; callee?: unknown };
  if (!n || n.type !== "CallExpression") return false;
  const callee = n.callee;
  if (!isMemberName(callee, "includes")) return false;
  const recv = (callee as { object?: unknown }).object;
  return isCallOfMember(recv, "getSupportedExtensions");
}
