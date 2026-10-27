import { rm } from "node:fs/promises";
import parser from "@typescript-eslint/parser";
import { ESLint, type Rule } from "eslint";
import { expect, it } from "vitest";
import type { CommonRuleOptions } from "../src/config";
import rule from "../src/orchestrator/use-baseline";
import { compatYearPolicyMessage, reportingPolicyForCompat } from "./utils/policy";
import { createTypedFixture } from "./utils/typed-fixture";

it("selects descriptors for each file's type availability with shared options", async () => {
  const code = "const values = new Set([1]); values.union(values);";
  const fixture = await createTypedFixture(code, { target: "ESNext" });
  try {
    const policy = reportingPolicyForCompat("set-methods", "javascript.builtins.Set.union");
    const options: CommonRuleOptions = {
      available: policy,
      includeJsBuiltins: { preset: "type-aware", only: ["set-methods"] },
    };
    let sharedOptions: CommonRuleOptions | undefined;
    const retainingRule: Rule.RuleModule = {
      ...rule,
      create(context) {
        sharedOptions ??= context.options[0];
        return rule.create(Object.create(context, { options: { value: [sharedOptions] } }));
      },
    };
    const eslint = new ESLint({
      cwd: fixture.root,
      overrideConfigFile: true,
      overrideConfig: [
        {
          files: ["**/*.js", "**/*.ts"],
          languageOptions: { ecmaVersion: "latest", sourceType: "module" },
          plugins: { "baseline-js": { rules: { "use-baseline": retainingRule } } },
          rules: { "baseline-js/use-baseline": ["error", options] },
        },
        {
          files: ["**/*.ts"],
          languageOptions: {
            parser,
            parserOptions: {
              project: [fixture.tsconfigPath],
              tsconfigRootDir: fixture.root,
              disallowAutomaticSingleRunInference: true,
            },
          },
        },
      ],
    });

    const untypedBefore = await eslint.lintText(code, { filePath: "before.js" });
    expect(untypedBefore.flatMap((result) => result.messages)).toEqual([]);

    const typed = await eslint.lintFiles([fixture.samplePath]);
    expect(
      typed.flatMap((result) =>
        result.messages.map(({ ruleId, message }) => ({ ruleId, message })),
      ),
    ).toEqual([
      {
        ruleId: "baseline-js/use-baseline",
        message: compatYearPolicyMessage(
          "set-methods",
          "javascript.builtins.Set.union",
          policy,
          "The 'union' member of Set instances",
        ),
      },
    ]);

    const untypedAfter = await eslint.lintText(code, { filePath: "after.js" });
    expect(untypedAfter.flatMap((result) => result.messages)).toEqual([]);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});
