import type { Rule } from "eslint";
import { getIncludedDescriptors } from "../baseline/loader";
import mapping from "../baseline/mapping/syntax";
import { parseDelegateRuleKey } from "../baseline/plugins";
import { getFeatureRecord, isBeyondBaseline } from "../baseline/resolve";
import { type CommonRuleOptions, getBaselineValue } from "../config";
import featureUsage from "../rules/feature-usage";
import noBigint64array from "../rules/no-bigint64array";
import noFunctionCallerArguments from "../rules/no-function-caller-arguments";
import noMathSumPrecise from "../rules/no-math-sum-precise";
import noTemporal from "../rules/no-temporal";
import {
  listResolverPlugins,
  registerSelfRules,
  resolveDelegateRule,
} from "../utils/delegate-resolver";
import { mergeRuleListeners } from "../utils/listeners";

type ListenerMap = Rule.RuleListener;

// Register project-local rules once so they can be resolved via the 'self' plugin.
const SELF_RULES: Record<string, Rule.RuleModule> = {
  "no-bigint64array": noBigint64array,
  "no-function-caller-arguments": noFunctionCallerArguments,
  "no-math-sum-precise": noMathSumPrecise,
  "no-temporal": noTemporal,
};
registerSelfRules(SELF_RULES);

function baselineMessage(featureId: string, baseline: ReturnType<typeof getBaselineValue>) {
  const rec = getFeatureRecord(featureId);
  const label = rec?.name || featureId;
  const idSuffix = rec?.name ? ` (${featureId})` : "";
  if (baseline === "widely") {
    return `Feature '${label}'${idSuffix} is not a widely available Baseline feature.`;
  }
  if (baseline === "newly") {
    return `Feature '${label}'${idSuffix} is not a newly available Baseline feature.`;
  }
  // Year-based messaging
  const isLimited = rec?.status?.baseline === false;
  if (isLimited) {
    return `Feature '${label}'${idSuffix} has Limited availability and exceeds ${baseline}.`;
  }
  const year =
    rec?.status?.baseline_low_date?.slice(0, 4) ||
    rec?.status?.baseline_high_date?.slice(0, 4) ||
    "unknown";
  return `Feature '${label}'${idSuffix} became Baseline in ${year} and exceeds ${baseline}.`;
}

