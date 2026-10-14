import type { Rule } from "eslint";
import type { Node } from "estree";
import type ts from "typescript";
import type { InstanceMemberDescriptor } from "../../../baseline/types";
import { isMemberWithProperty } from "../../../util/ast";
import { getTypedParserServices } from "../../../util/typed-parser-services";

export type Reporter = (node: Node, featureId: string) => void;

export function addTypedInstanceMemberDetector(
  context: Rule.RuleContext,
  d: InstanceMemberDescriptor,
  report: Reporter,
): Rule.RuleListener {
  const { iface, prop, featureId } = d;
  const services = getTypedParserServices(context);
  if (!services) return {};
  const { program } = services;
  const checker = program.getTypeChecker();

  function getBaseTypes(type: ts.Type): readonly ts.BaseType[] {
    const bases = type.getBaseTypes();
    if (bases) return bases;
    // Instantiated generic references expose their bases on the target interface.
    if (isTypeReference(type)) return type.target.getBaseTypes() ?? [];
    return [];
  }

  function typeMatches(type: ts.Type, seen = new Set<ts.Type>()): boolean {
    if (seen.has(type)) return false;
    seen.add(type);
    if (type.isUnionOrIntersection()) return type.types.some((part) => typeMatches(part, seen));
    const symbol = type.getSymbol() ?? type.aliasSymbol;
    const name = symbol?.getName();
    // Merged globals and replacement libraries retain compiler-selected library declarations.
    if (
      (name === iface || name?.endsWith(`.${iface}`)) &&
      symbol
        ?.getDeclarations()
        ?.some((declaration) => program.isSourceFileDefaultLibrary(declaration.getSourceFile()))
    ) {
      return true;
    }
    const apparent = checker.getApparentType(type);
    if (apparent !== type && typeMatches(apparent, seen)) return true;
    const constraint = checker.getBaseConstraintOfType(type);
    if (constraint && constraint !== type && typeMatches(constraint, seen)) return true;
    return getBaseTypes(type).some((base) => typeMatches(base, seen));
  }

  const handler: Rule.RuleListener["MemberExpression"] = (node) => {
    if (!isMemberWithProperty(node, prop)) return;
    const tsNode = services.esTreeNodeToTSNodeMap.get(node.object);
    if (!tsNode) return;
    const type = checker.getNonNullableType(checker.getTypeAtLocation(tsNode));
    if (!checker.getPropertyOfType(type, prop)) return;
    if (typeMatches(type)) report(node.property, featureId);
  };
  return { MemberExpression: handler };
}

function isTypeReference(type: ts.Type): type is ts.TypeReference {
  return "target" in type;
}
