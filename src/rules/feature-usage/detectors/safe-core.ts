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

export type Reporter = (node: Node, featureId: string) => void;

export function addNewIdentDetector(
  context: Rule.RuleContext,
  descriptor: NewIdentDescriptor,
  report: Reporter,
): Rule.RuleListener {
  const { name, featureId } = descriptor;
  return {
    NewExpression(node) {
      const callee = stripChain(node.callee);
      if (isGlobalBaseNotShadowed(context, callee, name, node)) {
        report(getMemberPropertyNode(callee) ?? callee, featureId);
      }
    },
  };
}

export function addNewMemberDetector(
  context: Rule.RuleContext,
  descriptor: NewMemberDescriptor,
  report: Reporter,
): Rule.RuleListener {
  const { base, prop, featureId } = descriptor;
  return {
    NewExpression(node) {
      const callee = stripChain(node.callee);
      if (
        callee.type === "MemberExpression" &&
        getStaticMemberName(callee) === prop &&
        isGlobalBaseNotShadowed(context, callee.object, base, node)
      ) {
        report(callee.property, featureId);
      }
    },
  };
}

export function addCallStaticDetector(
  context: Rule.RuleContext,
  descriptor: CallStaticDescriptor,
  report: Reporter,
): Rule.RuleListener {
  const { base, prop, featureId } = descriptor;
  return {
    CallExpression(node) {
      const callee = stripChain(node.callee);
      if (
        callee.type === "MemberExpression" &&
        getStaticMemberName(callee) === prop &&
        isGlobalBaseNotShadowed(context, callee.object, base, node)
      ) {
        report(callee.property, featureId);
      }
    },
  };
}

export function addCallGlobalDetector(
  context: Rule.RuleContext,
  descriptor: CallGlobalDescriptor,
  report: Reporter,
): Rule.RuleListener {
  const { name, featureId } = descriptor;
  return {
    CallExpression(node) {
      const callee = stripChain(node.callee);
      if (isGlobalBaseNotShadowed(context, callee, name, node)) {
        report(getMemberPropertyNode(callee) ?? callee, featureId);
      }
    },
  };
}

export function addMemberDetector(
  context: Rule.RuleContext,
  descriptor: MemberDescriptor | StaticMemberDescriptor,
  report: Reporter,
): Rule.RuleListener {
  const { base, prop, featureId } = descriptor;
  return {
    MemberExpression(node) {
      if (
        getStaticMemberName(node) === prop &&
        isGlobalBaseNotShadowed(context, node.object, base, node)
      ) {
        report(node.property, featureId);
      }
    },
  };
}

export function addStaticMemberDetector(
  context: Rule.RuleContext,
  descriptor: StaticMemberDescriptor,
  report: Reporter,
): Rule.RuleListener {
  return addMemberDetector(context, descriptor, report);
}
