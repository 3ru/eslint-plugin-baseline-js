import type { Rule } from "eslint";
import type {
  CallGlobalDescriptor,
  CallStaticDescriptor,
  MemberDescriptor,
  NewIdentDescriptor,
  NewMemberDescriptor,
  StaticMemberDescriptor,
} from "../../../baseline/types";
import { isGlobalBaseNotShadowed, isMemberWithProperty } from "../../../util/ast";
export type Reporter = (node: unknown, featureId: string) => void;

export function addNewIdentDetector(
  context: Rule.RuleContext,
  d: NewIdentDescriptor,
  report: Reporter,
): Rule.RuleListener {
  const name = d.name;
  const featureId = d.featureId;
  const handler: Rule.RuleListener["NewExpression"] = (node) => {
    const callee = (node as unknown as { callee?: unknown }).callee as
      | { type?: string; name?: string }
      | undefined;
    if (
      callee?.type === "Identifier" &&
      callee.name === name &&
      isGlobalBaseNotShadowed(context, callee, name, node)
    ) {
      report(callee, featureId);
    }
  };
  return { NewExpression: handler };
}

export function addNewMemberDetector(
  context: Rule.RuleContext,
  d: NewMemberDescriptor,
  report: Reporter,
): Rule.RuleListener {
  const { base, prop, featureId } = d;
  const handler: Rule.RuleListener["NewExpression"] = (node) => {
    const callee = (node as unknown as { callee?: unknown }).callee;
    if (
      isMemberWithProperty(callee, prop) &&
      isGlobalBaseNotShadowed(
        context,
        (callee as unknown as { object?: unknown }).object,
        base,
        node,
      )
    ) {
      report((callee as unknown as { property?: unknown }).property, featureId);
    }
  };
  return { NewExpression: handler };
}

export function addCallStaticDetector(
  context: Rule.RuleContext,
  d: CallStaticDescriptor,
  report: Reporter,
): Rule.RuleListener {
  const { base, prop, featureId } = d;
  const handler: Rule.RuleListener["CallExpression"] = (node) => {
    const callee = (node as unknown as { callee?: unknown }).callee;
    if (
      isMemberWithProperty(callee, prop) &&
      isGlobalBaseNotShadowed(
        context,
        (callee as unknown as { object?: unknown }).object,
        base,
        node,
      )
    ) {
      report((callee as unknown as { property?: unknown }).property, featureId);
    }
  };
  return { CallExpression: handler };
}

export function addCallGlobalDetector(
  context: Rule.RuleContext,
  d: CallGlobalDescriptor,
  report: Reporter,
): Rule.RuleListener {
  const { name, featureId } = d;
  const handler: Rule.RuleListener["CallExpression"] = (node) => {
    const callee = (node as unknown as { callee?: unknown }).callee as
      | { type?: string; name?: string }
      | undefined;
    if (
      callee?.type === "Identifier" &&
      callee.name === name &&
      isGlobalBaseNotShadowed(context, callee, name, node)
    ) {
      report(callee, featureId);
    }
  };
  return { CallExpression: handler };
}

export function addMemberDetector(
  context: Rule.RuleContext,
  d: MemberDescriptor | StaticMemberDescriptor,
  report: Reporter,
): Rule.RuleListener {
  const { base, prop, featureId } = d;
  const handler: Rule.RuleListener["MemberExpression"] = (node) => {
    if (
      isMemberWithProperty(node, prop) &&
      isGlobalBaseNotShadowed(context, (node as unknown as { object?: unknown }).object, base, node)
    ) {
      report((node as unknown as { property?: unknown }).property, featureId);
    }
  };
  return { MemberExpression: handler };
}

export function addStaticMemberDetector(
  context: Rule.RuleContext,
  d: StaticMemberDescriptor,
  report: Reporter,
): Rule.RuleListener {
  return addMemberDetector(context, d, report);
}
