import type { Rule } from "eslint";
import type { Node } from "estree";
import { isGlobalBaseNotShadowed } from "../../util/ast";

// TODO(spec-tracking)
// - Track proposal status; adjust behavior when standardized/renamed.
// - Consider alias detection (e.g., const s = Math.sumPrecise; s()).

const rule: Rule.RuleModule = {
  meta: {
    type: "problem",
    docs: {
      description: "disallow Math.sumPrecise() usage",
      url: "https://baselinejs.vercel.app/docs/config#standalone-rules",
    },
    messages: { forbidden: "Math.sumPrecise is not allowed." },
    schema: [],
  },
  create(context) {
    function report(node: Node) {
      context.report({ node, messageId: "forbidden" });
    }

    return {
      CallExpression(node) {
        const callee = node.callee;
        if (
          callee.type === "MemberExpression" &&
          callee.computed === false &&
          isGlobalBaseNotShadowed(context, callee.object, "Math", node) &&
          callee.property.type === "Identifier" &&
          callee.property.name === "sumPrecise"
        ) {
          report(callee.property);
        }
      },
      MemberExpression(node) {
        // Avoid duplicate reports when this MemberExpression is the callee of a CallExpression
        const parent = node.parent;
        if (parent.type === "CallExpression" && parent.callee === node) return;
        if (
          node.computed === false &&
          isGlobalBaseNotShadowed(context, node.object, "Math", node) &&
          node.property.type === "Identifier" &&
          node.property.name === "sumPrecise"
        ) {
          report(node.property);
        }
      },
    };
  },
};

export default rule;
