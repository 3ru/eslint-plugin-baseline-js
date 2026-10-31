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
  isGlobalBaseNotShadowed,
  objectHasKey,
  objectHasKeyWithValues,
  stripChain,
} from "../../../util/ast";
import type { TypedMemberResolver } from "../typed-members";
import type { MatchReporter } from "./safe-core";

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
  typedMembers: TypedMemberResolver,
  descriptor: CallMemberWithArgsDescriptor,
  onMatch: MatchReporter,
): Rule.RuleListener {
  return {
    CallExpression(node) {
      const callee = stripChain(node.callee);
      if (callee.type !== "MemberExpression" || getStaticMemberName(callee) !== descriptor.prop)
        return;
      let ownedMember = callee;
      if (descriptor.viaCall) {
        const call = stripChain(callee.object);
        if (call.type !== "CallExpression") return;
        const member = stripChain(call.callee);
        if (
          member.type !== "MemberExpression" ||
          getStaticMemberName(member) !== descriptor.viaCall.prop
        )
          return;
        ownedMember = member;
      }

      if (descriptor.stringArg) {
        const argument = getCallStringArg(node, descriptor.stringArg.index);
        if (!argument || !descriptor.stringArg.values.includes(argument)) return;
      }
      if (
        descriptor.objectArg &&
        !matchesObjectArg(getCallObjectArg(node, descriptor.objectArg.index), descriptor.objectArg)
      )
        return;

      if (!typedMembers.provesOwner(ownedMember, descriptor.iface)) return;

      onMatch(node, callee);
    },
  };
}

export function addNewWithOptionsDetector(
  context: Rule.RuleContext,
  descriptor: NewWithOptionsDescriptor,
  onMatch: MatchReporter,
): Rule.RuleListener {
  return {
    NewExpression(node) {
      const callee = stripChain(node.callee);
      if (!isGlobalBaseNotShadowed(context, callee, descriptor.name, node)) return;
      if (
        !matchesObjectArg(getCallObjectArg(node, descriptor.objectArg.index), descriptor.objectArg)
      )
        return;
      onMatch(getMemberPropertyNode(callee) ?? callee, callee);
    },
  };
}
