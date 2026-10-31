import { describe, expect, it } from "vitest";
import { lintWithBaseline, reportingPolicyFor, yearPolicyMessage } from "./helpers";
import { compatYearPolicyMessage, reportingPolicyForCompat } from "./utils/policy";

const proxyFeature = "proxy-reflect";
const proxyKey = "javascript.builtins.Proxy.revocable";
const symbolKey = "javascript.builtins.Symbol.unscopables";
const include = { includeJsBuiltins: { preset: "safe" } };
const belowProxyGroup = reportingPolicyFor(proxyFeature);
const belowProxyMember = reportingPolicyForCompat(proxyFeature, proxyKey);

describe("member status across delegated features", () => {
  it.each([belowProxyGroup, belowProxyMember])(
    "reports the exact Proxy member year under %s without duplicate reports",
    async (available) => {
      await expect(
        lintWithBaseline("Proxy.revocable({}, {});", available, {}, include),
      ).resolves.toEqual([
        compatYearPolicyMessage(proxyFeature, proxyKey, available, "'Proxy.revocable'"),
      ]);
    },
  );

  it.each([
    "globalThis.Proxy.revocable({}, {});",
    "Proxy['revocable']({}, {});",
    "globalThis['Proxy']['revocable']({}, {});",
  ])("keeps exact member status for %s", async (code) => {
    const messages = await lintWithBaseline(code, belowProxyGroup, {}, include);
    const expected = [
      compatYearPolicyMessage(proxyFeature, proxyKey, belowProxyGroup, "'Proxy.revocable'"),
    ];
    if (code.startsWith("globalThis")) {
      expected.unshift(yearPolicyMessage("globalthis", belowProxyGroup, "'globalThis'"));
    }
    expect(messages).toEqual(expected);
  });

  it("keeps a separate bare global report inside a matched call's arguments", async () => {
    const messages = await lintWithBaseline(
      "Proxy.revocable(Proxy, {});",
      belowProxyGroup,
      {},
      include,
    );
    expect(messages).toHaveLength(2);
    expect(messages).toEqual(
      expect.arrayContaining([
        compatYearPolicyMessage(proxyFeature, proxyKey, belowProxyGroup, "'Proxy.revocable'"),
        yearPolicyMessage(proxyFeature, belowProxyGroup, "'Proxy'"),
      ]),
    );
  });

  it("keeps delegate coverage for bare globals and aliased constructors", async () => {
    await expect(
      lintWithBaseline(
        "var Constructor = Proxy; new Constructor({}, {});",
        belowProxyGroup,
        {},
        include,
      ),
    ).resolves.toEqual([yearPolicyMessage(proxyFeature, belowProxyGroup, "'Proxy'")]);
  });

  it("keeps the syntax-only mode when additional builtin checks are disabled", async () => {
    await expect(lintWithBaseline("Proxy.revocable({}, {});", belowProxyGroup)).resolves.toEqual([
      yearPolicyMessage(proxyFeature, belowProxyGroup, "'Proxy'"),
    ]);
  });

  it.each([
    { includeJsBuiltins: { preset: "safe", ignore: [proxyFeature] } },
    { includeJsBuiltins: { preset: "safe", only: ["with"] } },
  ])("preserves delegate checks when descriptors are filtered out: %j", async (options) => {
    await expect(
      lintWithBaseline("Proxy.revocable({}, {});", belowProxyGroup, {}, options),
    ).resolves.toEqual([yearPolicyMessage(proxyFeature, belowProxyGroup, "'Proxy'")]);
  });

  it("honors feature and node ignores across both reporting paths", async () => {
    for (const ignore of [
      { ignoreFeatures: [proxyFeature] },
      { ignoreNodeTypes: ["Identifier"] },
    ]) {
      await expect(
        lintWithBaseline(
          "Proxy.revocable({}, {});",
          belowProxyGroup,
          {},
          { ...include, ...ignore },
        ),
      ).resolves.toEqual([]);
    }
  });

  it("does not report a shadowed global", async () => {
    await expect(
      lintWithBaseline(
        "function check(Proxy) { Proxy.revocable({}, {}); }",
        belowProxyGroup,
        { sourceType: "module" },
        include,
      ),
    ).resolves.toEqual([]);
  });

  it("does not restore a broad report when the exact diagnostic node is ignored", async () => {
    await expect(
      lintWithBaseline(
        "globalThis.Proxy.revocable({}, {});",
        belowProxyGroup,
        {},
        {
          ...include,
          ignoreFeatures: ["globalthis"],
          ignoreNodeTypes: ["Identifier"],
        },
      ),
    ).resolves.toEqual([]);
  });

  it("detects a member whose feature also owns an unrelated syntax delegate", async () => {
    const available = reportingPolicyForCompat("with", symbolKey);
    await expect(
      lintWithBaseline("void Symbol.unscopables;", available, {}, include),
    ).resolves.toEqual([
      compatYearPolicyMessage("with", symbolKey, available, "'Symbol.unscopables'"),
    ]);
  });

  it("keeps unrelated syntax reports from the same feature", async () => {
    const available = reportingPolicyForCompat("with", symbolKey);
    const messages = await lintWithBaseline(
      "with (object) {} void Symbol.unscopables;",
      available,
      {},
      include,
    );
    expect(messages).toHaveLength(2);
    expect(messages).toContain(
      compatYearPolicyMessage("with", symbolKey, available, "'Symbol.unscopables'"),
    );
    expect(messages.some((message) => message.startsWith("'with' "))).toBe(true);
  });

  it("keeps an exact member silent once the year policy permits it", async () => {
    const available = reportingPolicyForCompat("with", symbolKey) + 1;
    await expect(
      lintWithBaseline("void Symbol.unscopables;", available, {}, include),
    ).resolves.toEqual([]);
  });

  it("preserves separate bigint syntax inside a matched call", async () => {
    const available = reportingPolicyFor("bigint");
    const messages = await lintWithBaseline("BigInt.asIntN(1, 0n);", available, {}, include);
    expect(messages).toEqual([
      compatYearPolicyMessage(
        "bigint",
        "javascript.builtins.BigInt.asIntN",
        available,
        "'BigInt.asIntN'",
      ),
      yearPolicyMessage("bigint", available, "'BigInt'"),
    ]);
  });

  it("replaces an early self-rule report only for the matched Temporal member", async () => {
    const available = reportingPolicyFor("temporal");
    await expect(lintWithBaseline("void Temporal.Now;", available, {}, include)).resolves.toEqual([
      compatYearPolicyMessage(
        "temporal",
        "javascript.builtins.Temporal.Now",
        available,
        "'Temporal.Now'",
      ),
    ]);
  });

  it("replaces a whole-construction report while preserving unmatched constructors", async () => {
    const available = reportingPolicyFor("error-cause");
    const messages = await lintWithBaseline(
      'new Error("message", { cause: null }); new TypeError("message", { cause: null });',
      available,
      {},
      include,
    );
    expect(messages).toHaveLength(2);
    expect(messages[0]).toBe(
      compatYearPolicyMessage(
        "error-cause",
        "javascript.builtins.Error.Error.options_cause_parameter",
        available,
        "new Error(..., { cause: ... })",
      ),
    );
    expect(messages[1]).toMatch(/Feature ID: error-cause\.$/);
  });
});
