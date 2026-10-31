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
    const msgs = await run("function f() {}\nf.caller;\nf.arguments;");
    expect(msgs).toHaveLength(2);
    expect(msgs).toMatchObject([
      {
        ruleId: "baseline-js/no-function-caller-arguments",
        messageId: "forbidden",
        message: "Function.caller/Function.arguments are forbidden.",
        severity: 2,
        line: 2,
        column: 3,
        endLine: 2,
        endColumn: 9,
      },
      {
        ruleId: "baseline-js/no-function-caller-arguments",
        messageId: "forbidden",
        message: "Function.caller/Function.arguments are forbidden.",
        severity: 2,
        line: 3,
        column: 3,
        endLine: 3,
        endColumn: 12,
      },
    ]);
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

  it.each([
    ["ordinary objects", "const o = { caller: 'alice', arguments: [] }; o.caller; o.arguments;"],
    ["unknown identifiers", "unknown.caller; unknown.arguments;"],
    ["parameters", "function read(value) { return value.caller; }"],
    ["imports", "import f from 'custom'; f.arguments;"],
    ["aliases", "function f() {} const alias = f; alias.caller;"],
    ["reassigned variables", "let f = function () {}; f = { caller: 1 }; f.caller;"],
    ["reassigned declarations", "function f() {} f.caller; f = { arguments: [] }; f.arguments;"],
    ["shadowed functions", "function f() {} { const f = { caller: 1 }; f.caller; }"],
    ["shadowed Function", "function read(Function) { return Function.prototype.caller; }"],
    [
      "shadowed globalThis",
      "const globalThis = { Function: { prototype: { arguments: [] } } }; globalThis.Function.prototype.arguments;",
    ],
    [
      "destructured initializers",
      "const { prototype: f } = function () {}; f.caller; f.arguments;",
    ],
    ["computed properties", "function f() {} f['caller']; f['arguments'];"],
  ])("does not flag %s", async (_name, code) => {
    await expect(run(code)).resolves.toEqual([]);
  });
});
