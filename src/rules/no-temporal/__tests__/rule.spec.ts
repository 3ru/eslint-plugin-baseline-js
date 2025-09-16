import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";
import plugin from "../../../index";

async function run(code: string) {
  const eslint = new ESLint({
    overrideConfigFile: true,
    overrideConfig: {
      languageOptions: { ecmaVersion: 2022, sourceType: "module" },
      plugins: { "baseline-js": plugin as unknown as ESLint.Plugin },
      rules: { "baseline-js/no-temporal": "error" },
    },
  });
  const [res] = await eslint.lintText(code, { filePath: "test.js" });
  return res.messages;
}

// Spec reference (web-features):
// - web-features/features/temporal.yml
// - spec: https://tc39.es/proposal-temporal/

describe("no-temporal", () => {
  it("flags Temporal.Now.instant()", async () => {
    const msgs = await run("Temporal.Now.instant()");
    expect(msgs.length).toBeGreaterThan(0);
  });

  it("does not duplicate on Temporal.Now.instant()", async () => {
    const msgs = await run("Temporal.Now.instant()");
    expect(msgs.length).toBe(1);
  });

  it("flags new Temporal.PlainDate()", async () => {
    const msgs = await run("new Temporal.PlainDate(2020,1,1)");
    expect(msgs.length).toBeGreaterThan(0);
  });

  it("does not duplicate on new Temporal.PlainDate()", async () => {
    const msgs = await run("new Temporal.PlainDate(2020,1,1)");
    expect(msgs.length).toBe(1);
  });

  it("does not flag unrelated identifiers", async () => {
    const msgs = await run("const T = {}; T.now = () => {}; T.now();");
    expect(msgs.length).toBe(0);
  });
});
