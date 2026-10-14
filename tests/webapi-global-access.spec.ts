import { describe, expect, it } from "vitest";
import { lintWithBaseline, reportingPolicyFor } from "./helpers";
import { reportingPolicyForCompat } from "./utils/policy";

async function messages(
  code: string,
  featureId: string,
  sourceType: "module" | "script" = "module",
  compatKey?: string,
) {
  return lintWithBaseline(
    code,
    compatKey ? reportingPolicyForCompat(featureId, compatKey) : reportingPolicyFor(featureId),
    { sourceType },
    {
      includeWebApis: { preset: "safe", only: [featureId] },
      includeJsBuiltins: false,
    },
  );
}

describe("Web API global access forms", () => {
  it.each([
    "window.fetchLater('/collect');",
    "globalThis.fetchLater('/collect');",
    "self.fetchLater('/collect');",
    "window['fetchLater']('/collect');",
    "(window?.fetchLater)('/collect');",
  ])("reports overlapping global and Window descriptors once: %s", async (code) => {
    expect(await messages(code, "fetchlater")).toHaveLength(1);
  });

  it("keeps different feature reports at the same constructor", async () => {
    const result = await lintWithBaseline(
      "new window.Worker('worker.js', { type: 'module' });",
      reportingPolicyFor("dedicated-workers", "js-modules-workers"),
      { sourceType: "module" },
      {
        includeWebApis: { preset: "safe", only: ["dedicated-workers", "js-modules-workers"] },
        includeJsBuiltins: false,
      },
    );
    expect(result).toHaveLength(2);
    expect(result.some((message) => message.includes("(dedicated-workers)"))).toBe(true);
    expect(result.some((message) => message.includes("(js-modules-workers)"))).toBe(true);
  });

  it.each([
    "new SharedWorker('worker.js', { type: 'module' });",
    "new self['SharedWorker']('worker.js', { ['type']: 'module' });",
  ])("reports shared worker modules: %s", async (code) => {
    expect(await messages(code, "js-modules-shared-workers")).toHaveLength(1);
  });

  it.each([
    "new TransformStream({ cancel() {} });",
    "new globalThis['TransformStream']({ ['cancel']() {} });",
  ])("reports TransformStream cancellation: %s", async (code) => {
    expect(await messages(code, "transformstream-transformer-cancel")).toHaveLength(1);
  });

  it.each([
    "structuredClone({});",
    "window.structuredClone({});",
    "globalThis.structuredClone({});",
    "(self.globalThis).structuredClone({});",
    "self.structuredClone({});",
    'window["structuredClone"]({});',
    'globalThis["structuredClone"]({});',
    'self?.["structuredClone"]?.({});',
    '(window?.["structuredClone"])({});',
    "const structuredClone = () => {}; window.structuredClone({});",
  ])("reports a global function once: %s", async (code) => {
    const result = await messages(code, "structured-clone");
    expect(result).toHaveLength(1);
    expect(result[0]).toContain("(structured-clone)");
  });

  it.each([
    "new BroadcastChannel('channel');",
    "new window.BroadcastChannel('channel');",
    "new globalThis.BroadcastChannel('channel');",
    "new globalThis.window.BroadcastChannel('channel');",
    "new self.BroadcastChannel('channel');",
    'new window["BroadcastChannel"]("channel");',
    "new (window?.BroadcastChannel)('channel');",
    "const BroadcastChannel = class {}; new window.BroadcastChannel('channel');",
  ])("reports a qualified constructor once: %s", async (code) => {
    expect(await messages(code, "broadcast-channel")).toHaveLength(1);
  });

  it.each([
    "AbortSignal.any([]);",
    "window.AbortSignal.any([]);",
    "globalThis.AbortSignal.any([]);",
    "self.AbortSignal.any([]);",
    'AbortSignal["any"]([]);',
    'window["AbortSignal"]["any"]([]);',
    'globalThis?.["AbortSignal"]?.["any"]?.([]);',
    '(AbortSignal?.["any"])([]);',
    '(window?.["AbortSignal"])["any"]([]);',
    "const AbortSignal = {}; self.AbortSignal.any([]);",
  ])("reports a static API once: %s", async (code) => {
    expect(await messages(code, "abortsignal-any")).toHaveLength(1);
  });

  it.each([
    "window.navigation;",
    "globalThis.navigation;",
    "self.navigation;",
    'window["navigation"];',
    'globalThis?.["navigation"];',
    'globalThis["window"]["navigation"];',
    "const window = {}; globalThis.navigation;",
  ])("recognizes the Window global aliases: %s", async (code) => {
    expect(await messages(code, "navigation")).toHaveLength(1);
  });

  it.each([
    "navigator.clipboard;",
    "self.navigator.clipboard;",
    "self['window'].navigator.clipboard;",
    'globalThis["navigator"]["clipboard"];',
    'window?.["navigator"]?.["clipboard"];',
    "const navigator = {}; globalThis.navigator.clipboard;",
  ])("recognizes a qualified global instance: %s", async (code) => {
    // The clipboard floor also predates globalThis; count this API's diagnostics only.
    const result = await messages(code, "async-clipboard", "module", "api.Navigator.clipboard");
    expect(result.filter((message) => message.includes("(async-clipboard)"))).toHaveLength(1);
  });

  it.each([
    "new Worker('worker.js', { type: 'module' });",
    "new window.Worker('worker.js', { type: 'module' });",
    'new globalThis["Worker"]("worker.js", { ["type"]: "module" });',
    "new self.Worker('worker.js', { ['type']: 'module' });",
    "const Worker = class {}; new window.Worker('worker.js', { type: 'module' });",
  ])("reports qualified constructor options: %s", async (code) => {
    expect(await messages(code, "js-modules-workers")).toHaveLength(1);
  });

  it.each([
    "canvas.getContext('2d', { alpha: true });",
    "canvas['getContext']('2d', { ['alpha']: true });",
    "canvas?.['getContext']?.('2d', { ['alpha']: true });",
    "(canvas?.['getContext'])('2d', { ['alpha']: true });",
  ])("recognizes static computed option names: %s", async (code) => {
    expect(await messages(code, "canvas-2d-alpha")).toHaveLength(1);
  });

  it.each([
    "gl.getSupportedExtensions().includes('EXT_sRGB');",
    "gl['getSupportedExtensions']()['includes']('EXT_sRGB');",
    "gl?.['getSupportedExtensions']?.()?.['includes']?.('EXT_sRGB');",
    "(gl?.['getSupportedExtensions'])()['includes']('EXT_sRGB');",
  ])("recognizes static computed calls in a receiver chain: %s", async (code) => {
    expect(await messages(code, "ext-srgb")).toHaveLength(1);
  });

  it.each([
    ["function f(structuredClone) { structuredClone({}); }", "structured-clone"],
    ["const window = {}; window.structuredClone({});", "structured-clone"],
    ["const globalThis = {}; globalThis.structuredClone({});", "structured-clone"],
    ["const self = {}; self.structuredClone({});", "structured-clone"],
    ["const self = {}; self.globalThis.structuredClone({});", "structured-clone"],
    ["self[window].structuredClone({});", "structured-clone"],
    ["globalThis.custom.window.structuredClone({});", "structured-clone"],
    ["window[structuredClone]({});", "structured-clone"],
    ["const self = {}; self.AbortSignal.any([]);", "abortsignal-any"],
    ["window[AbortSignal].any([]);", "abortsignal-any"],
    ["AbortSignal[any]([]);", "abortsignal-any"],
    ["const self = {}; self.navigation;", "navigation"],
    ["globalThis[navigator].clipboard;", "async-clipboard"],
    ["const self = {}; new self.BroadcastChannel('channel');", "broadcast-channel"],
    ['new window[BroadcastChannel]("channel");', "broadcast-channel"],
    ["function f(Worker) { new Worker('w.js', { type: 'module' }); }", "js-modules-workers"],
    [
      "const globalThis = {}; new globalThis.Worker('w.js', { type: 'module' });",
      "js-modules-workers",
    ],
    ["new Worker('w.js', { [type]: 'module' });", "js-modules-workers"],
    ["canvas[getContext]('2d', { alpha: true });", "canvas-2d-alpha"],
    ["canvas.getContext('2d', { [alpha]: true });", "canvas-2d-alpha"],
    ["gl.getSupportedExtensions()[includes]('EXT_sRGB');", "ext-srgb"],
    ["gl[getSupportedExtensions]().includes('EXT_sRGB');", "ext-srgb"],
  ])("ignores shadowed globals and dynamic keys: %s", async (code, featureId) => {
    expect(await messages(code, featureId)).toEqual([]);
  });

  it("honors script-scope declarations of a qualified global root", async () => {
    expect(
      await messages("var self = {}; self.structuredClone({});", "structured-clone", "script"),
    ).toEqual([]);
  });
});
