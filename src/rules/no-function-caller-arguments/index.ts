import type { Rule } from "eslint";

// TODO(improve-precision)
// - Narrow to function objects only using scope/defs or type info (TS-aware).
// - Avoid false positives on arbitrary `.caller`/`.arguments` on non-function objects.
// - Consider ReferenceTracker to detect Function.prototype aliases.

// NOTE: Currently, this rule reports any `.caller`/`.arguments` member access;
//       type-aware narrowing is planned and not implemented yet.

const rule: Rule.RuleModule = {
  meta: {
    type: "problem",
    docs: { description: "disallow Function#caller and Function#arguments" },
    messages: { forbidden: "Function.caller/Function.arguments are forbidden." },
    schema: [],
  },
  create(context) {
    function report(node: unknown) {
      context.report({ node: node as Rule.Node, messageId: "forbidden" });
    }
    return {
      MemberExpression(node: unknown) {
        const m = node as Record<string, unknown>;
        const prop = m.property as Record<string, unknown> | undefined;
        if (!prop || m.computed) return;
        if (prop.type !== "Identifier") return;
        const pname = prop.name as string | undefined;
        if (pname !== "caller" && pname !== "arguments") return;
        // Heuristic: report any `.caller`/`.arguments` access; refine with type info in future
        report(prop as unknown);
      },
    };
  },
};

export default rule;
