import type { Rule } from "eslint";
import type { ObjectExpression } from "estree";
import type {
  CallMemberWithArgsDescriptor,
  NewWithOptionsDescriptor,
} from "../../../baseline/types";
import {
  getCallObjectArg,
  getCallStringArg,
  getMemberPropertyNode,
  getStaticMemberName,
  isCallOfMember,
  isGlobalBaseNotShadowed,
  objectHasKey,
  objectHasKeyWithValues,
  stripChain,
} from "../../../util/ast";
import type { Reporter } from "./safe-core";

function matchesObjectArg(
  object: ObjectExpression | null,
  descriptor: NonNullable<CallMemberWithArgsDescriptor["objectArg"]>,
): boolean {
  if (!object) return false;
  for (const key of descriptor.hasKeys ?? []) {
    if (!objectHasKey(object, key)) return false;
  }
  for (const keyValue of descriptor.keyValues ?? []) {
    if (!objectHasKeyWithValues(object, keyValue)) return false;
  }
  return true;
}

export function addCallMemberWithArgsDetector(
  _context: Rule.RuleContext,
  descriptor: CallMemberWithArgsDescriptor,
  report: Reporter,
): Rule.RuleListener {
  return {
    CallExpression(node) {
      const callee = stripChain(node.callee);
      if (callee.type !== "MemberExpression" || getStaticMemberName(callee) !== descriptor.prop)
        return;
      if (descriptor.viaCall?.prop && !isCallOfMember(callee.object, descriptor.viaCall.prop))
        return;

      if (descriptor.stringArg) {
        const argument = getCallStringArg(node, descriptor.stringArg.index);
        if (!argument || !descriptor.stringArg.values.includes(argument)) return;
      }
      if (
        descriptor.objectArg &&
        !matchesObjectArg(getCallObjectArg(node, descriptor.objectArg.index), descriptor.objectArg)
      )
        return;

      // Keep argument-based diagnostics on the complete call.
      report(node, descriptor.featureId);
    },
  };
}

export function addNewWithOptionsDetector(
  context: Rule.RuleContext,
  descriptor: NewWithOptionsDescriptor,
  report: Reporter,
): Rule.RuleListener {
  return {
    NewExpression(node) {
      const callee = stripChain(node.callee);
      if (!isGlobalBaseNotShadowed(context, callee, descriptor.name, node)) return;
      if (
        !matchesObjectArg(getCallObjectArg(node, descriptor.objectArg.index), descriptor.objectArg)
      )
        return;
      report(getMemberPropertyNode(callee) ?? callee, descriptor.featureId);
    },
  };
}
