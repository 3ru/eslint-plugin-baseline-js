import { checks, probePluginName, reasons, sentinelPrefix } from "./protocol.mjs";

/** @typedef {import("./types.ts").Check} Check */
/** @typedef {import("./types.ts").Observations} Observations */
/** @typedef {import("./types.ts").ProbeMessage} ProbeMessage */
/** @typedef {import("./types.ts").ProbeOptions} ProbeOptions */
/** @typedef {import("estree").Identifier} Identifier */
/** @typedef {import("estree").Literal} Literal */
/** @typedef {import("estree").MemberExpression} MemberExpression */
/** @typedef {import("estree").Program} Program */
/** @typedef {import("eslint").Rule.NodeParentExtension} WithParent */
/** @typedef {Partial<import("eslint").SourceCode>} HostSourceCode */
/** @typedef {Partial<import("eslint").Scope.Scope>} HostScope */
/** @typedef {MemberExpression & { computed: false, property: Identifier }} NamedMember */

/**
 * @typedef {Partial<Pick<import("typescript").Program, "getTypeChecker" | "isSourceFileDefaultLibrary">>} TsProgram
 */
/**
 * @typedef {{
 *   program?: TsProgram | null,
 *   esTreeNodeToTSNodeMap?: { get?: (node: import("estree").Node) => import("typescript").Node | undefined },
 * }} TypedServices
 */

/**
 * @template {Check} C
 * @param {C} check
 * @param {Observations[C]} observed
 * @returns {import("./types.ts").Supported<C>}
 */
function supported(check, observed) {
  return { check, supported: true, observed };
}

/**
 * @template {Check} C
 * @param {C} check
 * @param {string} reason
 * @param {Partial<Observations[C]>} observed
 * @returns {import("./types.ts").NotSupported<C>}
 */
function unavailable(check, reason, observed) {
  return { check, supported: false, observed: { ...observed, reason } };
}

/**
 * @template {Check} C
 * @param {C} check
 * @param {unknown} error
 * @param {Partial<Observations[C]>} observed
 * @returns {import("./types.ts").NotSupported<C>}
 */
function capabilityError(check, error, observed) {
  const message = error instanceof Error ? error.message : String(error);
  return { check, supported: false, observed: { ...observed, error: message } };
}

/**
 * @param {MemberExpression} node
 * @param {string | undefined} name
 * @returns {node is NamedMember}
 */
function isNamedMember(node, name) {
  return !node.computed && node.property.type === "Identifier" && node.property.name === name;
}

/**
 * @param {HostSourceCode} sourceCode
 * @param {Identifier[]} receivers
 * @returns {ProbeMessage}
 */
function scopeObservation(sourceCode, receivers) {
  if (receivers.length === 0) return unavailable("scope", reasons.fixtureNodeNotVisited, {});
  if (typeof sourceCode.getScope !== "function") {
    return unavailable("scope", "getScope unavailable", {});
  }
  /** @type {boolean[]} */
  const shadowed = [];
  for (const receiver of receivers) {
    /** @type {HostScope | null | undefined} */
    let scope;
    try {
      scope = sourceCode.getScope(receiver);
    } catch (error) {
      return capabilityError("scope", error, {});
    }
    if (!scope) return unavailable("scope", "getScope returned no scope", {});
    let isShadowed = false;
    while (scope) {
      if (typeof scope.set?.get !== "function") {
        return unavailable("scope", "scope bindings unavailable", {});
      }
      /** @type {Partial<import("eslint").Scope.Variable> | undefined} */
      const variable = scope.set.get("Object");
      if (variable) {
        if (!Array.isArray(variable.defs)) {
          return unavailable("scope", "binding definitions unavailable", {});
        }
        isShadowed = scope.type !== "global" || variable.defs.length !== 0;
        break;
      }
      scope = scope.upper;
    }
    shadowed.push(isShadowed);
  }
  return supported("scope", { shadowed });
}

/**
 * @param {HostSourceCode} sourceCode
 * @param {NamedMember | undefined} member
 * @returns {ProbeMessage}
 */
function typeObservation(sourceCode, member) {
  /** @type {TypedServices | undefined} */
  const services = sourceCode.parserServices;
  const program = services?.program;
  const nodeMap = services?.esTreeNodeToTSNodeMap;
  const observed = {
    hasProgram: Boolean(program),
    hasNodeMap: typeof nodeMap?.get === "function",
    hasChecker: false,
  };
  if (!program || typeof nodeMap?.get !== "function") {
    return unavailable("types", reasons.typedServicesUnavailable, observed);
  }
  if (!member) return unavailable("types", reasons.fixtureNodeNotVisited, observed);
  if (typeof program.getTypeChecker !== "function") {
    return unavailable("types", "program.getTypeChecker unavailable", observed);
  }
  try {
    const checker = program.getTypeChecker();
    observed.hasChecker = Boolean(checker);
    const tsNode = nodeMap.get(member.object);
    if (!tsNode) return unavailable("types", "receiver node mapping unavailable", observed);
    const type = checker.getTypeAtLocation(tsNode);
    const property = member.property.name;
    const receiverType = checker.typeToString(type);
    const hasProperty = Boolean(checker.getPropertyOfType(type, property));
    if (!hasProperty) {
      return unavailable("types", "receiver type has no fixture member", {
        ...observed,
        receiverType,
        property,
        hasProperty,
      });
    }
    if (typeof program.isSourceFileDefaultLibrary !== "function") {
      return unavailable("types", "default library provenance API unavailable", {
        ...observed,
        receiverType,
        property,
        hasProperty,
      });
    }
    const symbol = type.getSymbol() ?? type.aliasSymbol;
    let defaultLibrary = false;
    for (const declaration of symbol?.getDeclarations() ?? []) {
      if (program.isSourceFileDefaultLibrary(declaration.getSourceFile())) {
        defaultLibrary = true;
        break;
      }
    }
    return supported("types", { ...observed, receiverType, property, hasProperty, defaultLibrary });
  } catch (error) {
    return capabilityError("types", error, observed);
  }
}

