import { checks, probePluginName, reasons, sentinelPrefix } from "./protocol.mjs";

function unavailable(reason, observed = {}) {
  return { supported: false, observed: { ...observed, reason } };
}

function capabilityError(error, observed = {}) {
  return {
    supported: false,
    observed: { ...observed, error: error instanceof Error ? error.message : String(error) },
  };
}

function scopeObservation(sourceCode, receivers) {
  if (typeof sourceCode.getScope !== "function") return unavailable("getScope unavailable");
  const shadowed = [];
  for (const receiver of receivers) {
    let scope;
    try {
      scope = sourceCode.getScope(receiver);
    } catch (error) {
      return capabilityError(error);
    }
    if (!scope) return unavailable("getScope returned no scope");
    let isShadowed = false;
    while (scope) {
      if (typeof scope.set?.get !== "function") return unavailable("scope bindings unavailable");
      const variable = scope.set.get("Object");
      if (variable) {
        if (!Array.isArray(variable.defs)) return unavailable("binding definitions unavailable");
        isShadowed = scope.type !== "global" || variable.defs.length !== 0;
        break;
      }
      scope = scope.upper;
    }
    shadowed.push(isShadowed);
  }
  return { supported: receivers.length > 0, observed: { shadowed } };
}

function typeObservation(sourceCode, member) {
  const services = sourceCode.parserServices;
  const program = services?.program;
  const nodeMap = services?.esTreeNodeToTSNodeMap;
  const observed = {
    hasProgram: Boolean(program),
    hasNodeMap: typeof nodeMap?.get === "function",
    hasChecker: false,
  };
  if (!observed.hasProgram || !observed.hasNodeMap) {
    return unavailable(reasons.typedServicesUnavailable, observed);
  }
  if (!member) return unavailable("receiver fixture was not visited", observed);
  if (typeof program.getTypeChecker !== "function") {
    return unavailable("program.getTypeChecker unavailable", observed);
  }
  // Probe the actual receiver, rather than accepting a non-null parserServices stub.
  try {
    const checker = program.getTypeChecker();
    observed.hasChecker = Boolean(checker);
    if (
      typeof checker?.getTypeAtLocation !== "function" ||
      typeof checker.typeToString !== "function" ||
      typeof checker.getPropertyOfType !== "function"
    ) {
      return unavailable("receiver checker API unavailable", observed);
    }
    const tsNode = nodeMap.get(member.object);
    if (!tsNode) return unavailable("receiver node mapping unavailable", observed);
    const type = checker.getTypeAtLocation(tsNode);
    observed.receiverType = checker.typeToString(type);
    observed.property = member.property.name;
    observed.hasProperty = Boolean(checker.getPropertyOfType(type, observed.property));
    if (!observed.hasProperty || ["any", "unknown", "never"].includes(observed.receiverType)) {
      return unavailable("receiver type is unresolved or has no fixture member", observed);
    }
    const symbol = type.getSymbol?.() ?? type.aliasSymbol;
    const declarations = symbol?.getDeclarations?.() ?? [];
    if (typeof program.isSourceFileDefaultLibrary !== "function") {
      return unavailable("default library provenance API unavailable", observed);
    }
    observed.defaultLibrary = declarations.some((declaration) =>
      program.isSourceFileDefaultLibrary(declaration.getSourceFile()),
    );
    // Structural lookalikes are usable types too; provenance is an observation, not a gate.
    return { supported: true, observed };
  } catch (error) {
    return capabilityError(error, observed);
  }
}

const inspect = {
  meta: {
    type: "problem",
    fixable: "code",
    hasSuggestions: true,
    schema: [
      {
        type: "object",
        properties: {
          check: { enum: checks },
          suggestionsOnly: { type: "boolean" },
        },
        required: ["check"],
        additionalProperties: false,
      },
    ],
  },
  create(context) {
    const check = context.options[0]?.check;
    const { sourceCode } = context;
    const receivers = [];
    let member;
    let literal;
    let marker;
    let target;
    let selectorCount = 0;
    let selectorMember;

    function observation(program) {
      switch (check) {
        case "options":
          return { supported: true, observed: { configuredCheck: check, visited: true } };
        case "execution":
          return { supported: true, observed: { visited: true } };
        case "selectors":
          return {
            supported: selectorCount > 0,
            observed: {
              memberCalls: selectorCount,
              property: selectorMember?.property.name,
              computed: selectorMember?.computed,
            },
          };
        case "scope":
          return scopeObservation(sourceCode, receivers);
        case "source": {
          if (
            !literal ||
            typeof sourceCode.getText !== "function" ||
            typeof sourceCode.getFirstToken !== "function" ||
            typeof sourceCode.getTokens !== "function"
          ) {
            return unavailable("source text/token API unavailable");
          }
          try {
            return {
              supported: true,
              observed: {
                text: sourceCode.getText(literal),
                firstToken: sourceCode.getFirstToken(program)?.value,
                tokens: sourceCode.getTokens(program).map((token) => token.value),
              },
            };
          } catch (error) {
            return capabilityError(error);
          }
        }
        case "location":
          if (!marker?.loc) return unavailable("identifier location unavailable");
          return {
            supported: true,
            observed: {
              line: marker.loc.start.line,
              column: marker.loc.start.column + 1,
              endLine: marker.loc.end.line,
              endColumn: marker.loc.end.column + 1,
            },
          };
        case "fixes":
          if (!literal?.range) return unavailable("literal range unavailable");
          return {
            supported: true,
            observed: { literal: literal.value, range: literal.range },
          };
        case "ancestors": {
          if (!target || typeof sourceCode.getAncestors !== "function") {
            return unavailable("getAncestors unavailable");
          }
          try {
            const observed = {
              ancestors: sourceCode.getAncestors(target).map((node) => node.type),
              parentType: target.parent?.type ?? null,
            };
            return {
              supported: observed.ancestors.length > 0 && observed.parentType !== null,
              observed,
            };
          } catch (error) {
            return capabilityError(error);
          }
        }
        case "types":
          return typeObservation(sourceCode, member);
        default:
          return unavailable("unknown probe check");
      }
    }

    const listeners = {
      MemberExpression(node) {
        if (!member) member = node;
        if (node.object.type === "Identifier" && node.object.name === "Object") {
          receivers.push(node.object);
        }
      },
      Literal(node) {
        if (node.value === 1 && !literal) literal = node;
      },
      Identifier(node) {
        if (node.name === "marker") marker = node;
        if (node.name === "target") target = node;
      },
      "Program:exit"(program) {
        const result = observation(program);
        const report = {
          node: check === "location" && marker ? marker : program,
          message: `${sentinelPrefix}${JSON.stringify({ check, ...result })}`,
        };
        if (check === "fixes" && result.supported) {
          if (!context.options[0]?.suggestionsOnly) {
            report.fix = (fixer) => fixer.replaceText(literal, "2");
          }
          report.suggest = [
            {
              desc: "Replace one with three",
              fix: (fixer) => fixer.replaceText(literal, "3"),
            },
          ];
        }
        context.report(report);
      },
    };
    // Register the selector only for its own case, so selector support cannot mask
    // unrelated source, scope, or type capabilities in the other cases.
    if (check === "selectors") {
      listeners["CallExpression[callee.type='MemberExpression']"] = (node) => {
        selectorCount++;
        selectorMember = node.callee;
      };
    }
    return listeners;
  },
};

export default {
  meta: { name: probePluginName, version: "1.0.0" },
  rules: { inspect },
};
