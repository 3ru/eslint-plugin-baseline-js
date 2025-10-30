import type { Rule } from "eslint";
import type {
  CallMemberWithArgsDescriptor,
  CallStaticDescriptor,
  Descriptor,
  InstanceMemberDescriptor,
  MemberDescriptor,
  NewIdentDescriptor,
  NewMemberDescriptor,
  NewWithOptionsDescriptor,
} from "../../baseline/types";
import { mergeRuleListeners } from "../../utils/listeners";
import { addCallMemberWithArgsDetector, addNewWithOptionsDetector } from "./detectors/safe-args";
import {
  addCallStaticDetector,
  addMemberDetector,
  addNewIdentDetector,
  addNewMemberDetector,
} from "./detectors/safe-core";
import { addTypedInstanceMemberDetector } from "./detectors/typed-instance-member";

export interface BuildOptions {
  descriptors: ReadonlyArray<Descriptor>;
  messages: Record<string, string>;
  typed?: boolean;
}

export function buildListeners(context: Rule.RuleContext, opt: BuildOptions): Rule.RuleListener {
  const listeners: Rule.RuleListener = {};

  function report(node: unknown, featureId: string) {
    const msg = opt.messages[featureId] ?? `Feature '${featureId}' exceeds configured Baseline.`;
    context.report({ node: node as unknown as Rule.Node, message: msg });
  }

  type ParserServicesLike = {
    program?: { getTypeChecker?: () => unknown };
    esTreeNodeToTSNodeMap?: unknown;
  };
  type CtxLike = {
    parserServices?: ParserServicesLike;
    sourceCode?: { parserServices?: ParserServicesLike };
  };
  const ctxLike = context as unknown as CtxLike;
  const services: ParserServicesLike =
    ctxLike.parserServices || ctxLike.sourceCode?.parserServices || {};
  const checker: unknown = services.program?.getTypeChecker?.();
  const useTyped = !!opt.typed && !!checker && !!services.esTreeNodeToTSNodeMap;

  for (const d of opt.descriptors) {
    switch (d.kind) {
      case "newIdent":
        mergeRuleListeners(
          listeners,
          addNewIdentDetector(context, d as NewIdentDescriptor, report),
        );
        break;
      case "newMember":
        mergeRuleListeners(
          listeners,
          addNewMemberDetector(context, d as NewMemberDescriptor, report),
        );
        break;
      case "callStatic":
        mergeRuleListeners(
          listeners,
          addCallStaticDetector(context, d as CallStaticDescriptor, report),
        );
        break;
      case "member":
        mergeRuleListeners(listeners, addMemberDetector(context, d as MemberDescriptor, report));
        break;
      case "instanceMember":
        if (useTyped)
          mergeRuleListeners(
            listeners,
            addTypedInstanceMemberDetector(context, d as InstanceMemberDescriptor, report),
          );
        break;
      case "callMemberWithArgs":
        mergeRuleListeners(
          listeners,
          addCallMemberWithArgsDetector(context, d as CallMemberWithArgsDescriptor, report),
        );
        break;
      case "newWithOptions":
        mergeRuleListeners(
          listeners,
          addNewWithOptionsDetector(context, d as NewWithOptionsDescriptor, report),
        );
        break;
      default:
        break;
    }
  }

  return listeners;
}
