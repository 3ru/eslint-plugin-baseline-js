import type { Rule } from "eslint";

// In ESLint v9, context.getScope() is not available.
// Instead, use sourceCode.scopeManager to resolve the scope for a node.
export function isUnboundIdentifier(
  context: Rule.RuleContext,
  name: string,
  refNode?: unknown,
): boolean {
  const sc = (context as unknown as { sourceCode?: { scopeManager?: unknown } }).sourceCode
    ?.scopeManager as { acquire?: (n: unknown) => unknown; globalScope?: unknown } | undefined;
  if (!sc) return true; // Be conservative: treat as unbound when scope info is missing
  // Acquire a scope from refNode when provided; otherwise walk from globalScope.
  let scope: unknown = (refNode && sc.acquire?.(refNode)) || sc.globalScope || null;
  while (scope) {
    const s = scope as { set?: { has?: (k: string) => boolean }; upper?: unknown };
    if (s.set?.has?.(name)) return false;
    scope = s.upper || null;
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
  // These loose types mirror eslint-scope shapes without depending on private types.
  type VariableLike = {
    name?: string;
    defs?: unknown[];
    eslintExplicitGlobal?: boolean;
  };
  type ScopeLike = {
    set?: { has?: (k: string) => boolean; get?: (k: string) => unknown };
    variables?: VariableLike[];
    upper?: unknown;
    type?: string;
  };

  function findVariable(
    scope: ScopeLike,
    varName: string,
  ): {
    found: boolean;
    variable?: VariableLike;
  } {
    // Some scope containers fill only one of these; checking all reduces false positives.
    const bySet = scope.set?.get?.(varName) as VariableLike | undefined;
    if (bySet) return { found: true, variable: bySet };
    if (Array.isArray(scope.variables)) {
      const byVars = scope.variables.find((v) => v?.name === varName);
      if (byVars) return { found: true, variable: byVars };
    }
    if (scope.set?.has?.(varName)) return { found: true };
    return { found: false };
  }

  const sourceCode = context.sourceCode as { getScope?: (n: unknown) => unknown };
  if (!sourceCode?.getScope) return true; // Conservative: avoid false positives when scope info is missing
  const scope = sourceCode.getScope(parentNode);

  let current: unknown = scope;
  while (current) {
    const s = current as ScopeLike;
    const { found, variable } = findVariable(s, name);
    if (found) {
      if (s.type !== "global") return false; // Shadowed by local declaration
      // In script files, top-level `var`/`function` live in global scope.
      // Only treat them as shadowing when ESLint marks them with defs; built-ins have none.
      const defs = variable?.defs;
      if (Array.isArray(defs) && defs.length > 0) return false;
      return true;
    }
    current = s.upper || null;
  }
  return true;
}

const GLOBAL_OBJECT_NAMES = new Set(["window", "globalThis", "self"]);

function staticPropertyName(node: unknown, computed: boolean): string | null {
  const key = node as { type?: string; name?: string; value?: unknown } | undefined;
  if (!computed && key?.type === "Identifier") return key.name ?? null;
  if (key?.type === "Literal" && typeof key.value === "string") return key.value;
  return null;
}

export function isGlobalBase(_context: Rule.RuleContext, node: unknown, baseName: string): boolean {
  return collectGlobalBaseRoots(node, baseName).length > 0;
}

function globalObjectRoot(node: unknown): string | null {
  type NodeLike = {
    type?: string;
    name?: string;
    computed?: boolean;
    object?: unknown;
    property?: unknown;
  };
  let current = stripChain(node) as NodeLike | undefined;
  while (current?.type === "MemberExpression") {
    const name = staticPropertyName(current.property, !!current.computed);
    if (!name || !GLOBAL_OBJECT_NAMES.has(name)) return null;
    current = stripChain(current.object) as NodeLike | undefined;
  }
  return current?.type === "Identifier" && GLOBAL_OBJECT_NAMES.has(current.name ?? "")
    ? (current.name as string)
    : null;
}

function collectGlobalBaseRoots(node: unknown, baseName: string): string[] {
  const n = stripChain(node) as
    | {
        type?: string;
        name?: string;
        computed?: boolean;
        object?: unknown;
        property?: unknown;
      }
    | undefined;
  if (n?.type === "Identifier" && n.name === baseName) return [baseName];
  if (baseName === "window") {
    const root = globalObjectRoot(n);
    if (root) return [root];
  }
  if (n?.type !== "MemberExpression") return [];
  if (staticPropertyName(n.property, !!n.computed) !== baseName) return [];
  const root = globalObjectRoot(n.object);
  return root ? [root] : [];
}

export function isGlobalBaseNotShadowed(
  context: Rule.RuleContext,
  node: unknown,
  baseName: string,
  parentNode: unknown,
): boolean {
  const roots = collectGlobalBaseRoots(node, baseName);
  if (!roots.length) return false;
  return roots.every((name) => isGlobalNotShadowed(context, name, parentNode));
}

export function isMemberWithProperty(node: unknown, propName: string): boolean {
  return isMemberName(node, propName);
}

// --- Additional lightweight AST helpers for safe argument-based detection ---

export function stripChain(node: unknown): unknown {
  const n = node as { type?: string; expression?: unknown };
  if (n && n.type === "ChainExpression") return n.expression;
  return node;
}

export function isMemberName(node: unknown, name: string): boolean {
  const me = stripChain(node) as { type?: string; computed?: boolean; property?: unknown };
  return me?.type === "MemberExpression" && staticPropertyName(me.property, !!me.computed) === name;
}

export function getMemberPropertyNode(node: unknown): unknown | null {
  const me = stripChain(node) as { type?: string; property?: unknown };
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
  return (o.properties ?? []).some((p) => {
    const prop = p as { type?: string; computed?: boolean; key?: unknown };
    return prop.type === "Property" && staticPropertyName(prop.key, !!prop.computed) === key;
  });
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
  const properties = o.properties ?? [];
  for (let index = properties.length - 1; index >= 0; index--) {
    const prop = properties[index] as {
      type?: string;
      computed?: boolean;
      key?: { type?: string; name?: string; value?: unknown };
      value?: { type?: string; value?: unknown };
    };
    // A later spread or dynamic key may replace any earlier option value.
    if (prop.type !== "Property") return false;
    const key = staticPropertyName(prop.key, !!prop.computed);
    if (key === null && prop.computed && prop.key?.type !== "Literal") return false;
    if (key !== cfg.key) continue;
    if (!cfg.values || cfg.values.length === 0) return true; // key presence only
    const v = prop.value;
    return v?.type === "Literal" && cfg.values.includes(String(v.value));
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
