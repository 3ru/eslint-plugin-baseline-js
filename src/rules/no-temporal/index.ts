import type { Rule } from "eslint";
import type { Node } from "estree";
import { isGlobalBaseNotShadowed } from "../../util/ast";

// TODO(improve-detection)
// - Detect deeper aliasing: const T = Temporal; T.Now.instant().
// - Consider ReferenceTracker to follow global Temporal across scopes.
// - Expand coverage to key namespaces (PlainDate, ZonedDateTime, Duration, etc.).

const rule: Rule.RuleModule = {
  meta: {
    type: "problem",
    docs: {
      description: "disallow Temporal API usage",
      url: "https://baselinejs.vercel.app/docs/config#standalone-rules",
    },
    messages: { forbidden: "Temporal API usage is not allowed." },
    schema: [],
  },
  create(context) {
    function report(node: Node) {
      context.report({ node, messageId: "forbidden" });
    }
    return {
      MemberExpression(node) {
        const parent = node.parent;
        if (parent.type === "NewExpression" && parent.callee === node) return;
        if (
          node.computed === false &&
          isGlobalBaseNotShadowed(context, node.object, "Temporal", node)
        ) {
          report(node.object);
        }
      },
      NewExpression(node) {
        const callee = node.callee;
        if (callee.type === "Identifier") {
          if (isGlobalBaseNotShadowed(context, callee, "Temporal", node)) {
            report(callee);
          }
          return;
        }
        if (
          callee.type === "MemberExpression" &&
          isGlobalBaseNotShadowed(context, callee.object, "Temporal", node)
        ) {
          report(callee.object);
        }
      },
    };
  },
};

export default rule;
