import { describe, expect, it } from "vitest";
import { lintWithBaseline } from "./helpers";

describe("ignoreFeatures across descriptor-based detection", () => {
  it("skips Web API descriptors when ignored", async () => {
    const code = "const dpr = window.devicePixelRatio;";
    const msgs = await lintWithBaseline(code, "widely", {}, { includeWebApis: { preset: "auto" } });
    expect(msgs.some((m) => m.includes("(devicepixelratio)"))).toBe(true);

    const ignored = await lintWithBaseline(
      code,
      "widely",
      {},
      { includeWebApis: { preset: "auto" }, ignoreFeatures: ["devicepixelratio"] },
    );
    expect(ignored.length).toBe(0);
  });

  it("skips JS builtin descriptors when ignored", async () => {
    const code = "Array.fromAsync([]);";
    const msgs = await lintWithBaseline(
      code,
      "widely",
      {},
      { includeJsBuiltins: { preset: "auto" } },
    );
    expect(msgs.some((m) => m.includes("(array-fromasync)"))).toBe(true);

    const ignored = await lintWithBaseline(
      code,
      "widely",
      {},
      {
        includeJsBuiltins: { preset: "auto" },
        ignoreFeatures: ["array-fromasync"],
      },
    );
    expect(ignored.length).toBe(0);
  });
});
