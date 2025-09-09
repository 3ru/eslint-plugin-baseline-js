import type { Rule } from "eslint";
import { builtinRules } from "eslint/use-at-your-own-risk"; // Access ESLint builtin rules to delegate core rules
import esx from "eslint-plugin-es-x";
import mapping from "../baseline/mapping.mjs";
import { parseDelegateRuleKey } from "../baseline/plugins";
import { getFeatureRecord, isBeyondBaseline } from "../baseline/resolve";
import { type CommonRuleOptions, getBaselineValue } from "../config";
import noBigint64array from "../rules/no-bigint64array";
import noFunctionCallerArguments from "../rules/no-function-caller-arguments";
import noMathSumPrecise from "../rules/no-math-sum-precise";
import noTemporal from "../rules/no-temporal";

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
  if (baseline === "widely") {
    return `Feature '${featureId}' is not a widely available Baseline feature.`;
  }
  if (baseline === "newly") {
    return `Feature '${featureId}' is not a newly available Baseline feature.`;
  }
  const rec = getFeatureRecord(featureId);
  const year =
    rec?.status?.baseline_low_date?.slice(0, 4) ||
    rec?.status?.baseline_high_date?.slice(0, 4) ||
    "unknown";
  return `Feature '${featureId}' became Baseline in ${year} and exceeds ${baseline}.`;
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
        },
        additionalProperties: false,
      },
    ],
  },
  create(ctx) {
    const opt = (ctx.options[0] ?? {}) as CommonRuleOptions;
    const baseline = getBaselineValue(opt);
    const ignoreFeaturePatterns = (opt.ignoreFeatures ?? []) as string[];
    const ignoreNodeTypePatterns = (opt.ignoreNodeTypes ?? []) as string[];

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
        delegates: Array<{ plugin: string; rule: string; options?: unknown }>;
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

    for (const { featureId, delegateRule } of entries) {
      let impl: Rule.RuleModule | undefined;
      let delegateOptions: unknown[] = [];

      // Find mapping entry to pull options (if any)
      const mappingEntry = map[featureId] as
        | { delegates: Array<{ plugin: string; options?: unknown }> }
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
        const esxRules = (esx as unknown as { rules?: Record<string, Rule.RuleModule> }).rules;
        impl = esxRules?.[name];
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

    return listeners;
  },
};

export default rule;
