import type { Rule } from "eslint";
import { builtinRules } from "eslint/use-at-your-own-risk"; // Access ESLint builtin rules to delegate core rules
import esx from "eslint-plugin-es-x";
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
import { getEsxRule, resolveEsxRulesFrom } from "../utils/rule-resolver";

type ListenerMap = Rule.RuleListener;

function mergeListeners(target: ListenerMap, add: ListenerMap) {
  type AnyFn = (...args: unknown[]) => void;
  const tgt = target as unknown as Record<string, unknown>;
  for (const [event, handler] of Object.entries(add)) {
    const name = event as keyof ListenerMap;
    const prev = target[name] as unknown as AnyFn | undefined;
    if (!prev) {
      tgt[event] = handler as unknown;
    } else {
      const next = handler as unknown as AnyFn;
      tgt[event] = function merged(this: unknown, ...args: unknown[]) {
        prev.apply(this as unknown as object, args);
        next.apply(this as unknown as object, args);
      } as unknown;
    }
  }
}

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
    // Guard: run only for JS/TS files. This prevents initialization on non-JS
    // languages (e.g., CSS/HTML) where delegate rules may assume ESTree/TS services.
    const getFilename = (ctx as unknown as { getFilename?: () => string }).getFilename;
    let filename: string | null = null;
    if (typeof getFilename === "function") {
      try {
        filename = getFilename();
      } catch {}
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
          try {
            return new RegExp(p.slice(1, -1));
          } catch {
            return p;
          }
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

    for (const { featureId, delegateRule } of entries) {
      let impl: Rule.RuleModule | undefined;
      let delegateOptions: unknown[] = [];

      // Find mapping entry to pull options (if any)
      const mappingEntry = map[featureId] as
        | { delegates: ReadonlyArray<{ plugin: string; options?: unknown }> }
        | undefined;
      if (mappingEntry) {
        const { plugin } = parseDelegateRuleKey(delegateRule);
        const d = mappingEntry.delegates.find((x) => x.plugin === plugin);
        if (d?.options) {
          // context.options is the array as provided after level
          delegateOptions = Array.isArray(d.options) ? d.options : [d.options];
        }
      }

      const { plugin, name } = parseDelegateRuleKey(delegateRule);
      if (plugin === "core") {
        const coreName = name;
        const coreImpl = (builtinRules as unknown as Map<string, Rule.RuleModule>).get(coreName);
        impl = coreImpl as Rule.RuleModule;
      } else if (plugin === "self") {
        const selfName = name;
        const selfRules: Record<string, Rule.RuleModule> = {
          "no-bigint64array": noBigint64array,
          "no-function-caller-arguments": noFunctionCallerArguments,
          "no-math-sum-precise": noMathSumPrecise,
          "no-temporal": noTemporal,
        };
        impl = selfRules[selfName];
      } else {
        // Prefer ESM-imported module first; fall back to CJS require-based lookup
        const rules = resolveEsxRulesFrom(esx);
        impl = rules?.[name] ?? getEsxRule(name);
      }
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
        "parserOptions",
        "parserServices",
        "languageOptions",
        "sourceCode",
      ]) {
        const src = ctx as unknown as Record<string, unknown>;
        if (src[k] != null) delegateCtx[k] = src[k];
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
      mergeListeners(listeners, l);
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
      // Drop instanceMember descriptors if we cannot/should not run typed checks
      descriptors = descriptors.filter((d) => d.kind !== "instanceMember");
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
        const msg = (isObj && (arg as any).message) || undefined;

        (ctx as unknown as { report: (d: { node: unknown; message?: string }) => void }).report({
          node,
          message: msg,
        });
      };
      const generic = featureUsage.create(delegateCtx as unknown as Rule.RuleContext);
      mergeListeners(listeners, generic);
    }

    return listeners;
  },
};

export default rule;
