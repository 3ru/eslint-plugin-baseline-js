import type { Rule } from "eslint";
import { isGlobalNotShadowed } from "../../util/ast";

// TODO(improve-detection)
// - Detect aliasing: const C = BigInt64Array; new C(); (needs reference tracking)
// - Consider using @eslint-community/eslint-utils ReferenceTracker for robust global lookups.

const rule: Rule.RuleModule = {
  meta: {
    type: "problem",
    docs: { description: "disallow BigInt64Array/BigUint64Array usage" },
    messages: { forbidden: "BigInt64Array/BigUint64Array are not allowed." },
    schema: [],
  },
  create(context) {
    function report(node: unknown) {
      context.report({ node: node as Rule.Node, messageId: "forbidden" });
    }

    function isBigIntArrayIdent(calleeNode: unknown): string | null {
      const callee = calleeNode as { type?: string; name?: string } | undefined;
      if (callee?.type !== "Identifier") return null;
      if (callee.name === "BigInt64Array" || callee.name === "BigUint64Array") {
        return callee.name;
      }
      return null;
    }

    return {
      NewExpression(node: unknown) {
        const n = node as Record<string, unknown>;
        const name = isBigIntArrayIdent(n.callee);
        if (name && isGlobalNotShadowed(context, name, node)) {
          report(n.callee);
        }
      },
      CallExpression(node: unknown) {
        const n = node as Record<string, unknown>;
        const name = isBigIntArrayIdent(n.callee);
        if (name && isGlobalNotShadowed(context, name, node)) {
          report(n.callee);
        }
      },
      MemberExpression(node: unknown) {
        const m = node as Record<string, unknown>;
        const name = isBigIntArrayIdent(m.object);
        if (name && isGlobalNotShadowed(context, name, node)) {
          report(m.object);
        }
      },
    };
  },
};

export default rule;
