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

  it("uses the current available option across files", async () => {
    const linter = createLinter({
      available: urlPolicy + 1,
      includeWebApis: true,
    });
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
});
