import type { Rule } from "eslint";
import { isGlobalBaseNotShadowed } from "../../util/ast";

// TODO(improve-detection)
// - Detect deeper aliasing: const T = Temporal; T.Now.instant().
// - Consider ReferenceTracker to follow global Temporal across scopes.
// - Expand coverage to key namespaces (PlainDate, ZonedDateTime, Duration, etc.).

const rule: Rule.RuleModule = {
  meta: {
    type: "problem",
    docs: { description: "disallow Temporal API usage" },
    messages: { forbidden: "Temporal API usage is not allowed." },
    schema: [],
  },
  create(context) {
    function report(node: unknown) {
      context.report({ node: node as Rule.Node, messageId: "forbidden" });
    }
    return {
      MemberExpression(node: unknown) {
        const m = node as Record<string, unknown> & { parent?: unknown };
        const parent = m.parent as { type?: string; callee?: unknown } | undefined;
        if (parent?.type === "NewExpression" && parent.callee === node) return;
        if (m.computed === false && isGlobalBaseNotShadowed(context, m.object, "Temporal", node)) {
          report(m.object as unknown);
        }
      },
      NewExpression(node: unknown) {
        const n = node as { callee?: { type?: string; object?: unknown; name?: string } };
        if (n.callee?.type === "Identifier") {
          if (isGlobalBaseNotShadowed(context, n.callee, "Temporal", node)) {
            report(n.callee as unknown);
          }
          return;
        }
        if (
          n.callee?.type === "MemberExpression" &&
          isGlobalBaseNotShadowed(context, n.callee.object, "Temporal", node)
        ) {
          report(n.callee.object as unknown);
        }
      },
    };
  },
};

export default rule;
