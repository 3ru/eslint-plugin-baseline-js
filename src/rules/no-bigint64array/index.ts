import type { Rule } from "eslint";
import type { Node } from "estree";
import { isGlobalBaseNotShadowed } from "../../util/ast";

// TODO(improve-detection)
// - Detect aliasing: const C = BigInt64Array; new C(); (needs reference tracking)
// - Consider using @eslint-community/eslint-utils ReferenceTracker for robust global lookups.

const rule: Rule.RuleModule = {
  meta: {
    type: "problem",
    docs: {
      description: "disallow BigInt64Array/BigUint64Array usage",
      url: "https://baselinejs.vercel.app/docs/config#standalone-rules",
    },
    messages: { forbidden: "BigInt64Array/BigUint64Array are not allowed." },
    schema: [],
  },
  create(context) {
    function report(node: Node, name: string) {
      context.report({ node, messageId: "forbidden", data: { name } });
    }

    function resolveBigIntArrayBase(node: Node, parentNode: Node): string | null {
      if (isGlobalBaseNotShadowed(context, node, "BigInt64Array", parentNode)) {
        return "BigInt64Array";
      }
      if (isGlobalBaseNotShadowed(context, node, "BigUint64Array", parentNode)) {
        return "BigUint64Array";
      }
      return null;
    }

    return {
      NewExpression(node) {
        const name = resolveBigIntArrayBase(node.callee, node);
        if (name) {
          report(node.callee, name);
        }
      },
      CallExpression(node) {
        const name = resolveBigIntArrayBase(node.callee, node);
        if (name) {
          report(node.callee, name);
        }
      },
      MemberExpression(node) {
        const name = resolveBigIntArrayBase(node.object, node);
        if (name) {
          report(node.object, name);
        }
      },
    };
  },
};

export default rule;
