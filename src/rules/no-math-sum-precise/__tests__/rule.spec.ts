import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";
import plugin from "../../../index";

async function run(code: string) {
  const eslint = new ESLint({
    overrideConfigFile: true,
    overrideConfig: {
      languageOptions: { ecmaVersion: 2022, sourceType: "module" },
      plugins: { "baseline-js": plugin as unknown as ESLint.Plugin },
      rules: { "baseline-js/no-math-sum-precise": "error" },
    },
  });
  const [res] = await eslint.lintText(code, { filePath: "test.js" });
  return res.messages;
}

// Spec reference (web-features):
// - web-features/features/math-sum-precise.yml
// - spec: https://tc39.es/proposal-math-sum/

describe("no-math-sum-precise", () => {
  it("flags Math.sumPrecise() calls (no duplicates)", async () => {
    const msgs = await run("Math.sumPrecise(1,2)");
    expect(msgs.length).toBe(1);
  });

  it("flags member access to sumPrecise", async () => {
    const msgs = await run("Math.sumPrecise");
    expect(msgs.length).toBeGreaterThan(0);
  });

  it("does not flag other Math members", async () => {
    const msgs = await run("Math.max(1,2)");
    expect(msgs.length).toBe(0);
  });
});
