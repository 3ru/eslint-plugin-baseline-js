import type { Rule } from "eslint";
import type { Node } from "estree";
import type ts from "typescript";

export interface TypedParserServices {
  program: ts.Program;
  esTreeNodeToTSNodeMap: Pick<WeakMap<Node, ts.Node>, "get">;
}

export function getTypedParserServices(context: Rule.RuleContext): TypedParserServices | undefined {
  // SAFETY: ESLint leaves parserServices untyped; TypeScript parsers own this contract.
  const services = context.sourceCode.parserServices as Partial<TypedParserServices> | undefined;
  if (!services?.program || !services.esTreeNodeToTSNodeMap) return undefined;
  return {
    program: services.program,
    esTreeNodeToTSNodeMap: services.esTreeNodeToTSNodeMap,
  };
}
