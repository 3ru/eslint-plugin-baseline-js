import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";
import plugin from "../dist/index.mjs";
import type { CommonRuleOptions } from "../src/config";

async function lint(
  code: string,
  options: CommonRuleOptions = {},
  sourceType: "module" | "script" = "module",
) {
  const eslint = new ESLint({
    overrideConfigFile: true,
    overrideConfig: {
      languageOptions: { ecmaVersion: "latest", sourceType },
      plugins: { "baseline-js": plugin },
      rules: { "baseline-js/use-baseline": ["error", { available: "widely", ...options }] },
    },
  });
  const [result] = await eslint.lintText(code, { filePath: "function-receiver.js" });
  expect(result.fatalErrorCount).toBe(0);
  return result.messages;
}

describe("Function receiver precision through use-baseline", () => {
  it.each([
    ["declarations", "function f() {}\nf.caller;", 2, 3, 9],
    ["function initializers", "const f = function () {};\nf.arguments;", 2, 3, 12],
    ["arrow initializers", "const f = () => {};\nf.caller;", 2, 3, 9],
    ["unwritten let bindings", "let f = () => {};\nf.arguments;", 2, 3, 12],
    ["unwritten var bindings", "var f = function () {};\nf.caller;", 2, 3, 9],
    ["direct function expressions", "(function () {}).caller;", 1, 18, 24],
    ["direct arrow expressions", "(() => {}).arguments;", 1, 12, 21],
    ["optional function access", "const f = () => {};\nf?.caller;", 2, 4, 10],
    ["named function expressions", "(function f() { f.caller; });", 1, 19, 25],
    ["Function.prototype", "Function.prototype.caller;", 1, 20, 26],
    ["qualified Function.prototype", "globalThis.Function.prototype.arguments;", 1, 31, 40],
    ["window.Function.prototype", "window.Function.prototype.caller;", 1, 27, 33],
    ["self.Function.prototype", "self.Function.prototype.arguments;", 1, 25, 34],
    [
      "qualified global with a local Function",
      "const Function = {};\nglobalThis.Function.prototype.caller;",
      2,
      31,
      37,
    ],
  ])("preserves %s and its property range", async (_name, code, line, column, endColumn) => {
    const messages = await lint(code);
    expect(messages).toHaveLength(1);
    expect(messages).toMatchObject([
      {
        ruleId: "baseline-js/use-baseline",
        message:
          "'Function caller and arguments' does not meet your Baseline Widely available target. It has Limited availability. Feature ID: functions-caller-arguments.",
        severity: 2,
        line,
        column,
        endLine: line,
        endColumn,
      },
    ]);
  });

  it.each([
    ["ordinary properties", "const o = { caller: 'alice', arguments: [] }; o.caller; o.arguments;"],
    ["a callable-looking object", "const f = { call() {}, caller: 1 }; f.caller;"],
    ["unknown receivers", "f.caller; f.arguments;"],
    ["parameters", "function read(f) { return f.arguments; }"],
    ["imports", "import f from 'custom'; f.caller;"],
    ["function aliases", "const f = () => {}; const alias = f; alias.arguments;"],
    ["prototype aliases", "const p = Function.prototype; p.caller;"],
    ["reassigned initializers", "let f = () => {}; f = { caller: 1 }; f.caller;"],
    ["later writes", "let f = () => {}; f.caller; f = { caller: 1 };"],
    ["reassigned declarations", "function f() {} f = { arguments: [] }; f.arguments;"],
    ["nested writes", "let f = () => {}; function replace() { f = {}; } f.caller;"],
    ["destructuring writes", "let f = () => {}; ({ f } = object); f.arguments;"],
    ["updates", "let f = () => {}; f++; f.caller;"],
    ["multiple definitions", "var f = function () {}; var f; f.caller;"],
    ["destructured initializers", "const { prototype: f } = function () {}; f.caller;"],
    ["shadowed locals", "function f() {} function read(f) { return f.caller; }"],
    [
      "shadowed Function",
      "const Function = { prototype: { caller: 1 } }; Function.prototype.caller;",
    ],
    ["shadowed Function parameters", "function read(Function) { Function.prototype.arguments; }"],
    [
      "shadowed global objects",
      "function read(globalThis) { globalThis.Function.prototype.caller; }",
    ],
    ["computed properties", "function f() {} f['caller']; f['arguments'];"],
    ["dynamic properties", "function f() {} f[key];"],
  ])("abstains for %s", async (_name, code) => {
    await expect(lint(code)).resolves.toEqual([]);
  });

  it("keeps both property reports when the receiver is proven", async () => {
    const messages = await lint("function f() {}\nf.caller; f.arguments;");
    expect(messages).toHaveLength(2);
    expect(messages).toMatchObject([
      { line: 2, column: 3, endLine: 2, endColumn: 9 },
      { line: 2, column: 13, endLine: 2, endColumn: 22 },
    ]);
  });

  it.each([
    { ignoreFeatures: ["functions-caller-arguments"] },
    { ignoreNodeTypes: ["Identifier"] },
  ])("preserves the delegate ignore option %j", async (options) => {
    await expect(lint("function f() {} f.caller; f.arguments;", options)).resolves.toEqual([]);
  });

  it.each([
    "function f() {} with ({ f: { caller: 1, arguments: [] } }) { f.caller; f.arguments; }",
    "with ({ Function: { prototype: { caller: 1, arguments: [] } } }) { Function.prototype.caller; Function.prototype.arguments; }",
    "with ({ globalThis: { Function: { prototype: { caller: 1 } } } }) { globalThis.Function.prototype.caller; }",
  ])("does not attribute a with-provided receiver to Function", async (code) => {
    const messages = await lint(code, {}, "script");
    expect(
      messages.filter((message) =>
        message.message.endsWith("Feature ID: functions-caller-arguments."),
      ),
    ).toEqual([]);
  });

  it("keeps proven local and direct functions inside a with scope", async () => {
    const messages = await lint(
      "with ({ f: { caller: 1 } }) {\n  const f = () => {};\n  f.caller;\n  (() => {}).arguments;\n}",
      {},
      "script",
    );
    const functions = messages.filter((message) =>
      message.message.endsWith("Feature ID: functions-caller-arguments."),
    );
    expect(functions).toHaveLength(2);
    expect(functions).toMatchObject([
      {
        ruleId: "baseline-js/use-baseline",
        severity: 2,
        line: 3,
        column: 5,
        endLine: 3,
        endColumn: 11,
      },
      {
        ruleId: "baseline-js/use-baseline",
        severity: 2,
        line: 4,
        column: 14,
        endLine: 4,
        endColumn: 23,
      },
    ]);
  });
});
