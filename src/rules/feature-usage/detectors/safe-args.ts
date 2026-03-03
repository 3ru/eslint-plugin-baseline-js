import type { Rule } from "eslint";
import type {
  CallMemberWithArgsDescriptor,
  NewWithOptionsDescriptor,
} from "../../../baseline/types";
import {
  getCallObjectArg,
  getCallStringArg,
  isCallOfMember,
  isGlobalBaseNotShadowed,
  objectHasKey,
  objectHasKeyWithValues,
} from "../../../util/ast";

export type Reporter = (node: unknown, featureId: string) => void;

function matchesObjectArg(obj: unknown, d: NonNullable<CallMemberWithArgsDescriptor["objectArg"]>) {
  if (!obj) return false;
  if (d.hasKeys?.length) {
    for (const k of d.hasKeys) if (!objectHasKey(obj as unknown, k)) return false;
  }
  if (d.keyValues?.length) {
    for (const kv of d.keyValues) {
      if (!objectHasKeyWithValues(obj as unknown, kv)) return false;
    }
  }
  return true;
}

export function addCallMemberWithArgsDetector(
  _context: Rule.RuleContext,
  d: CallMemberWithArgsDescriptor,
  report: Reporter,
): Rule.RuleListener {
  const handler: Rule.RuleListener["CallExpression"] = (node) => {
    const n = node as { callee?: unknown };
    const callee = n.callee as { type?: string; object?: unknown; property?: unknown } | undefined;
    if (!callee || callee.type !== "MemberExpression") return;
    const propNode = callee.property as
      | { type?: "Identifier"; name?: string }
      | { type?: "Literal"; value?: unknown }
      | undefined;
    const propName =
      propNode?.type === "Identifier"
        ? propNode.name
        : propNode?.type === "Literal"
          ? String(propNode.value)
          : undefined;
    if (propName !== d.prop) return;

    if (d.viaCall?.prop) {
      // Receiver must be the result of a call like obj.getSupportedExtensions()
      const recv = callee.object;
      if (!isCallOfMember(recv, d.viaCall.prop)) return;
    }

    if (d.stringArg) {
      const s = getCallStringArg(node as unknown, d.stringArg.index);
      if (!s || !d.stringArg.values.includes(s)) return;
    }

    if (d.objectArg) {
      const obj = getCallObjectArg(node as unknown, d.objectArg.index);
      if (!obj) return;
      const ok = matchesObjectArg(obj, d.objectArg);
      if (!ok) return;
    }

    // Report on the full CallExpression for stable RuleTester aggregation
    report(node, d.featureId);
  };
  return { CallExpression: handler };
}

export function addNewWithOptionsDetector(
  context: Rule.RuleContext,
  d: NewWithOptionsDescriptor,
  report: Reporter,
): Rule.RuleListener {
  const handler: Rule.RuleListener["NewExpression"] = (node) => {
    const callee = (node as { callee?: unknown }).callee as
      | { type?: string; name?: string }
      | undefined;
    if (callee?.type !== "Identifier" || callee.name !== d.name) return;
    if (!isGlobalBaseNotShadowed(context, callee, d.name, node)) return;
    const obj = getCallObjectArg(node as unknown, d.objectArg.index);
    if (!obj) return;
    if (d.objectArg.hasKeys?.length) {
      for (const k of d.objectArg.hasKeys) if (!objectHasKey(obj as unknown, k)) return;
    }
    if (d.objectArg.keyValues?.length) {
      for (const kv of d.objectArg.keyValues)
        if (!objectHasKeyWithValues(obj as unknown, kv)) return;
    }
    report(callee, d.featureId);
  };
  return { NewExpression: handler };
}
