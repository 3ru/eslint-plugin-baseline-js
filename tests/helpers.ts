import { ESLint } from "eslint";
import plugin from "../src";

export {
  baselineYearOf,
  LIMITED_ONLY_YEAR,
  reportingPolicyFor,
  yearPolicyMessage,
} from "./utils/policy";

export async function lintWithBaseline(
  code: string,
  available: "widely" | "newly" | number,
  opts: { filePath?: string; sourceType?: "script" | "module" } = {},
  ruleOptions: Record<string, unknown> = {},
) {
  const eslint = new ESLint({
    overrideConfigFile: true,
    overrideConfig: {
      languageOptions: {
        ecmaVersion: 2022,
        sourceType: opts.sourceType ?? "script",
      },
      plugins: { "baseline-js": plugin as unknown as ESLint.Plugin },
      rules: { "baseline-js/use-baseline": ["error", { available, ...ruleOptions }] },
    },
  });
  const results = await eslint.lintText(code, { filePath: opts.filePath ?? "test.js" });
  return results[0].messages.map((m) => m.message);
}
