import type { Rule } from "eslint";
import type {
  CallGlobalDescriptor,
  CallStaticDescriptor,
  MemberDescriptor,
  NewIdentDescriptor,
  NewMemberDescriptor,
} from "../../../baseline/types";
import { isGlobalBase, isMemberWithProperty } from "../../../util/ast";
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
      isGlobalBase(context, callee, name)
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
      isGlobalBase(context, (callee as unknown as { object?: unknown }).object, base)
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
      isGlobalBase(context, (callee as unknown as { object?: unknown }).object, base)
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
      isGlobalBase(context, callee, name)
    ) {
      report(callee, featureId);
    }
  };
  return { CallExpression: handler };
}

export function addMemberDetector(
  context: Rule.RuleContext,
  d: MemberDescriptor,
  report: Reporter,
): Rule.RuleListener {
  const { base, prop, featureId } = d;
  const handler: Rule.RuleListener["MemberExpression"] = (node) => {
    if (
      isMemberWithProperty(node, prop) &&
      isGlobalBase(context, (node as unknown as { object?: unknown }).object, base)
    ) {
      report((node as unknown as { property?: unknown }).property, featureId);
    }
  };
  return { MemberExpression: handler };
}
