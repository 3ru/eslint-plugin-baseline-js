import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";
import plugin from "../../../index";

async function run(code: string) {
  const eslint = new ESLint({
    overrideConfigFile: true,
    overrideConfig: {
      languageOptions: { ecmaVersion: 2022, sourceType: "module" },
      plugins: { "baseline-js": plugin as unknown as ESLint.Plugin },
      rules: { "baseline-js/no-function-caller-arguments": "error" },
    },
  });
  const [res] = await eslint.lintText(code, { filePath: "test.js" });
  return res.messages;
}

// Spec reference (web-features):
// - web-features/features/functions-caller-arguments.yml
// - spec: https://tc39.es/ecma262/multipage/error-handling-and-language-extensions.html#sec-forbidden-extensions

describe("no-function-caller-arguments", () => {
  it("flags Function.prototype.caller and .arguments", async () => {
    const msgs = await run("Function.prototype.caller; Function.prototype.arguments;");
    expect(msgs.length).toBe(2);
  });

  it("flags f.caller and f.arguments where f is a function", async () => {
    const msgs = await run("function f(){}; f.caller; f.arguments;");
    expect(msgs.length).toBeGreaterThan(0);
  });

  it("does not flag unrelated properties", async () => {
    const msgs = await run("const o={}; o.color; o.args;");
    expect(msgs.length).toBe(0);
  });

  it("does not duplicate on single .caller", async () => {
    const msgs = await run("function f(){}; f.caller;");
    expect(msgs.length).toBe(1);
  });

  it("does not duplicate on single .arguments", async () => {
    const msgs = await run("function f(){}; f.arguments;");
    expect(msgs.length).toBe(1);
  });
});
