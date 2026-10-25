import type { Rule } from "eslint";
import type { Node } from "estree";
import { getIncludedDescriptors, type IncludeOption } from "../baseline/loader";
import mapping from "../baseline/mapping/syntax";
import { parseDelegateRuleKey } from "../baseline/plugins";
import { isBeyondBaseline } from "../baseline/resolve";
import type { Descriptor } from "../baseline/types";
import { type CommonRuleOptions, getBaselineValue } from "../config";
import { buildListeners } from "../rules/feature-usage/builder";
import noAtomicsPause from "../rules/no-atomics-pause";
import noBigint64array from "../rules/no-bigint64array";
import noFunctionCallerArguments from "../rules/no-function-caller-arguments";
import noMathSumPrecise from "../rules/no-math-sum-precise";
import noTemporal from "../rules/no-temporal";
import { stripChain } from "../util/ast";
import { getTypedParserServices } from "../util/typed-parser-services";
import {
  listResolverPlugins,
  registerSelfRules,
  resolveDelegateRule,
} from "../utils/delegate-resolver";
import { mergeRuleListeners } from "../utils/listeners";
import { baselineMessage, delegateSubject, descriptorSubject } from "./messages";

type ListenerMap = Rule.RuleListener;

interface DescriptorPlan {
  readonly descriptors: readonly Descriptor[];
  readonly beyondBaseline: ReadonlySet<Descriptor>;
}

interface CachedDescriptorPlans {
  readonly signature: string;
  readonly variants: Map<boolean, DescriptorPlan>;
}

const EMPTY_OPTIONS: CommonRuleOptions = {};
const descriptorPlans = new WeakMap<CommonRuleOptions, CachedDescriptorPlans>();

function unwrapReportedChain(node: object): object {
  while (
    "type" in node &&
    node.type === "ChainExpression" &&
    "expression" in node &&
    typeof node.expression === "object" &&
    node.expression !== null
  ) {
    node = node.expression;
  }
  return node;
}

function delegateReference(node: object): object {
  const reference = unwrapReportedChain(node);
  if (
    "type" in reference &&
    (reference.type === "CallExpression" || reference.type === "NewExpression") &&
    "callee" in reference &&
    typeof reference.callee === "object" &&
    reference.callee !== null
  ) {
    return unwrapReportedChain(reference.callee);
  }
  return reference;
}

function buildDelegateContext(
  ctx: Rule.RuleContext,
  overrides: Record<string, unknown>,
): Record<string, unknown> {
  const src = ctx as unknown as Record<string, unknown>;
  const delegateCtx: Record<string, unknown> = {};

  // Forward properties that delegates actually consume
  if (src.sourceCode != null) delegateCtx.sourceCode = src.sourceCode;
  if (src.settings != null) delegateCtx.settings = src.settings;

  // parserServices may live on ctx directly or on sourceCode (ESLint 10)
  type CtxWithPS = { parserServices?: unknown; sourceCode?: { parserServices?: unknown } };
  const cx = ctx as unknown as CtxWithPS;
  const ps = cx.parserServices ?? cx.sourceCode?.parserServices;
  if (ps != null) delegateCtx.parserServices = ps;

  // Apply caller overrides (options, report, parserOptions, etc.)
  for (const [k, v] of Object.entries(overrides)) {
    delegateCtx[k] = v;
  }

  return delegateCtx;
}

// Register project-local rules once so they can be resolved via the 'self' plugin.
const SELF_RULES: Record<string, Rule.RuleModule> = {
  "no-atomics-pause": noAtomicsPause,
  "no-bigint64array": noBigint64array,
  "no-function-caller-arguments": noFunctionCallerArguments,
  "no-math-sum-precise": noMathSumPrecise,
  "no-temporal": noTemporal,
};
registerSelfRules(SELF_RULES);

