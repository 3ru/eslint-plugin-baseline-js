import { describe, expect, it } from "vitest";
import { features as webFeatures } from "web-features";
import { checkDescriptors } from "../scripts/qa/check-descriptor-compat.mjs";
import apiDescriptors from "../src/baseline/data/descriptors.api";

const urlParse = {
  featureId: "url",
  kind: "callStatic",
  base: "URL",
  prop: "parse",
};

describe("descriptor compatibility validation", () => {
  it("requires the declared owner and type services for argument member patterns", () => {
    const patterns = apiDescriptors.filter(
      (descriptor) => descriptor.kind === "callMemberWithArgs",
    );
    expect(patterns.length).toBeGreaterThan(0);
    expect(checkDescriptors(patterns, webFeatures, "api.")).toEqual([]);
    for (const pattern of patterns) {
      for (const mutation of [
        { ...pattern, iface: "CustomReceiver" },
        { ...pattern, iface: undefined },
        { ...pattern, typedOnly: false },
        { ...pattern, typedOnly: undefined },
      ]) {
        expect(
          checkDescriptors([mutation], webFeatures, "api."),
          JSON.stringify(mutation),
        ).toHaveLength(1);
      }
    }
  });

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
