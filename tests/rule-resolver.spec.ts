import type { Rule } from "eslint";
import { describe, expect, it } from "vitest";
import { resolvePluginRules } from "../src/utils/rule-resolver";

const dummyRule: Rule.RuleModule = {
  meta: { type: "problem", docs: { description: "dummy" } },
  create() {
    return {};
  },
};

describe("resolvePluginRules", () => {
  it("resolves from { rules } shape", () => {
    const mod = { rules: { foo: dummyRule } };
    const rules = resolvePluginRules(mod);
    expect(rules).toBeTruthy();
    expect(Object.keys(rules ?? {})).toContain("foo");
  });

  it("resolves from { default: { rules } } shape", () => {
    const mod = { default: { rules: { bar: dummyRule } } };
    const rules = resolvePluginRules(mod);
    expect(rules).toBeTruthy();
    expect(Object.keys(rules ?? {})).toContain("bar");
  });

  it("returns undefined for unsupported shapes", () => {
    const rules = resolvePluginRules({});
    expect(rules).toBeUndefined();
  });
});
