import type { Rule } from "eslint";
import type { Descriptor } from "../../baseline/types";
import { buildListeners } from "./builder";

interface Options {
  descriptors: ReadonlyArray<Descriptor>;
  messages: Record<string, string>; // featureId -> message
  typed?: boolean; // enable instanceMember detection via parserServices
}

const rule: Rule.RuleModule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Detect usage of Web APIs and JS builtins beyond configured Baseline (data-driven).",
    },
    schema: [
      {
        type: "object",
        properties: {
          descriptors: { type: "array" },
          messages: { type: "object" },
        },
        additionalProperties: false,
      },
    ],
  },
  create(context) {
    const opt = (context.options?.[0] ?? {}) as Options;
    const useTyped = !!opt.typed;
    return buildListeners(context, {
      descriptors: opt.descriptors,
      messages: opt.messages,
      typed: useTyped,
    });
  },
};

export default rule;