/** @type {import("eslint").Rule.RuleModule} */
const inspect = {
  meta: {
    type: "problem",
    schema: [
      {
        type: "object",
        properties: {
          check: { enum: [...checks] },
          member: { type: "string" },
        },
        required: ["check"],
        additionalProperties: false,
      },
    ],
  },
  create(context) {
    /** @type {Partial<ProbeOptions> | undefined} */
    const options = context.options[0];
    const requested = options?.check;
    const check = requested !== undefined && checks.includes(requested) ? requested : undefined;
    /** @type {HostSourceCode} */
    const sourceCode = context.sourceCode;
    /** @type {Identifier[]} */
    const receivers = [];
    /** @type {NamedMember | undefined} */
    let member;
    /** @type {Literal | undefined} */
    let literal;
    /** @type {Identifier | undefined} */
    let marker;
    /** @type {(Identifier & WithParent) | undefined} */
    let target;
    let selectorCount = 0;
    /** @type {MemberExpression | undefined} */
    let selectorMember;

    /**
     * @param {Program} program
     * @returns {ProbeMessage}
     */
    function observation(program) {
      if (check === undefined) {
        const reason =
          requested === undefined
            ? reasons.optionsNotDelivered
            : `unknown probe check ${String(requested)}`;
        return { check: undefined, supported: false, observed: { reason } };
      }
      switch (check) {
        case "options":
          return supported("options", { configuredCheck: "options", visited: true });
        case "execution":
          return supported("execution", { visited: true });
        case "selectors":
          if (selectorCount === 0) {
            return unavailable("selectors", "attribute selector matched no node", {
              memberCalls: 0,
            });
          }
          if (!selectorMember) {
            return unavailable(
              "selectors",
              "attribute selector matched only calls without a member callee",
              { memberCalls: selectorCount },
            );
          }
          return supported("selectors", {
            memberCalls: selectorCount,
            property:
              selectorMember.property.type === "Identifier"
                ? selectorMember.property.name
                : undefined,
            computed: selectorMember.computed,
          });
        case "scope":
          return scopeObservation(sourceCode, receivers);
        case "source": {
          if (!literal) return unavailable("source", reasons.fixtureNodeNotVisited, {});
          if (
            typeof sourceCode.getText !== "function" ||
            typeof sourceCode.getFirstToken !== "function" ||
            typeof sourceCode.getTokens !== "function"
          ) {
            return unavailable("source", "source text/token API unavailable", {});
          }
          try {
            return supported("source", {
              text: sourceCode.getText(literal),
              firstToken: sourceCode.getFirstToken(program)?.value,
              tokens: sourceCode.getTokens(program).map((token) => token.value),
            });
          } catch (error) {
            return capabilityError("source", error, {});
          }
        }
        case "location":
          if (!marker) return unavailable("location", reasons.fixtureNodeNotVisited, {});
          if (!marker.loc) return unavailable("location", "identifier location unavailable", {});
          return supported("location", {
            line: marker.loc.start.line,
            column: marker.loc.start.column + 1,
            endLine: marker.loc.end.line,
            endColumn: marker.loc.end.column + 1,
          });
        case "ancestors": {
          if (!target) return unavailable("ancestors", reasons.fixtureNodeNotVisited, {});
          if (typeof sourceCode.getAncestors !== "function") {
            return unavailable("ancestors", "getAncestors unavailable", {});
          }
          try {
            const observed = {
              ancestors: sourceCode.getAncestors(target).map((node) => node.type),
              parentType: target.parent?.type ?? null,
            };
            if (observed.ancestors.length === 0 || observed.parentType === null) {
              return unavailable("ancestors", "getAncestors returned no ancestry", observed);
            }
            return supported("ancestors", observed);
          } catch (error) {
            return capabilityError("ancestors", error, {});
          }
        }
        case "types":
          return typeObservation(sourceCode, member);
      }
    }

    /** @type {import("eslint").Rule.RuleListener} */
    const listeners = {
      MemberExpression(node) {
        if (!member && isNamedMember(node, options?.member)) member = node;
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
        const payload = observation(program);
        const node = check === "location" && marker ? marker : program;
        const message = `${sentinelPrefix}${JSON.stringify(payload)}`;
        context.report({ node, message });
      },
    };
    if (check === "selectors") {
      listeners["CallExpression[callee.type='MemberExpression']"] =
        /** @param {import("estree").CallExpression & WithParent} node */ (node) => {
          selectorCount++;
          if (node.callee.type === "MemberExpression") selectorMember = node.callee;
        };
    }
    return listeners;
  },
};

export default /** @satisfies {import("eslint").ESLint.Plugin} */ ({
  meta: { name: probePluginName, version: "1.0.0" },
  rules: { inspect },
});
