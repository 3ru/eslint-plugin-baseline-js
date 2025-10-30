import type { Rule } from "eslint";
import type { InstanceMemberDescriptor } from "../../../baseline/types";
import { isMemberWithProperty } from "../../../util/ast";

export type Reporter = (node: unknown, featureId: string) => void;

export function addTypedInstanceMemberDetector(
  context: Rule.RuleContext,
  d: InstanceMemberDescriptor,
  report: Reporter,
): Rule.RuleListener {
  const { iface, prop, featureId } = d;
  type TsCheckerLike = {
    getTypeAtLocation?: (n: unknown) => unknown;
    getPropertyOfType?: (t: unknown, name: string) => unknown;
    getApparentType?: (t: unknown) => unknown;
  };
  type ParserServicesLike = {
    program?: { getTypeChecker?: () => TsCheckerLike };
    esTreeNodeToTSNodeMap?: { get(n: unknown): unknown };
  };
  type CtxLike = {
    parserServices?: ParserServicesLike;
    sourceCode?: { parserServices?: ParserServicesLike };
  };
  const ctxLike = context as unknown as CtxLike;
  const services: ParserServicesLike =
    ctxLike.parserServices || ctxLike.sourceCode?.parserServices || {};
  const checker: TsCheckerLike | undefined = services.program?.getTypeChecker?.();
  if (!checker || !services.esTreeNodeToTSNodeMap) return {};
  const checkerOk = checker; // non-null assertion helper for narrowing
  const tsMap = services.esTreeNodeToTSNodeMap; // non-null assertion helper

  const tsMapGet = (tsMap as { get?: (node: unknown) => unknown }).get;
  if (typeof tsMapGet !== "function") return {};
  const getTsNode = tsMapGet.bind(tsMap);

  const typeAtLocation = checkerOk.getTypeAtLocation;
  if (typeof typeAtLocation !== "function") return {};
  const getTypeAtLocation = typeAtLocation.bind(checkerOk);

  const propertyOfType = checkerOk.getPropertyOfType;
  if (typeof propertyOfType !== "function") return {};
  const getPropertyOfType = propertyOfType.bind(checkerOk);

  function typeMatches(t: unknown): boolean {
    if (!t) return false;
    const withTypes = t as { types?: unknown[] };
    if (Array.isArray(withTypes.types)) return withTypes.types.some((tt) => typeMatches(tt));
    const withSym = t as {
      symbol?: { name?: string };
      aliasSymbol?: { name?: string };
      getSymbol?: () => unknown;
    };
    const sym = withSym.symbol || withSym.aliasSymbol || withSym.getSymbol?.();
    const name = (sym as { name?: string } | undefined)?.name;
    if (name === iface || name?.endsWith(`.${iface}`)) return true;
    const apparent = checkerOk.getApparentType?.(t) || t;
    const ap = apparent as { getBaseTypes?: () => unknown[]; baseTypes?: unknown[] };
    const baseTypes = (ap.getBaseTypes?.() || ap.baseTypes || []) as unknown[];
    if (baseTypes?.length) {
      if (baseTypes.some((bt) => (bt as { symbol?: { name?: string } }).symbol?.name === iface))
        return true;
      for (const bt of baseTypes) {
        const btLike = bt as { getBaseTypes?: () => unknown[] };
        const bt2 = btLike.getBaseTypes?.() || [];
        if (
          Array.isArray(bt2) &&
          bt2.some((b2) => (b2 as { symbol?: { name?: string } }).symbol?.name === iface)
        )
          return true;
      }
    }
    return false;
  }

  const handler: Rule.RuleListener["MemberExpression"] = (node) => {
    if (!isMemberWithProperty(node, prop)) return;
    const obj = (node as unknown as { object?: unknown }).object;
    const tsNode = getTsNode(obj);
    if (!tsNode) return;
    const type = getTypeAtLocation(tsNode);
    if (!type) return;
    const hasProp = !!getPropertyOfType(type, prop);
    if (!hasProp) return;
    if (typeMatches(type)) report((node as unknown as { property?: unknown }).property, featureId);
  };
  return { MemberExpression: handler };
}
