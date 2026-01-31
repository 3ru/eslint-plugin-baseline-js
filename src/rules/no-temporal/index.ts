import type { Rule } from "eslint";
import { isGlobalNotShadowed } from "../../util/ast";

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
    function isTemporalIdent(node: unknown): boolean {
      const n = node as Record<string, unknown>;
      return n && n.type === "Identifier" && n.name === "Temporal";
    }
    return {
      MemberExpression(node: unknown) {
        const m = node as Record<string, unknown>;
        if (
          m.computed === false &&
          isTemporalIdent(m.object) &&
          isGlobalNotShadowed(context, "Temporal", node)
        ) {
          report(m.object as unknown);
        }
      },
      NewExpression(node: unknown) {
        const n = node as Record<string, unknown>;
        if (isTemporalIdent(n.callee) && isGlobalNotShadowed(context, "Temporal", node)) {
          report(n.callee as unknown);
        }
      },
    };
  },
};

export default rule;