const rule: Rule.RuleModule = {
  meta: {
    type: "problem",
    docs: { description: "Enforce JS Baseline by delegating to underlying syntax rules (es-x)" },
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
    // Guard: run only for JS/TS files. This prevents initialization on non-JS
    // languages (e.g., CSS/HTML) where delegate rules may assume ESTree/TS services.
    const getFilename = (ctx as unknown as { getFilename?: () => unknown }).getFilename;
    let filename: string | null = null;
    if (typeof getFilename === "function") {
      const value = getFilename.call(ctx as unknown as object);
      if (typeof value === "string" && !value.startsWith("<")) filename = value;
    }
    if (filename) {
      // Accept common JS/TS extensions
      const isJsLike = /\.(?:[mc]?[jt]s|[jt]sx)$/i.test(filename);
      if (!isJsLike) return {};
    }
    const opt = (ctx.options[0] ?? {}) as CommonRuleOptions;
    const baseline = getBaselineValue(opt);
    const ignoreFeaturePatterns = (opt.ignoreFeatures ?? []) as string[];
    const ignoreNodeTypePatterns = (opt.ignoreNodeTypes ?? []) as string[];
    const includeWebApis = opt.includeWebApis ?? false;
    const includeJsBuiltins = opt.includeJsBuiltins ?? false;

    function makeMatcher(patterns: string[]): ((s: string) => boolean) | null {
      if (!patterns.length) return null;
      const compiled = patterns.map((p) => {
        if (p.startsWith("/") && p.endsWith("/") && p.length >= 2) {
          const expr = p.slice(1, -1);
          return new RegExp(expr);
        }
        return p;
      });
      return (s: string) => compiled.some((m) => (m instanceof RegExp ? m.test(s) : m === s));
    }

    const matchIgnoreFeature = makeMatcher(ignoreFeaturePatterns);
    const matchIgnoreNodeType = makeMatcher(ignoreNodeTypePatterns);

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

      // Create a minimal context wrapper that forwards necessary APIs and overrides report/options.
      const delegateCtx: Record<string, unknown> = {};
      // Forward commonly used context methods/properties safely
      const fwd = [
        "getSourceCode",
        "getCwd",
        "getFilename",
        "getPhysicalFilename",
        "getAncestors",
        "getDeclaredVariables",
        "markVariableAsUsed",
        "getScope",
      ] as const;
      for (const k of fwd) {
        const v = (ctx as unknown as Record<string, unknown>)[k as string];
        if (typeof v === "function") {
          type AnyFn = (...args: unknown[]) => unknown;
          const fn = v as unknown as AnyFn;
          delegateCtx[k] = fn.bind(ctx);
        }
      }
      // Pass-through common data containers if present
      for (const k of [
        "settings",
        "parserPath",
        "parserServices",
        "languageOptions",
        "sourceCode",
      ]) {
        const src = ctx as unknown as Record<string, unknown>;
        if (src[k] != null) delegateCtx[k] = src[k];
      }
      // Force es-x delegates to consider syntax as "unsupported" by lowering ecmaVersion.
      {
        const src = ctx as unknown as { parserOptions?: Record<string, unknown> };
        const orig = src.parserOptions ?? {};
        (delegateCtx as Record<string, unknown>).parserOptions = { ...orig, ecmaVersion: 3 };
      }
      // Provide options expected by the delegate rule
      delegateCtx.options = delegateOptions;
      // Unified Baseline-aware reporting
      delegateCtx.report = function report(arg: unknown) {
        const isObj = typeof arg === "object" && arg !== null;
        const node =
          isObj && "node" in (arg as Record<string, unknown>)
            ? (arg as Record<string, unknown>).node
            : arg;
        if (matchIgnoreNodeType) {
          const t = (node as Record<string, unknown> | null | undefined)?.type as
            | string
            | undefined;
          if (t && matchIgnoreNodeType(t)) return;
        }
        (ctx as unknown as { report: (d: { node: unknown; message: string }) => void }).report({
          node,
          message: baselineMessage(featureId, baseline),
        });
      };

      const l = impl.create(delegateCtx as unknown as Rule.RuleContext);
      mergeRuleListeners(listeners, l);
    }
    // Attach generic feature-usage detector (Web API / JS builtins) if enabled and we have descriptors.
    let descriptors = getIncludedDescriptors({
      webApis: includeWebApis,
      jsBuiltins: includeJsBuiltins,
    });
    // Filter to features that actually exceed the configured Baseline
    descriptors = descriptors
      .filter((d) => isBeyondBaseline(d.featureId, baseline))
      // Avoid double-reporting when a feature is covered by mapping delegates
      .filter((d) => !mappedFeatureIds.has(d.featureId));

    // Resolve typed mode
    function resolveUseTypes(opt: unknown): "off" | "auto" | "require" {
      if (!opt) return "off";
      if (opt === true) return "off"; // boolean true defaults to safe
      if (typeof opt === "object") {
        const o = opt as Record<string, unknown>;
        if (o.useTypes === "off" || o.useTypes === "auto" || o.useTypes === "require")
          return o.useTypes as "off" | "auto" | "require";
        if (o.preset === "type-aware") return "require";
        if (o.preset === "auto") return "auto";
        return "off"; // safe or undefined
      }
      return "off";
    }
    type ParserServicesLike = { program?: unknown; esTreeNodeToTSNodeMap?: unknown };
    type CtxLike = {
      parserServices?: ParserServicesLike;
      sourceCode?: { parserServices?: ParserServicesLike };
    };
    const cx = ctx as unknown as CtxLike;
    const ps = cx.parserServices || cx.sourceCode?.parserServices;
    const typedAvailable = !!ps?.program && !!ps?.esTreeNodeToTSNodeMap;
    const useTypesWeb = resolveUseTypes(includeWebApis);
    const useTypesJs = resolveUseTypes(includeJsBuiltins);
    const wantTyped =
      useTypesWeb === "require" ||
      useTypesJs === "require" ||
      useTypesWeb === "auto" ||
      useTypesJs === "auto";
    const typedEnabled = wantTyped && typedAvailable;

    if (!typedEnabled) {
      // Drop instanceMember descriptors and typedOnly descriptors if we cannot/should not run typed checks
      descriptors = descriptors.filter(
        (d) => d.kind !== "instanceMember" && !(d as { typedOnly?: boolean }).typedOnly,
      );
    }
    if (descriptors.length > 0) {
      const messages: Record<string, string> = {};
      for (const d of descriptors) messages[d.featureId] = baselineMessage(d.featureId, baseline);
      // Build a delegate context similar to other delegates
      const delegateCtx: Record<string, unknown> = {};
      const fwd = [
        "getSourceCode",
        "getCwd",
        "getFilename",
        "getPhysicalFilename",
        "getAncestors",
        "getDeclaredVariables",
        "markVariableAsUsed",
        "getScope",
      ] as const;
      for (const k of fwd) {
        const v = (ctx as unknown as Record<string, unknown>)[k as string];
        if (typeof v === "function") {
          type AnyFn = (...args: unknown[]) => unknown;
          const fn = v as unknown as AnyFn;
          delegateCtx[k] = fn.bind(ctx);
        }
      }
      for (const k of [
        "settings",
        "parserPath",
        "parserOptions",
        "parserServices",
        "languageOptions",
        "sourceCode",
      ]) {
        const src = ctx as unknown as Record<string, unknown>;
        if (src[k] != null) delegateCtx[k] = src[k];
      }
      delegateCtx.options = [
        typedEnabled ? { descriptors, messages, typed: true } : { descriptors, messages },
      ];
      // Ensure report is available to the generic detector (feature-usage)
      // so it can forward to the primary rule context and respect ignoreNodeTypes.
      (delegateCtx as unknown as { report: (arg: unknown) => void }).report = function report(
        arg: unknown,
      ) {
        const isObj = typeof arg === "object" && arg !== null;
        const node =
          isObj && "node" in (arg as Record<string, unknown>)
            ? (arg as Record<string, unknown>).node
            : arg;
        if (matchIgnoreNodeType) {
          const t = (node as Record<string, unknown> | null | undefined)?.type as
            | string
            | undefined;
          if (t && matchIgnoreNodeType(t)) return;
        }
        let msg: string | undefined;
        if (isObj && typeof (arg as { message?: unknown }).message === "string")
          msg = (arg as { message?: string }).message;

        (ctx as unknown as { report: (d: { node: unknown; message?: string }) => void }).report({
          node,
          message: msg,
        });
      };
      const generic = featureUsage.create(delegateCtx as unknown as Rule.RuleContext);
      mergeRuleListeners(listeners, generic);
    }

    return listeners;
  },
};

export default rule;
