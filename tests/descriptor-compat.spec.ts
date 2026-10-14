import { describe, expect, it } from "vitest";
import { features as webFeatures } from "web-features";
import { checkDescriptors } from "../scripts/qa/check-descriptor-compat.mjs";

const urlParse = {
  featureId: "url",
  kind: "callStatic",
  base: "URL",
  prop: "parse",
};

describe("descriptor compatibility validation", () => {
  it("rejects an owned key that describes the wrong API", () => {
    const descriptor = { ...urlParse, compatKey: "api.URL" };
    expect(checkDescriptors([descriptor], webFeatures, "api.")).toEqual([
      { featureId: "url", descriptor, reason: "no-compat-key-match" },
    ]);
    expect(
      checkDescriptors([{ ...urlParse, compatKey: "api.URL.parse_static" }], webFeatures, "api."),
    ).toEqual([]);
  });

  it("accepts an explicitly keyed constructor option", () => {
    expect(
      checkDescriptors(
        [
          {
            featureId: "js-modules-workers",
            kind: "newWithOptions",
            name: "Worker",
            objectArg: { index: 1, keyValues: [{ key: "type", values: ["module"] }] },
            compatKey: "api.Worker.Worker.ecmascript_modules",
          },
        ],
        webFeatures,
        "api.",
      ),
    ).toEqual([]);
  });
});
