import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";
import plugin from "../../../index";

async function run(code: string) {
  const eslint = new ESLint({
    overrideConfigFile: true,
    overrideConfig: {
      languageOptions: { ecmaVersion: 2022, sourceType: "module" },
      plugins: { "baseline-js": plugin as unknown as ESLint.Plugin },
      rules: { "baseline-js/no-bigint64array": "error" },
    },
  });
  const [res] = await eslint.lintText(code, { filePath: "test.js" });
  return res.messages;
}

// Spec reference (web-features):
// - web-features/features/bigint64array.yml
// - spec: https://tc39.es/ecma262/multipage/indexed-collections.html#sec-typedarray-objects

describe("no-bigint64array", () => {
  it("flags BigInt64Array constructor usage", async () => {
    const msgs = await run("new BigInt64Array(8)");
    expect(msgs.length).toBeGreaterThan(0);
  });

  it("does not duplicate on BigInt64Array constructor", async () => {
    const msgs = await run("new BigInt64Array(8)");
    expect(msgs.length).toBe(1);
  });

  it("flags BigUint64Array constructor usage", async () => {
    const msgs = await run("new BigUint64Array(8)");
    expect(msgs.length).toBeGreaterThan(0);
  });

  it("does not duplicate on BigUint64Array constructor", async () => {
    const msgs = await run("new BigUint64Array(8)");
    expect(msgs.length).toBe(1);
  });

  it("flags static member access on BigInt64Array", async () => {
    const msgs = await run("const n = BigInt64Array.BYTES_PER_ELEMENT");
    expect(msgs.length).toBeGreaterThan(0);
  });

  it("does not duplicate on BigInt64Array member access", async () => {
    const msgs = await run("const n = BigInt64Array.BYTES_PER_ELEMENT");
    expect(msgs.length).toBe(1);
  });

  it("does not flag unrelated typed arrays", async () => {
    const msgs = await run("new Int32Array(8)");
    expect(msgs.length).toBe(0);
  });
});
