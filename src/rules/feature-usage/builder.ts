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
import { createTypedMemberResolver } from "./typed-members";

export interface BuildOptions {
  descriptors: ReadonlyArray<Descriptor>;
  onMatch: (match: { node: Node; reference: Node; descriptor: Descriptor }) => void;
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

  const services = opt.typed ? getTypedParserServices(context) : undefined;
  const typedMembers = services ? createTypedMemberResolver(services) : undefined;
  const enabledDescriptors = new Set(opt.descriptors);
  const typedProperties = new Set<string>();

  for (const d of opt.descriptors) {
    function onMatch(node: Node, reference: Node) {
      opt.onMatch({ node, reference, descriptor: d });
    }

    switch (d.kind) {
      case "newIdent":
        addHandler(constructions, d.name, addNewIdentDetector(context, d, onMatch).NewExpression);
        break;
      case "newMember":
        addHandler(constructions, d.prop, addNewMemberDetector(context, d, onMatch).NewExpression);
        break;
      case "callStatic":
        addHandler(calls, d.prop, addCallStaticDetector(context, d, onMatch).CallExpression);
        break;
      case "callGlobal":
        addHandler(calls, d.name, addCallGlobalDetector(context, d, onMatch).CallExpression);
        break;
      case "member":
        addHandler(members, d.prop, addMemberDetector(context, d, onMatch).MemberExpression);
        break;
      case "staticMember":
        addHandler(members, d.prop, addStaticMemberDetector(context, d, onMatch).MemberExpression);
        break;
      case "instanceMember":
        if (typedMembers) typedProperties.add(d.prop);
        break;
      case "callMemberWithArgs":
        if (typedMembers) {
          addHandler(
            calls,
            d.prop,
            addCallMemberWithArgsDetector(typedMembers, d, onMatch).CallExpression,
          );
        }
        break;
      case "newWithOptions":
        addHandler(
          constructions,
          d.name,
          addNewWithOptionsDetector(context, d, onMatch).NewExpression,
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
      if (name !== null) {
        for (const handler of members.get(name) ?? []) handler(node);
      }
      if (name === null ? node.computed && typedProperties.size > 0 : typedProperties.has(name)) {
        for (const descriptor of typedMembers?.selectInstanceDescriptors(node) ?? []) {
          if (enabledDescriptors.has(descriptor)) {
            opt.onMatch({ node: node.property, reference: node, descriptor });
          }
        }
      }
    },
  };
}
