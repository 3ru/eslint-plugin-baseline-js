import type { Rule } from "eslint";
import { recommendedConfig, recommendedTsConfig } from "./configs/baseline";

export { BASELINE } from "./config";

import useBaseline from "./orchestrator/use-baseline";
import noAtomicsPause from "./rules/no-atomics-pause";
import noBigint64array from "./rules/no-bigint64array";
import noFunctionCallerArguments from "./rules/no-function-caller-arguments";
import noMathSumPrecise from "./rules/no-math-sum-precise";
import noTemporal from "./rules/no-temporal";

const rules: Record<string, Rule.RuleModule> = {
  "use-baseline": useBaseline,
  "no-atomics-pause": noAtomicsPause,
  "no-bigint64array": noBigint64array,
  "no-function-caller-arguments": noFunctionCallerArguments,
  "no-math-sum-precise": noMathSumPrecise,
  "no-temporal": noTemporal,
};

export default {
  rules,
  configs: {
    recommended: recommendedConfig,
    "recommended-ts": recommendedTsConfig,
  },
} as const;
