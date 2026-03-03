import type { Rule } from "eslint";
import { isGlobalBaseNotShadowed } from "../../util/ast";

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

    function resolveBigIntArrayBase(node: unknown, parentNode: unknown): string | null {
      if (isGlobalBaseNotShadowed(context, node, "BigInt64Array", parentNode)) {
        return "BigInt64Array";
      }
      if (isGlobalBaseNotShadowed(context, node, "BigUint64Array", parentNode)) {
        return "BigUint64Array";
      }
      return null;
    }

    return {
      NewExpression(node: unknown) {
        const n = node as Record<string, unknown>;
        const name = resolveBigIntArrayBase(n.callee, node);
        if (name) {
          report(n.callee);
        }
      },
      CallExpression(node: unknown) {
        const n = node as Record<string, unknown>;
        const name = resolveBigIntArrayBase(n.callee, node);
        if (name) {
          report(n.callee);
        }
      },
      MemberExpression(node: unknown) {
        const m = node as Record<string, unknown>;
        const name = resolveBigIntArrayBase(m.object, node);
        if (name) {
          report(m.object);
        }
      },
    };
  },
};

export default rule;
