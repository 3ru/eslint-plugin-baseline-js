import { ESLint, type Rule } from "eslint";
import { describe, expect, it } from "vitest";
import type { CommonRuleOptions } from "../src/config";
import rule from "../src/orchestrator/use-baseline";
import { compatYearPolicyMessage, reportingPolicyForCompat } from "./utils/policy";

function createLinter(options: CommonRuleOptions) {
  let normalizedOptions = options;
  let fileIndex = 0;
  const retainingRule: Rule.RuleModule = {
    ...rule,
    create(context) {
      normalizedOptions = context.options[0];
      return rule.create(context);
    },
  };
  const eslint = new ESLint({
    overrideConfigFile: true,
    overrideConfig: {
      languageOptions: { ecmaVersion: 2022, sourceType: "script" },
      plugins: { "baseline-js": { rules: { "use-baseline": retainingRule } } },
      rules: { "baseline-js/use-baseline": ["error", options] },
    },
  });
  return {
    get options() {
      return normalizedOptions;
    },
    async lint(code: string) {
      const results = await eslint.lintText(code, { filePath: `file-${fileIndex++}.js` });
      return results.flatMap((result) => result.messages.map((message) => message.message));
    },
  };
}

describe("descriptor selection across files", () => {
  const urlCode = "URL.parse('https://example.com');";
  const urlPolicy = reportingPolicyForCompat("url", "api.URL.parse_static");
  const urlMessage = compatYearPolicyMessage(
    "url",
    "api.URL.parse_static",
    urlPolicy,
    "'parse' on URL",
  );

  it("uses the current available option and legacy baseline alias", async () => {
    const linter = createLinter({
      available: urlPolicy + 1,
      baseline: urlPolicy,
      includeWebApis: true,
    });
    await expect(linter.lint(urlCode)).resolves.toEqual([]);
    delete linter.options.available;
    await expect(linter.lint(urlCode)).resolves.toEqual([urlMessage]);
    linter.options.baseline = urlPolicy + 1;
    await expect(linter.lint(urlCode)).resolves.toEqual([]);
    linter.options.available = urlPolicy;
    await expect(linter.lint(urlCode)).resolves.toEqual([urlMessage]);
  });

  it("uses changes to a nested Web API inclusion list", async () => {
    const linter = createLinter({
      available: urlPolicy,
      includeWebApis: { preset: "safe", only: ["url"] },
    });
    await expect(linter.lint(urlCode)).resolves.toEqual([urlMessage]);
    const inclusion = linter.options.includeWebApis;
    expect(typeof inclusion).toBe("object");
    if (typeof inclusion !== "object") throw new Error("Missing Web API inclusion options");
    inclusion.only?.splice(0, 1, "abortsignal-any");
    await expect(linter.lint(urlCode)).resolves.toEqual([]);
  });

  it("uses changes to a nested JavaScript builtin ignore list", async () => {
    const policy = reportingPolicyForCompat("array-group", "javascript.builtins.Object.groupBy");
    const code = "Object.groupBy([], item => item);";
    const linter = createLinter({
      available: policy,
      includeJsBuiltins: { preset: "safe", ignore: [] },
    });
    await expect(linter.lint(code)).resolves.toEqual([
      compatYearPolicyMessage(
        "array-group",
        "javascript.builtins.Object.groupBy",
        policy,
        "'groupBy' on Object",
      ),
    ]);
    const inclusion = linter.options.includeJsBuiltins;
    expect(typeof inclusion).toBe("object");
    if (typeof inclusion !== "object")
      throw new Error("Missing JavaScript builtin inclusion options");
    inclusion.ignore?.push("array-group");
    await expect(linter.lint(code)).resolves.toEqual([]);
  });

  it("uses changed feature ignores and rejects a later invalid pattern", async () => {
    const linter = createLinter({
      available: urlPolicy,
      includeWebApis: true,
      ignoreFeatures: [],
    });
    await expect(linter.lint(urlCode)).resolves.toEqual([urlMessage]);
    linter.options.ignoreFeatures?.push("/^url$/");
    await expect(linter.lint(urlCode)).resolves.toEqual([]);
    linter.options.ignoreFeatures?.splice(0, 1, "/[/");
    await expect(linter.lint(urlCode)).rejects.toMatchObject({
      name: "SyntaxError",
      message: expect.stringContaining('Invalid ignoreFeatures pattern "/[/".'),
    });
  });
});
