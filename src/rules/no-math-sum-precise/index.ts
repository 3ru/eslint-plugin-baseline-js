import type { Rule } from "eslint";
import { isGlobalNotShadowed } from "../../util/ast";

// TODO(spec-tracking)
// - Track proposal status; adjust behavior when standardized/renamed.
// - Consider alias detection (e.g., const s = Math.sumPrecise; s()).

const rule: Rule.RuleModule = {
  meta: {
    type: "problem",
    docs: { description: "disallow Math.sumPrecise() usage" },
    messages: { forbidden: "Math.sumPrecise is not allowed." },
    schema: [],
  },
  create(context) {
    function report(node: unknown) {
      context.report({ node: node as Rule.Node, messageId: "forbidden" });
    }

    function isMathIdentifier(objectNode: unknown): boolean {
      const obj = objectNode as { type?: string; name?: string } | undefined;
      return obj?.type === "Identifier" && obj?.name === "Math";
    }

    return {
      CallExpression(node: unknown) {
        const n = node as Record<string, unknown>;
        const callee = n.callee as Record<string, unknown> | undefined;
        if (
          callee &&
          callee.type === "MemberExpression" &&
          callee.computed === false &&
          isMathIdentifier(callee.object) &&
          (callee.property as Record<string, unknown>)?.type === "Identifier" &&
          (callee.property as Record<string, unknown>)?.name === "sumPrecise" &&
          isGlobalNotShadowed(context, "Math", node)
        ) {
          report(callee.property);
        }
      },
      MemberExpression(node: unknown) {
        const m = node as Record<string, unknown> & { parent?: unknown };
        // Avoid duplicate reports when this MemberExpression is the callee of a CallExpression
        const parent = m.parent as { type?: string; callee?: unknown } | undefined;
        if (parent?.type === "CallExpression" && parent.callee === node) return;
        if (
          m.computed === false &&
          isMathIdentifier(m.object) &&
          (m.property as Record<string, unknown>)?.type === "Identifier" &&
          (m.property as Record<string, unknown>)?.name === "sumPrecise" &&
          isGlobalNotShadowed(context, "Math", node)
        ) {
          report(m.property);
        }
      },
    };
  },
};

export default rule;
