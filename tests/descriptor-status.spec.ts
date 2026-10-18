import { describe, expect, it } from "vitest";
import {
  buildCompatStatusOverrides,
  canonicalizeDescriptors,
} from "../scripts/data/descriptor-status.mjs";

describe("descriptor canonicalization", () => {
  it.each([
    { kind: "newIdent", name: "Widget", key: "api.Widget" },
    { kind: "newMember", base: "Intl", prop: "Widget", key: "javascript.builtins.Intl.Widget" },
  ])("prefers the constructor key for $kind regardless of input order", ({ key, ...pattern }) => {
    const broad = { featureId: "widget", ...pattern, compatKey: key };
    const exact = { ...broad, compatKey: `${key}.Widget` };
    expect(canonicalizeDescriptors([broad, exact])).toEqual([exact]);
    expect(canonicalizeDescriptors([exact, broad])).toEqual([exact]);
  });

  it("deduplicates overlaps while preserving different patterns and feature owners", () => {
    const member = {
      featureId: "first",
      kind: "member",
      base: "window",
      prop: "widget",
      compatKey: "api.Window.widget",
    };
    const call = {
      featureId: "first",
      kind: "callGlobal",
      name: "widget",
      compatKey: "api.Window.widget",
    };
    const otherFeature = { ...member, featureId: "second" };
    const reordered = {
      compatKey: member.compatKey,
      prop: member.prop,
      base: member.base,
      kind: member.kind,
      featureId: member.featureId,
    };
    expect(canonicalizeDescriptors([member, reordered, call, otherFeature])).toEqual([
      member,
      call,
      otherFeature,
    ]);
  });

  it("rejects ambiguous keys instead of selecting the first candidate", () => {
    const descriptor = { featureId: "widget", kind: "callStatic", base: "Widget", prop: "parse" };
    expect(() =>
      canonicalizeDescriptors([
        { ...descriptor, compatKey: "api.Widget.parse" },
        { ...descriptor, compatKey: "api.Widget.parse_static" },
      ]),
    ).toThrow("Ambiguous compat keys");
  });
});

describe("descriptor compatibility status projection", () => {
  const headline = {
    baseline: "high",
    baseline_low_date: "2015-01-01",
    baseline_high_date: "2017-07-01",
  };
  const descriptor = (prop: string) => ({
    featureId: "widget",
    kind: "instanceMember",
    iface: "Widget",
    prop,
    compatKey: `api.Widget.${prop}`,
  });

  it("stores only changed exact statuses, without inheriting dates or browser support", () => {
    const descriptors = ["same", "absent", "unknown", "limited", "undated", "recent"].map(
      descriptor,
    );
    const features = {
      widget: {
        compat_features: descriptors.map(({ compatKey }) => compatKey),
        status: {
          ...headline,
          by_compat_key: {
            "api.Widget.same": { ...headline, support: { chrome: "1" } },
            "api.Widget.unknown": {},
            "api.Widget.limited": { baseline: false },
            "api.Widget.undated": { baseline: "high" },
            "api.Widget.recent": {
              baseline: "low",
              baseline_low_date: "2025-01-01",
              support: { chrome: "100" },
            },
          },
        },
      },
    };
    expect(buildCompatStatusOverrides(descriptors, features)).toEqual({
      widget: {
        "api.Widget.unknown": {},
        "api.Widget.limited": { baseline: false },
        "api.Widget.undated": { baseline: "high" },
        "api.Widget.recent": { baseline: "low", baseline_low_date: "2025-01-01" },
      },
    });
  });

  it("rejects keys belonging to another feature", () => {
    expect(() =>
      buildCompatStatusOverrides([descriptor("parse")], {
        widget: { compat_features: ["api.Widget.other"], status: headline },
      }),
    ).toThrow("Unknown compat key for widget: api.Widget.parse");
  });
});
