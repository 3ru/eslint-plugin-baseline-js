/** Parsing and traversal exactly as ESLint does them, so node counts match what the rule sees. */
import * as tsParser from "@typescript-eslint/parser";
import { simpleTraverse, type TSESTree } from "@typescript-eslint/typescript-estree";

export type ScopeManager = ReturnType<typeof tsParser.parseForESLint>["scopeManager"];

export interface ParsedSource {
  ast: TSESTree.Program;
  scopeManager: ScopeManager;
}

/** The parser picks JSX and TypeScript syntax from the file extension, as it does under ESLint. */
export function parseWithScope(source: string, filePath: string): ParsedSource {
  return tsParser.parseForESLint(source, { ecmaVersion: "latest", sourceType: "module", filePath });
}

export function parseSource(source: string, filePath: string): TSESTree.Program {
  return parseWithScope(source, filePath).ast;
}

export function walk(
  root: TSESTree.Node,
  visit: (node: TSESTree.Node, parent: TSESTree.Node | null) => void,
): void {
  simpleTraverse(root, { enter: (node, parent) => visit(node, parent ?? null) });
}

export function countNodes(root: TSESTree.Node): number {
  let count = 0;

  walk(root, () => {
    count++;
  });

  return count;
}
