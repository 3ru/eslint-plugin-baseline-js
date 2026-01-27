import type { Rule } from "eslint";

// TODO(spec-tracking)
// - Track proposal status; adjust behavior when standardized/renamed.
// - Consider alias detection (e.g., const a = Atomics.pause; a()).
// - Ensure no conflicts with future Atomics APIs (guard by global Atomics).

const rule: Rule.RuleModule = {
  meta: {
    type: "problem",
    docs: { description: "disallow Atomics.pause() usage" },
    messages: { forbidden: "Atomics.pause is not allowed." },
    schema: [],
  },
  create(context) {
    function report(node: unknown) {
      context.report({ node: node as unknown as Rule.Node, messageId: "forbidden" });
    }
    return {
      CallExpression(node: unknown) {
        const n = node as Record<string, unknown>;
        const callee = n.callee as Record<string, unknown> | undefined;
        if (
          callee &&
          callee.type === "MemberExpression" &&
          callee.computed === false &&
          (callee.object as Record<string, unknown>)?.type === "Identifier" &&
          (callee.object as Record<string, unknown>)?.name === "Atomics" &&
          (callee.property as Record<string, unknown>)?.type === "Identifier" &&
          (callee.property as Record<string, unknown>)?.name === "pause"
        ) {
          report(callee.property as Record<string, unknown> as unknown);
        }
      },
      MemberExpression(node: unknown) {
        const m = node as Record<string, unknown> & { parent?: unknown };
        // Avoid duplicate reports when this MemberExpression is the callee of a CallExpression
        const parent = m.parent as { type?: string; callee?: unknown } | undefined;
        if (parent?.type === "CallExpression" && parent.callee === node) return;
        if (
          m.computed === false &&
          (m.object as Record<string, unknown>)?.type === "Identifier" &&
          (m.object as Record<string, unknown>)?.name === "Atomics" &&
          (m.property as Record<string, unknown>)?.type === "Identifier" &&
          (m.property as Record<string, unknown>)?.name === "pause"
        ) {
          report(m.property as Record<string, unknown> as unknown);
        }
      },
    };
  },
};

export default rule;
