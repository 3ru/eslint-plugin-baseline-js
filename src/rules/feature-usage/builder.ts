import type { Rule } from "eslint";
import type { Descriptor } from "../../baseline/types";
import { mergeRuleListeners } from "../../utils/listeners";
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
  report: (node: Rule.Node, descriptor: Descriptor) => void;
  typed?: boolean;
}

export function buildListeners(context: Rule.RuleContext, opt: BuildOptions): Rule.RuleListener {
  const listeners: Rule.RuleListener = {};

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
    function report(node: unknown) {
      // SAFETY: Every detector reports a node from ESLint's AST.
      opt.report(node as Rule.Node, d);
    }

    switch (d.kind) {
      case "newIdent":
        mergeRuleListeners(listeners, addNewIdentDetector(context, d, report));
        break;
      case "newMember":
        mergeRuleListeners(listeners, addNewMemberDetector(context, d, report));
        break;
      case "callStatic":
        mergeRuleListeners(listeners, addCallStaticDetector(context, d, report));
        break;
      case "callGlobal":
        mergeRuleListeners(listeners, addCallGlobalDetector(context, d, report));
        break;
      case "member":
        mergeRuleListeners(listeners, addMemberDetector(context, d, report));
        break;
      case "staticMember":
        mergeRuleListeners(listeners, addStaticMemberDetector(context, d, report));
        break;
      case "instanceMember":
        if (useTyped)
          mergeRuleListeners(listeners, addTypedInstanceMemberDetector(context, d, report));
        break;
      case "callMemberWithArgs":
        mergeRuleListeners(listeners, addCallMemberWithArgsDetector(context, d, report));
        break;
      case "newWithOptions":
        mergeRuleListeners(listeners, addNewWithOptionsDetector(context, d, report));
        break;
      default:
        break;
    }
  }

  return listeners;
}
