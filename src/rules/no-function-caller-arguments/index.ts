import type { Rule, Scope } from "eslint";
import type { Node } from "estree";
import { getStaticMemberName, isGlobalBaseNotShadowed, stripChain } from "../../util/ast";

const rule: Rule.RuleModule = {
  meta: {
    type: "problem",
    docs: {
      description: "disallow Function#caller and Function#arguments",
      url: "https://baselinejs.vercel.app/docs/config#standalone-rules",
    },
    messages: { forbidden: "Function.caller/Function.arguments are forbidden." },
    schema: [],
  },
  create(context) {
    function isFunctionObject(node: Node): boolean {
      const receiver = stripChain(node);
      switch (receiver.type) {
        case "FunctionExpression":
        case "ArrowFunctionExpression":
          return true;
        case "MemberExpression":
          for (
            let scope: Scope.Scope | null = context.sourceCode.getScope(receiver);
            scope;
            scope = scope.upper
          ) {
            if (scope.type === "with") return false;
          }
          return (
            getStaticMemberName(receiver) === "prototype" &&
            isGlobalBaseNotShadowed(context, receiver.object, "Function", receiver)
          );
        case "Identifier":
          break;
        default:
          return false;
      }

      let scope: Scope.Scope | null = context.sourceCode.getScope(receiver);
      while (scope) {
        if (scope.type === "with") return false;
        const variable = scope.set.get(receiver.name);
        if (variable) {
          if (
            variable.defs.length !== 1 ||
            variable.references.some((reference) => reference.isWrite() && !reference.init)
          ) {
            return false;
          }
          const definition = variable.defs[0];
          if (definition.type === "FunctionName") return true;
          if (definition.type !== "Variable" || definition.node.id.type !== "Identifier") {
            return false;
          }
          const initializer = definition.node.init;
          return (
            initializer?.type === "FunctionExpression" ||
            initializer?.type === "ArrowFunctionExpression"
          );
        }
        scope = scope.upper;
      }
      return false;
    }
    return {
      MemberExpression(node) {
        if (node.computed || node.property.type !== "Identifier") return;
        const name = node.property.name;
        if (name !== "caller" && name !== "arguments") return;
        if (!isFunctionObject(node.object)) return;
        context.report({ node: node.property, messageId: "forbidden" });
      },
    };
  },
};

export default rule;