const rule: Rule.RuleModule = {
  meta: {
    type: "problem",
    docs: {
      description: "Enforce JS Baseline by delegating to underlying syntax rules (es-x)",
      url: "https://baselinejs.vercel.app/docs/config#rule-options",
    },
    schema: [
      {
        type: "object",
        properties: {
          baseline: {
            anyOf: [{ enum: ["widely", "newly"] }, { type: "number" }],
            default: "widely",
          },
          available: {
            anyOf: [{ enum: ["widely", "newly"] }, { type: "number" }],
            default: "widely",
          },
          ignoreFeatures: { type: "array", items: { type: "string" } },
          ignoreNodeTypes: { type: "array", items: { type: "string" } },
          includeWebApis: {
            anyOf: [
              { type: "boolean" },
              {
                type: "object",
                properties: {
                  preset: { enum: ["auto", "safe", "type-aware", "heuristic"] },
                  useTypes: { enum: ["off", "auto", "require"] },
                  heuristics: { enum: ["off", "conservative", "aggressive"] },
                  only: { type: "array", items: { type: "string" } },
                  ignore: { type: "array", items: { type: "string" } },
                },
                additionalProperties: false,
              },
            ],
          },
          includeJsBuiltins: {
            anyOf: [
              { type: "boolean" },
              {
                type: "object",
                properties: {
                  preset: { enum: ["auto", "safe", "type-aware", "heuristic"] },
                  useTypes: { enum: ["off", "auto", "require"] },
                  heuristics: { enum: ["off", "conservative", "aggressive"] },
                  only: { type: "array", items: { type: "string" } },
                  ignore: { type: "array", items: { type: "string" } },
                },
                additionalProperties: false,
              },
            ],
          },
        },
        additionalProperties: false,
      },
    ],
  },
  create(ctx) {
    const _DEBUG = process.env.BASELINE_DEBUG === "1";
    const sourceCode = ctx.sourceCode;
    const ast = sourceCode.ast as { type?: string } | undefined;
    // Avoid running when the parser did not produce a JS Program (eg, non-ESTree processors)
    if (ast?.type && ast.type !== "Program") return {};
    const opt = (ctx.options[0] ?? EMPTY_OPTIONS) as CommonRuleOptions;
    const baseline = getBaselineValue(opt);
    const ignoreFeaturePatterns = (opt.ignoreFeatures ?? []) as string[];
    const ignoreNodeTypePatterns = (opt.ignoreNodeTypes ?? []) as string[];
    const includeWebApis = opt.includeWebApis ?? false;
    const includeJsBuiltins = opt.includeJsBuiltins ?? false;

    function makeMatcher(
      patterns: string[],
      option: "ignoreFeatures" | "ignoreNodeTypes",
    ): ((s: string) => boolean) | null {
      if (!patterns.length) return null;
      const compiled = patterns.map((p) => {
        if (p.startsWith("/") && p.endsWith("/") && p.length >= 2) {
          const expr = p.slice(1, -1);
          try {
            return new RegExp(expr);
          } catch (error) {
            if (error instanceof SyntaxError) {
              error.message = `Invalid ${option} pattern ${JSON.stringify(p)}. ${error.message}`;
            }
            throw error;
          }
        }
        return p;
      });
      return (s: string) => compiled.some((m) => (m instanceof RegExp ? m.test(s) : m === s));
    }

    const matchIgnoreFeature = makeMatcher(ignoreFeaturePatterns, "ignoreFeatures");
    const matchIgnoreNodeType = makeMatcher(ignoreNodeTypePatterns, "ignoreNodeTypes");

    const entries: Array<{ featureId: string; delegateRule: string }> = [];
    const map = mapping as Record<
      string,
      {
        kind: "syntax" | "api" | "meta";
        delegates: ReadonlyArray<{ plugin: string; rule: string; options?: unknown }>;
      }
    >;
    for (const [featureId, entry] of Object.entries(map)) {
      if (entry.kind !== "syntax") continue;
      if (matchIgnoreFeature?.(featureId)) continue;
      if (!isBeyondBaseline(featureId, baseline)) continue;
      for (const d of entry.delegates) {
        if (d.plugin === "es-x") entries.push({ featureId, delegateRule: d.rule });
        else entries.push({ featureId, delegateRule: `${d.plugin}/${d.rule}` });
      }
    }

    const listeners: ListenerMap = {};
    const mappedFeatureIds = new Set(entries.map((e) => e.featureId));
    const pendingDelegates: Array<{ featureId: string; report: Rule.ReportDescriptor }> = [];
    const claimedFeatures = new WeakMap<object, Set<string>>();
    const reportedFeatures = new WeakMap<Node, Set<string>>();

    function addFeature<N extends object>(
      featuresByNode: WeakMap<N, Set<string>>,
      node: N,
      featureId: string,
    ) {
      let features = featuresByNode.get(node);
      if (features?.has(featureId)) return false;
      if (!features) {
        features = new Set();
        featuresByNode.set(node, features);
      }
      features.add(featureId);
      return true;
    }

    function claimReference(reference: Node, featureId: string) {
      const node = stripChain(reference);
      if (node.type !== "Identifier" && node.type !== "MemberExpression") return;
      addFeature(claimedFeatures, node, featureId);
      if (node.type === "MemberExpression") {
        addFeature(claimedFeatures, node.property, featureId);
        claimReference(node.object, featureId);
      }
    }

    if (_DEBUG) {
      // eslint-disable-next-line no-console
      console.log(
        `[baseline-js] resolvers=${listResolverPlugins().join(",")} entries=${entries.length}`,
      );
    }

    for (const { featureId, delegateRule } of entries) {
      const { plugin, name } = parseDelegateRuleKey(delegateRule);
      let delegateOptions: unknown[] = [];

      // Find mapping entry to pull options (if any)
      const mappingEntry = map[featureId] as
        | { delegates: ReadonlyArray<{ plugin: string; options?: unknown }> }
        | undefined;
      if (mappingEntry) {
        const d = mappingEntry.delegates.find((x) => x.plugin === plugin);
        if (d?.options) {
          // context.options is the array as provided after level
          delegateOptions = Array.isArray(d.options) ? d.options : [d.options];
        }
      }

      const impl = resolveDelegateRule(plugin, name);
      if (!impl?.create) continue;

      // Force es-x delegates to consider syntax as "unsupported" by lowering ecmaVersion.
      const origParserOptions =
        (ctx as unknown as { parserOptions?: Record<string, unknown> }).parserOptions ?? {};
      const origLangOpts =
        (ctx as unknown as { languageOptions?: Record<string, unknown> }).languageOptions ?? {};
      const delegateCtx = buildDelegateContext(ctx, {
        parserOptions: { ...origParserOptions, ecmaVersion: 3 },
        languageOptions: {
          ...origLangOpts,
          ecmaVersion: 3,
          parserOptions: {
            ...((origLangOpts.parserOptions as Record<string, unknown> | undefined) ?? {}),
            ecmaVersion: 3,
          },
        },
        options: delegateOptions,
        report(arg: Rule.ReportDescriptor) {
          if ("node" in arg && matchIgnoreNodeType?.(arg.node.type)) return;
          pendingDelegates.push({ featureId, report: arg });
        },
      });

      const l = impl.create(delegateCtx as unknown as Rule.RuleContext);
      mergeRuleListeners(listeners, l);
    }
    // Resolve typed mode
    function resolveUseTypes(option: IncludeOption): "off" | "auto" | "require" {
      if (option === false || option === true) return "off";
      if (option.useTypes) return option.useTypes;
      if (option.preset === "type-aware") return "require";
      return option.preset === "auto" ? "auto" : "off";
    }
    const typedAvailable = getTypedParserServices(ctx) !== undefined;
    const useTypesWeb = resolveUseTypes(includeWebApis);
    const useTypesJs = resolveUseTypes(includeJsBuiltins);
    const typedWebEnabled = useTypesWeb !== "off" && typedAvailable;
    const typedJsEnabled = useTypesJs !== "off" && typedAvailable;
    const typedEnabled = typedWebEnabled || typedJsEnabled;

    const signature = JSON.stringify([String(baseline), opt]);
    const cachedPlans = descriptorPlans.get(opt);
    let plan =
      cachedPlans?.signature === signature ? cachedPlans.variants.get(typedAvailable) : undefined;
    if (!plan) {
      function getEnabledDescriptors(
        options: Parameters<typeof getIncludedDescriptors>[0],
        useTypes: boolean,
      ) {
        return getIncludedDescriptors(options).filter(
          (descriptor) =>
            useTypes || (descriptor.kind !== "instanceMember" && !descriptor.typedOnly),
        );
      }

      let descriptors = [
        ...getEnabledDescriptors({ webApis: includeWebApis }, typedWebEnabled),
        ...getEnabledDescriptors({ jsBuiltins: includeJsBuiltins }, typedJsEnabled),
      ];
      if (matchIgnoreFeature) {
        descriptors = descriptors.filter((d) => !matchIgnoreFeature(d.featureId));
      }
      const beyondBaseline = new Set(
        descriptors.filter((d) => isBeyondBaseline(d.featureId, baseline, d.compatKey)),
      );
      descriptors = descriptors.filter(
        (d) => beyondBaseline.has(d) || mappedFeatureIds.has(d.featureId),
      );
      plan = { descriptors, beyondBaseline };
      if (cachedPlans?.signature === signature) {
        cachedPlans.variants.set(typedAvailable, plan);
      } else {
        descriptorPlans.set(opt, { signature, variants: new Map([[typedAvailable, plan]]) });
      }
    }
    const { descriptors, beyondBaseline } = plan;

    if (descriptors.length > 0) {
      const generic = buildListeners(ctx, {
        descriptors,
        typed: typedEnabled,
        onMatch({ node, reference, descriptor }) {
          if (mappedFeatureIds.has(descriptor.featureId)) {
            claimReference(reference, descriptor.featureId);
          }
          if (!beyondBaseline.has(descriptor)) return;
          if (matchIgnoreNodeType?.(node.type)) return;
          if (!addFeature(reportedFeatures, node, descriptor.featureId)) return;

          ctx.report({
            node,
            message: baselineMessage(
              descriptor.featureId,
              baseline,
              descriptorSubject(descriptor),
              descriptor.compatKey,
            ),
          });
        },
      });
      mergeRuleListeners(listeners, generic);
    }

    mergeRuleListeners(listeners, {
      "Program:exit"() {
        for (const { featureId, report } of pendingDelegates.splice(0)) {
          if ("node" in report) {
            if (claimedFeatures.get(delegateReference(report.node))?.has(featureId)) continue;
          }
          const subject = report.data?.name ? delegateSubject(String(report.data.name)) : undefined;
          const message = baselineMessage(featureId, baseline, subject);
          if ("node" in report) ctx.report({ node: report.node, message });
          else ctx.report({ loc: report.loc, message });
        }
      },
    });

    return listeners;
  },
};

export default rule;
