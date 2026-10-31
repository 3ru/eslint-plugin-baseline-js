import { describe, expect, it } from "vitest";
import descriptors from "../src/baseline/data/descriptors.api";
import { lintWithBaseline, reportingPolicyFor } from "./helpers";
import { reportingPolicyForCompat } from "./utils/policy";

// Independently audited Web IDL operations, not copied from generator output.
// HTML/CSSOM: https://html.spec.whatwg.org/multipage/nav-history-apis.html#the-window-object
// Experimental extensions: Fetch, File System Access, Local Font Access,
// Digital Goods, CSS Sizing 4, and Window Management specifications.
const windowOperations = [
  ["alerts", "alert"],
  ["alerts", "confirm"],
  ["alerts", "prompt"],
  ["digital-goods", "getDigitalGoodsService"],
  ["fetchlater", "fetchLater"],
  ["file-system-access", "showDirectoryPicker"],
  ["file-system-access", "showOpenFilePicker"],
  ["file-system-access", "showSaveFilePicker"],
  ["frame-sizing", "requestResize"],
  ["get-computed-style", "getComputedStyle"],
  ["local-fonts", "queryLocalFonts"],
  ["matchmedia", "matchMedia"],
  ["postmessage", "postMessage"],
  ["print", "print"],
  ["request-animation-frame", "cancelAnimationFrame"],
  ["request-animation-frame", "requestAnimationFrame"],
  ["requestidlecallback", "cancelIdleCallback"],
  ["requestidlecallback", "requestIdleCallback"],
  ["scroll-elements", "scroll"],
  ["scroll-elements", "scrollBy"],
  ["scroll-elements", "scrollTo"],
  ["selection-api", "getSelection"],
  ["window", "close"],
  ["window", "focus"],
  ["window", "moveBy"],
  ["window", "moveTo"],
  ["window", "open"],
  ["window", "resizeBy"],
  ["window", "resizeTo"],
  ["window", "stop"],
  ["window-management", "getScreenDetails"],
] as const;

// Static readonly attributes from the respective specifications' IDL.
const staticAttributes = [
  ["compute-pressure", "PressureObserver", "knownSources"],
  ["highlight", "CSS", "highlights"],
  ["media-source", "MediaSource", "canConstructInDedicatedWorker"],
  ["notifications", "Notification", "maxActions"],
  ["notifications", "Notification", "permission"],
  ["paint", "CSS", "paintWorklet"],
  ["performance", "PerformanceObserver", "supportedEntryTypes"],
  ["push", "PushManager", "supportedContentEncodings"],
] as const;

// HTML LegacyFactoryFunction names differ from their interface names.
const legacyFactories = [
  ["audio", "Audio"],
  ["img", "Image"],
  ["select", "Option"],
] as const;

function lint(
  code: string,
  featureId: string,
  preset: "safe" | "auto" = "safe",
  compatKey?: string,
) {
  return lintWithBaseline(
    code,
    compatKey ? reportingPolicyForCompat(featureId, compatKey) : reportingPolicyFor(featureId),
    { sourceType: "module" },
    {
      includeWebApis: { preset, only: [featureId] },
      includeJsBuiltins: false,
    },
  );
}

describe("Web API generation: audited global operations", () => {
  for (const [featureId, name] of windowOperations) {
    it(`detects unqualified ${name}() in safe and auto modes`, async () => {
      for (const preset of ["safe", "auto"] as const) {
        const messages = await lint(`${name}();`, featureId, preset, `api.Window.${name}`);
        expect(
          messages.filter((message) => message.includes(`Feature ID: ${featureId}.`)),
        ).toHaveLength(1);
      }
      expect(
        await lint(
          `function local(${name}) { ${name}(); }`,
          featureId,
          "safe",
          `api.Window.${name}`,
        ),
      ).toEqual([]);
    });
  }

  it("keeps Window attributes and event compatibility labels out of callGlobal", () => {
    for (const name of ["cookieStore", "navigation", "devicePixelRatio", "beforeunload_event"]) {
      expect(
        descriptors.some(
          (descriptor) => descriptor.kind === "callGlobal" && descriptor.name === name,
        ),
      ).toBe(false);
    }
  });
});

describe("Web API generation: static attributes", () => {
  for (const [featureId, base, prop] of staticAttributes) {
    it(`detects reads of ${base}.${prop}`, async () => {
      const messages = await lint(
        `void ${base}.${prop};`,
        featureId,
        "safe",
        `api.${base}.${prop}_static`,
      );
      expect(
        messages.filter((message) => message.includes(`Feature ID: ${featureId}.`)),
      ).toHaveLength(1);
      expect(
        await lint(
          `var ${base} = { ${prop}: 0 }; void ${base}.${prop};`,
          featureId,
          "safe",
          `api.${base}.${prop}_static`,
        ),
      ).toEqual([]);
    });
  }
});

describe("Web API generation: legacy factories and constructor options", () => {
  for (const [featureId, name] of legacyFactories) {
    it(`detects new ${name}()`, async () => {
      const messages = await lint(`new ${name}();`, featureId);
      expect(
        messages.filter((message) => message.includes(`Feature ID: ${featureId}.`)),
      ).toHaveLength(1);
      expect(await lint(`function ${name}() {} new ${name}();`, featureId)).toEqual([]);
    });
  }

  it("detects SharedWorker extendedLifetime literal options", async () => {
    const featureId = "shared-workers-extended-lifetime";
    for (const code of [
      "new SharedWorker('worker.js', { extendedLifetime: true });",
      "new SharedWorker('worker.js', { extendedLifetime: false });",
    ]) {
      const messages = await lint(code, featureId);
      expect(
        messages.filter((message) => message.includes(`Feature ID: ${featureId}.`)),
      ).toHaveLength(1);
    }
    for (const code of [
      "new SharedWorker('worker.js');",
      "new SharedWorker('worker.js', { name: 'shared' });",
      "const options = { extendedLifetime: true }; new SharedWorker('worker.js', options);",
      "class SharedWorker {} new SharedWorker('worker.js', { extendedLifetime: true });",
    ]) {
      expect(await lint(code, featureId)).toEqual([]);
    }
  });
});
