import type { Rule } from "eslint";
import type { Node } from "estree";
import type {
  CallGlobalDescriptor,
  CallStaticDescriptor,
  MemberDescriptor,
  NewIdentDescriptor,
  NewMemberDescriptor,
  StaticMemberDescriptor,
} from "../../../baseline/types";
import {
  getMemberPropertyNode,
  getStaticMemberName,
  isGlobalBaseNotShadowed,
  stripChain,
} from "../../../util/ast";

export type MatchReporter = (node: Node, reference: Node) => void;

export function addNewIdentDetector(
  context: Rule.RuleContext,
  descriptor: NewIdentDescriptor,
  onMatch: MatchReporter,
): Rule.RuleListener {
  const { name } = descriptor;
  return {
    NewExpression(node) {
      const callee = stripChain(node.callee);
      if (isGlobalBaseNotShadowed(context, callee, name, node)) {
        onMatch(getMemberPropertyNode(callee) ?? callee, callee);
      }
    },
  };
}

export function addNewMemberDetector(
  context: Rule.RuleContext,
  descriptor: NewMemberDescriptor,
  onMatch: MatchReporter,
): Rule.RuleListener {
  const { base, prop } = descriptor;
  return {
    NewExpression(node) {
      const callee = stripChain(node.callee);
      if (
        callee.type === "MemberExpression" &&
        getStaticMemberName(callee) === prop &&
        isGlobalBaseNotShadowed(context, callee.object, base, node)
      ) {
        onMatch(callee.property, callee);
      }
    },
  };
}

export function addCallStaticDetector(
  context: Rule.RuleContext,
  descriptor: CallStaticDescriptor,
  onMatch: MatchReporter,
): Rule.RuleListener {
  const { base, prop } = descriptor;
  return {
    CallExpression(node) {
      const callee = stripChain(node.callee);
      if (
        callee.type === "MemberExpression" &&
        getStaticMemberName(callee) === prop &&
        isGlobalBaseNotShadowed(context, callee.object, base, node)
      ) {
        onMatch(callee.property, callee);
      }
    },
  };
}

export function addCallGlobalDetector(
  context: Rule.RuleContext,
  descriptor: CallGlobalDescriptor,
  onMatch: MatchReporter,
): Rule.RuleListener {
  const { name } = descriptor;
  return {
    CallExpression(node) {
      const callee = stripChain(node.callee);
      if (isGlobalBaseNotShadowed(context, callee, name, node)) {
        onMatch(getMemberPropertyNode(callee) ?? callee, callee);
      }
    },
  };
}

export function addMemberDetector(
  context: Rule.RuleContext,
  descriptor: MemberDescriptor | StaticMemberDescriptor,
  onMatch: MatchReporter,
): Rule.RuleListener {
  const { base, prop } = descriptor;
  return {
    MemberExpression(node) {
      if (
        getStaticMemberName(node) === prop &&
        isGlobalBaseNotShadowed(context, node.object, base, node)
      ) {
        onMatch(node.property, node);
      }
    },
  };
}

export function addStaticMemberDetector(
  context: Rule.RuleContext,
  descriptor: StaticMemberDescriptor,
  onMatch: MatchReporter,
): Rule.RuleListener {
  return addMemberDetector(context, descriptor, onMatch);
}
