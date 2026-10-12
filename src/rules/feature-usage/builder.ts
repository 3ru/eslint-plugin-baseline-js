import type { Rule } from "eslint";
import type { Node } from "estree";
import type { Descriptor } from "../../baseline/types";
import { getStaticMemberName, stripChain } from "../../util/ast";
import { getTypedParserServices } from "../../util/typed-parser-services";
import { addCallMemberWithArgsDetector, addNewWithOptionsDetector } from "./detectors/safe-args";
import {
  addCallGlobalDetector,
  addCallStaticDetector,
  addMemberDetector,
  addNewIdentDetector,
  addNewMemberDetector,
  addStaticMemberDetector,
} from "./detectors/safe-core";
import { addTypedInstanceMemberDetector } from "./detectors/typed-instance-member";

export interface BuildOptions {
  descriptors: ReadonlyArray<Descriptor>;
  report: (node: Node, descriptor: Descriptor) => void;
  typed?: boolean;
}

export function buildListeners(context: Rule.RuleContext, opt: BuildOptions): Rule.RuleListener {
  const calls = new Map<string, NonNullable<Rule.RuleListener["CallExpression"]>[]>();
  const constructions = new Map<string, NonNullable<Rule.RuleListener["NewExpression"]>[]>();
  const members = new Map<string, NonNullable<Rule.RuleListener["MemberExpression"]>[]>();

  function addHandler<T>(handlers: Map<string, T[]>, name: string, handler: T | undefined) {
    if (!handler) return;
    const bucket = handlers.get(name);
    if (bucket) bucket.push(handler);
    else handlers.set(name, [handler]);
  }

  function calleeName(callee: Node): string | null {
    const node = stripChain(callee);
    return node.type === "Identifier" ? node.name : getStaticMemberName(node);
  }
  const reportedFeatures = new WeakMap<Node, Set<string>>();

  const useTyped = !!opt.typed && !!getTypedParserServices(context);

  for (const d of opt.descriptors) {
    function report(node: Node) {
      // Different descriptors can recognize the same feature at the same AST node.
      // Keep distinct features while reporting overlapping patterns only once.
      let features = reportedFeatures.get(node);
      if (features?.has(d.featureId)) return;
      if (!features) {
        features = new Set();
        reportedFeatures.set(node, features);
      }
      features.add(d.featureId);
      opt.report(node, d);
    }

    switch (d.kind) {
      case "newIdent":
        addHandler(constructions, d.name, addNewIdentDetector(context, d, report).NewExpression);
        break;
      case "newMember":
        addHandler(constructions, d.prop, addNewMemberDetector(context, d, report).NewExpression);
        break;
      case "callStatic":
        addHandler(calls, d.prop, addCallStaticDetector(context, d, report).CallExpression);
        break;
      case "callGlobal":
        addHandler(calls, d.name, addCallGlobalDetector(context, d, report).CallExpression);
        break;
      case "member":
        addHandler(members, d.prop, addMemberDetector(context, d, report).MemberExpression);
        break;
      case "staticMember":
        addHandler(members, d.prop, addStaticMemberDetector(context, d, report).MemberExpression);
        break;
      case "instanceMember":
        if (useTyped)
          addHandler(
            members,
            d.prop,
            addTypedInstanceMemberDetector(context, d, report).MemberExpression,
          );
        break;
      case "callMemberWithArgs":
        addHandler(calls, d.prop, addCallMemberWithArgsDetector(context, d, report).CallExpression);
        break;
      case "newWithOptions":
        addHandler(
          constructions,
          d.name,
          addNewWithOptionsDetector(context, d, report).NewExpression,
        );
        break;
      default:
        throw new Error(`Unsupported descriptor: ${JSON.stringify(d satisfies never)}`);
    }
  }

  return {
    CallExpression(node) {
      const name = calleeName(node.callee);
      if (name === null) return;
      for (const handler of calls.get(name) ?? []) handler(node);
    },
    NewExpression(node) {
      const name = calleeName(node.callee);
      if (name === null) return;
      for (const handler of constructions.get(name) ?? []) handler(node);
    },
    MemberExpression(node) {
      const name = getStaticMemberName(node);
      if (name === null) return;
      for (const handler of members.get(name) ?? []) handler(node);
    },
  };
}
