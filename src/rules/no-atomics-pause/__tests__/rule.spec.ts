import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";
import plugin from "../../../index";

async function run(code: string) {
  const eslint = new ESLint({
    overrideConfigFile: true,
    overrideConfig: {
      languageOptions: { ecmaVersion: 2022, sourceType: "module" },
      plugins: { "baseline-js": plugin as unknown as ESLint.Plugin },
      rules: { "baseline-js/no-atomics-pause": "error" },
    },
  });
  const [res] = await eslint.lintText(code, { filePath: "test.js" });
  return res.messages;
}

// Spec reference (web-features):
// - web-features/features/atomics-pause.yml
// - spec: https://tc39.es/proposal-atomics-microwait/

describe("no-atomics-pause", () => {
  it("flags Atomics.pause() calls (no duplicates)", async () => {
    const msgs = await run("Atomics.pause()");
    expect(msgs.length).toBe(1);
  });

  it("flags member access to pause", async () => {
    const msgs = await run("Atomics.pause");
    expect(msgs.length).toBeGreaterThan(0);
  });

  it("does not flag other Atomics members", async () => {
    const msgs = await run("Atomics.wait(sab, 0, 0)");
    expect(msgs.length).toBe(0);
  });

  // Edge case tests for global scope validation
  it("does not flag shadowed Atomics variable", async () => {
    const code = `
      const Atomics = { pause: () => {} };
      Atomics.pause();
    `;
    const msgs = await run(code);
    expect(msgs.length).toBe(0);
  });

  it("does not flag shadowed Atomics in function scope", async () => {
    const code = `
      function test(Atomics) {
        Atomics.pause();
      }
    `;
    const msgs = await run(code);
    expect(msgs.length).toBe(0);
  });

  it("does not flag shadowed Atomics member access", async () => {
    const code = `
      let Atomics = {};
      Atomics.pause;
    `;
    const msgs = await run(code);
    expect(msgs.length).toBe(0);
  });

  it("flags global Atomics.pause in nested scope", async () => {
    const code = `
      function test() {
        Atomics.pause();
      }
    `;
    const msgs = await run(code);
    expect(msgs.length).toBe(1);
  });

  it("flags globalThis/window qualified Atomics.pause", async () => {
    const a = await run("globalThis.Atomics.pause()");
    expect(a.length).toBe(1);

    const b = await run("window.Atomics.pause");
    expect(b.length).toBeGreaterThan(0);
  });

  it("does not flag shadowed window/globalThis wrappers", async () => {
    const a = await run(`
      const window = { Atomics: { pause() {} } };
      window.Atomics.pause();
    `);
    expect(a.length).toBe(0);

    const b = await run(`
      const globalThis = { Atomics: { pause() {} } };
      globalThis.Atomics.pause;
    `);
    expect(b.length).toBe(0);
  });
});
