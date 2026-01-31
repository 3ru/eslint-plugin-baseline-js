import type { Rule } from "eslint";
import { isGlobalNotShadowed } from "../../util/ast";

// TODO(spec-tracking)
// - Track proposal status; adjust behavior when standardized/renamed.
// - Consider alias detection (e.g., const a = Atomics.pause; a()).

const rule: Rule.RuleModule = {
  meta: {
    type: "problem",
    docs: { description: "disallow Atomics.pause() usage" },
    messages: { forbidden: "Atomics.pause is not allowed." },
    schema: [],
  },
  create(context) {
    function report(node: unknown) {
      context.report({ node: node as Rule.Node, messageId: "forbidden" });
    }

    function isAtomicsIdentifier(objectNode: unknown): boolean {
      const obj = objectNode as { type?: string; name?: string } | undefined;
      return obj?.type === "Identifier" && obj?.name === "Atomics";
    }

    return {
      CallExpression(node: unknown) {
        const n = node as Record<string, unknown>;
        const callee = n.callee as Record<string, unknown> | undefined;
        if (
          callee &&
          callee.type === "MemberExpression" &&
          callee.computed === false &&
          isAtomicsIdentifier(callee.object) &&
          (callee.property as Record<string, unknown>)?.type === "Identifier" &&
          (callee.property as Record<string, unknown>)?.name === "pause" &&
          isGlobalNotShadowed(context, "Atomics", node)
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
          isAtomicsIdentifier(m.object) &&
          (m.property as Record<string, unknown>)?.type === "Identifier" &&
          (m.property as Record<string, unknown>)?.name === "pause" &&
          isGlobalNotShadowed(context, "Atomics", node)
        ) {
          report(m.property);
        }
      },
    };
  },
};

export default rule;
