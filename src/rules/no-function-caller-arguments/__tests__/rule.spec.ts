import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";
import plugin from "../../../index";

async function run(code: string, sourceType: "module" | "script" = "module") {
  const eslint = new ESLint({
    overrideConfigFile: true,
    overrideConfig: {
      languageOptions: { ecmaVersion: 2022, sourceType },
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

  it.each([
    "function f() {} with ({ f: { caller: 1, arguments: [] } }) { f.caller; f.arguments; }",
    "with ({ Function: { prototype: { caller: 1, arguments: [] } } }) { Function.prototype.caller; Function.prototype.arguments; }",
    "with ({ globalThis: { Function: { prototype: { caller: 1 } } } }) { globalThis.Function.prototype.caller; }",
  ])("does not infer functions across a with scope", async (code) => {
    await expect(run(code, "script")).resolves.toEqual([]);
  });

  it.each([
    ["declarations", "function f() {}\nwith ({ value: f.caller }) {}", 2, 18, 24],
    ["Function.prototype", "with ({ value: Function.prototype.caller }) {}", 1, 35, 41],
    [
      "qualified Function.prototype",
      "with ({ value: globalThis.Function.prototype.arguments }) {}",
      1,
      46,
      55,
    ],
    ["closures", "function f() {}\nwith ({ value: () => f.arguments }) {}", 2, 24, 33],
    [
      "local bindings before an inner with",
      "with ({ f: { caller: 1 } }) {\n  const f = () => {};\n  with ({ value: f.caller }) {}\n}",
      3,
      20,
      26,
    ],
  ])("preserves %s in a with object expression", async (_name, code, line, column, endColumn) => {
    const messages = await run(code, "script");
    expect(messages).toHaveLength(1);
    expect(messages).toMatchObject([
      {
        ruleId: "baseline-js/no-function-caller-arguments",
        messageId: "forbidden",
        message: "Function.caller/Function.arguments are forbidden.",
        severity: 2,
        line,
        column,
        endLine: line,
        endColumn,
      },
    ]);
  });

  it.each([
    "function f() {} with ({ f: { caller: 1 } }) { (() => f.caller)(); }",
    "function f() {} with ({ f: { caller: 1 } }) { with ({ value: f.caller }) {} }",
    "with ({ Function: { prototype: { caller: 1 } } }) { with ({ value: Function.prototype.caller }) {} }",
    "with ({ globalThis: { Function: { prototype: { arguments: [] } } } }) { with ({ value: () => globalThis.Function.prototype.arguments }) {} }",
  ])("does not infer functions across an active outer with scope", async (code) => {
    await expect(run(code, "script")).resolves.toEqual([]);
  });

  it("preserves local and direct functions inside a with scope", async () => {
    const messages = await run(
      "with ({ f: { caller: 1 } }) {\n  const f = () => {};\n  f.caller;\n  (() => {}).arguments;\n}",
      "script",
    );
    expect(messages).toHaveLength(2);
    expect(messages).toMatchObject([
      {
        ruleId: "baseline-js/no-function-caller-arguments",
        messageId: "forbidden",
        severity: 2,
        line: 3,
        column: 5,
        endLine: 3,
        endColumn: 11,
      },
      {
        ruleId: "baseline-js/no-function-caller-arguments",
        messageId: "forbidden",
        severity: 2,
        line: 4,
        column: 14,
        endLine: 4,
        endColumn: 23,
      },
    ]);
  });
});
