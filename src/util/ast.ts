import type { Rule, Scope } from "eslint";
import type { CallExpression, NewExpression, Node, ObjectExpression } from "estree";

/** Built-in globals have no definitions; explicit declarations shadow them. */
export function isGlobalNotShadowed(
  context: Rule.RuleContext,
  name: string,
  reference: Node,
): boolean {
  let scope: Scope.Scope | null = context.sourceCode.getScope(reference);
  while (scope) {
    const variable = scope.set.get(name);
    if (variable) return scope.type === "global" && variable.defs.length === 0;
    scope = scope.upper;
  }
  return true;
}

const GLOBAL_OBJECT_NAMES = new Set(["window", "globalThis", "self"]);

function staticPropertyName(node: Node, computed: boolean): string | null {
  if (!computed && node.type === "Identifier") return node.name;
  if (node.type === "Literal" && typeof node.value === "string") return node.value;
  return null;
}

export function stripChain(node: Node): Node {
  return node.type === "ChainExpression" ? node.expression : node;
}

export function getStaticMemberName(node: Node): string | null {
  const member = stripChain(node);
  return member.type === "MemberExpression"
    ? staticPropertyName(member.property, member.computed)
    : null;
}

function globalObjectRoot(node: Node): string | null {
  let current = stripChain(node);
  while (current.type === "MemberExpression") {
    const name = getStaticMemberName(current);
    if (name === null || !GLOBAL_OBJECT_NAMES.has(name)) return null;
    current = stripChain(current.object);
  }
  return current.type === "Identifier" && GLOBAL_OBJECT_NAMES.has(current.name)
    ? current.name
    : null;
}

function globalBaseRoot(node: Node, baseName: string): string | null {
  const base = stripChain(node);
  if (base.type === "Identifier" && base.name === baseName) return baseName;
  if (baseName === "window") {
    const root = globalObjectRoot(base);
    if (root !== null) return root;
  }
  if (base.type !== "MemberExpression" || getStaticMemberName(base) !== baseName) return null;
  return globalObjectRoot(base.object);
}

export function isGlobalBaseNotShadowed(
  context: Rule.RuleContext,
  node: Node,
  baseName: string,
  reference: Node,
): boolean {
  const root = globalBaseRoot(node, baseName);
  return root !== null && isGlobalNotShadowed(context, root, reference);
}

export function getMemberPropertyNode(node: Node): Node | null {
  const member = stripChain(node);
  return member.type === "MemberExpression" ? member.property : null;
}

export function getCallStringArg(
  call: CallExpression | NewExpression,
  index: number,
): string | null {
  const argument = call.arguments[index];
  return argument?.type === "Literal" && typeof argument.value === "string" ? argument.value : null;
}

export function getCallObjectArg(
  call: CallExpression | NewExpression,
  index: number,
): ObjectExpression | null {
  const argument = call.arguments[index];
  return argument?.type === "ObjectExpression" ? argument : null;
}

export function objectHasKey(object: ObjectExpression, key: string): boolean {
  return object.properties.some(
    (property) =>
      property.type === "Property" && staticPropertyName(property.key, property.computed) === key,
  );
}

export function objectHasKeyWithValues(
  object: ObjectExpression,
  config: { key: string; values?: string[] },
): boolean {
  for (let index = object.properties.length - 1; index >= 0; index--) {
    const property = object.properties[index];
    // A later spread or dynamic key may replace any earlier option value.
    if (property.type !== "Property") return false;
    const key = staticPropertyName(property.key, property.computed);
    if (key === null && property.computed && property.key.type !== "Literal") return false;
    if (key !== config.key) continue;
    if (!config.values?.length) return true;
    return (
      property.value.type === "Literal" && config.values.includes(String(property.value.value))
    );
  }
  return false;
}
