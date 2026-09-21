import { describe, expect, it } from "vitest";
import { baselineYearOf, lintWithBaseline, reportingPolicyFor, yearPolicyMessage } from "./helpers";

describe("orchestrator (es-x delegates)", () => {
  it("[nullish-coalescing] widely: should not be flagged", async () => {
    const msgs = await lintWithBaseline("const a = x ?? y;", "widely", { sourceType: "module" });
    expect(msgs.length).toBe(0);
  });

  it("[nullish-coalescing] year policy: reported with the Baseline year from the record", async () => {
    const policy = reportingPolicyFor("nullish-coalescing");
    const msgs = await lintWithBaseline("const a = x ?? y;", policy, { sourceType: "module" });
    expect(msgs).toContain(yearPolicyMessage("nullish-coalescing", policy));
  });

  it("[nullish-coalescing] year policy equal to the Baseline year does not report", async () => {
    const msgs = await lintWithBaseline("const a = x ?? y;", baselineYearOf("nullish-coalescing"), {
      sourceType: "module",
    });
    expect(msgs.length).toBe(0);
  });

  it("[logical-assignments] year policy: reported with the Baseline year from the record", async () => {
    const policy = reportingPolicyFor("logical-assignments");
    const msgs = await lintWithBaseline("a &&= b; a ||= c; a ??= d;", policy);
    expect(msgs).toContain(yearPolicyMessage("logical-assignments", policy));
  });

  it("[template-literals] widely: should not be flagged", async () => {
    const code = "const s = `a" + "$" + "{'b'}" + "`" + ";";
    const msgs = await lintWithBaseline(code, "widely");
    expect(msgs.length).toBe(0);
  });

  it("[spread] widely: should not be flagged", async () => {
    const msgs = await lintWithBaseline("const a = [...b]; const o = { ...obj };", "widely");
    expect(msgs.length).toBe(0);
  });

  it("[class-syntax] widely: should not be flagged", async () => {
    const msgs = await lintWithBaseline("class C {}", "widely", { sourceType: "module" });
    expect(msgs.length).toBe(0);
  });

  it("[destructuring] widely: should not be flagged", async () => {
    const msgs = await lintWithBaseline("const {a} = obj; const [x] = arr;", "widely");
    expect(msgs.length).toBe(0);
  });

  it("[async-await] widely: should not be flagged", async () => {
    const msgs = await lintWithBaseline(
      "async function f(){ await Promise.resolve(1) }",
      "widely",
      { sourceType: "module" },
    );
    expect(msgs.length).toBe(0);
  });

  it("[template-literals] newly: should not be flagged (high is allowed)", async () => {
    const code = "const s = `a" + "$" + "{'b'}" + "`" + ";";
    const msgs = await lintWithBaseline(code, "newly");
    expect(msgs.length).toBe(0);
  });

  it("[top-level-await] is detected whatever its Baseline status", async () => {
    const msgs = await lintWithBaseline(
      "await Promise.resolve(1)",
      reportingPolicyFor("top-level-await"),
      { filePath: "mod.mjs", sourceType: "module" },
    );
    expect(msgs.some((m) => m.includes("(top-level-await)"))).toBe(true);
  });

  it("[numeric-separators] year policy: reported with the Baseline year from the record", async () => {
    const policy = reportingPolicyFor("numeric-separators");
    const msgs = await lintWithBaseline("const n = 1_000_000;", policy);
    expect(msgs).toContain(yearPolicyMessage("numeric-separators", policy));
  });

  it("[hashbang-comments] year policy: reported with the Baseline year from the record", async () => {
    const policy = reportingPolicyFor("hashbang-comments");
    const code = "#!/usr/bin/env node\nconst x = 1;";
    const msgs = await lintWithBaseline(code, policy, {
      filePath: "script.js",
      sourceType: "script",
    });
    expect(msgs).toContain(yearPolicyMessage("hashbang-comments", policy));
  });

  it("[weak-references] year policy: reported with the Baseline year from the record", async () => {
    const policy = reportingPolicyFor("weak-references");
    const code = "const wr = new WeakRef({});";
    const msgs = await lintWithBaseline(code, policy, { sourceType: "module" });
    expect(msgs).toContain(yearPolicyMessage("weak-references", policy));
  });

  it("[async-await] year policy: reported with the Baseline year from the record", async () => {
    const policy = reportingPolicyFor("async-await");
    const code = "async function f(){ await Promise.resolve(1) }";
    const msgs = await lintWithBaseline(code, policy, { sourceType: "module" });
    expect(msgs).toContain(yearPolicyMessage("async-await", policy));
  });

  it("[async-generators] year policy: reported with the Baseline year from the record", async () => {
    const policy = reportingPolicyFor("async-generators");
    const code =
      "async function* g(){ yield 1 }; async function h(){ for await (const x of g()) {} }";
    const msgs = await lintWithBaseline(code, policy, { sourceType: "module" });
    expect(msgs).toContain(yearPolicyMessage("async-generators", policy));
  });

  it("[atomics-wait-async] is detected whatever its Baseline status", async () => {
    const code = "Atomics.waitAsync(new Int32Array(new SharedArrayBuffer(4)), 0, 0);";
    const msgs = await lintWithBaseline(code, reportingPolicyFor("atomics-wait-async"), {
      sourceType: "module",
    });
    expect(msgs.some((m) => m.includes("(atomics-wait-async)"))).toBe(true);
  });

  it("[bigint] year policy: reported with the Baseline year from the record", async () => {
    const policy = reportingPolicyFor("bigint");
    const code = "const a = 1n; const b = BigInt(2);";
    const msgs = await lintWithBaseline(code, policy, { sourceType: "module" });
    expect(msgs).toContain(yearPolicyMessage("bigint", policy));
  });

  it("[class-syntax] year policy: reported with the Baseline year from the record", async () => {
    const policy = reportingPolicyFor("class-syntax");
    const code = "class C {}";
    const msgs = await lintWithBaseline(code, policy, { sourceType: "module" });
    expect(msgs).toContain(yearPolicyMessage("class-syntax", policy));
  });

  it("[destructuring] year policy: reported with the Baseline year from the record", async () => {
    const policy = reportingPolicyFor("destructuring");
    const code = "const {a} = obj; const [x] = arr;";
    const msgs = await lintWithBaseline(code, policy);
    expect(msgs).toContain(yearPolicyMessage("destructuring", policy));
  });

  it("[exponentiation] year policy: reported with the Baseline year from the record", async () => {
    const policy = reportingPolicyFor("exponentiation");
    const code = "const x = 2 ** 3;";
    const msgs = await lintWithBaseline(code, policy);
    expect(msgs).toContain(yearPolicyMessage("exponentiation", policy));
  });

  it("[accessor-methods] widely: legacy accessor methods should be flagged", async () => {
    const code = "const o = {}; o.__defineGetter__('x', function(){});";
    const msgs = await lintWithBaseline(code, "widely");
    expect(
      msgs.some((m) =>
        m.includes(
          "Feature 'Accessor methods' (accessor-methods) is not a widely available Baseline feature.",
        ),
      ),
    ).toBe(true);
  });

  it("[date-to-gmt-string] widely: Date#toGMTString (limited) should be flagged", async () => {
    const msgs = await lintWithBaseline("(new Date()).toGMTString()", "widely");
    expect(
      msgs.some((m) =>
        m.includes(
          "Feature 'toGMTString()' (date-to-gmt-string) is not a widely available Baseline feature.",
        ),
      ),
    ).toBe(true);
  });

  it("[error-cause] year policy: reported with the Baseline year from the record", async () => {
    const policy = reportingPolicyFor("error-cause");
    const code = "new Error('x', { cause: new Error('y') });";
    const msgs = await lintWithBaseline(code, policy);
    expect(msgs).toContain(yearPolicyMessage("error-cause", policy));
  });

  it("[is-error] is detected whatever its Baseline status", async () => {
    const msgs = await lintWithBaseline("Error.isError('x')", reportingPolicyFor("is-error"));
    expect(msgs.some((m) => m.includes("(is-error)"))).toBe(true);
  });

  it("[object-hasown] year policy: reported with the Baseline year from the record", async () => {
    const policy = reportingPolicyFor("object-hasown");
    const msgs = await lintWithBaseline("Object.hasOwn({a:1}, 'a')", policy);
    expect(msgs).toContain(yearPolicyMessage("object-hasown", policy));
  });

  it("[proto] widely: __proto__ (limited) should be flagged", async () => {
    const msgs = await lintWithBaseline("const o = {}; o.__proto__", "widely");
    expect(
      msgs.some((m) =>
        m.includes("Feature '__proto__' (proto) is not a widely available Baseline feature."),
      ),
    ).toBe(true);
  });

  // resizable-buffers: covered via JS builtins descriptors (safe patterns). No syntax delegate.

  it("[transferable-arraybuffer] is detected whatever its Baseline status", async () => {
    const msgs = await lintWithBaseline(
      "(new ArrayBuffer(8)).transfer(4)",
      reportingPolicyFor("transferable-arraybuffer"),
    );
    expect(msgs.some((m) => m.includes("(transferable-arraybuffer)"))).toBe(true);
  });

  // iterators: feature id no longer in JavaScript group — mapping entry removed.

  it("[generators] year policy: reported with the Baseline year from the record", async () => {
    const policy = reportingPolicyFor("generators");
    const code = "function* g(){ yield 1 }";
    const msgs = await lintWithBaseline(code, policy);
    expect(msgs).toContain(yearPolicyMessage("generators", policy));
  });

  it("[globalthis] year policy: reported with the Baseline year from the record", async () => {
    const policy = reportingPolicyFor("globalthis");
    const code = "globalThis.x = 1";
    const msgs = await lintWithBaseline(code, policy, { sourceType: "module" });
    expect(msgs).toContain(yearPolicyMessage("globalthis", policy));
  });

  it("[html-wrapper-methods] (limited) should be flagged on widely", async () => {
    const code = "'x'.bold()";
    const msgs = await lintWithBaseline(code, "widely");
    expect(
      msgs.some((m) =>
        m.includes(
          "Feature 'HTML wrapper methods' (html-wrapper-methods) is not a widely available Baseline feature.",
        ),
      ),
    ).toBe(true);
  });

  it("[let-const] year policy: reported with the Baseline year from the record", async () => {
    const policy = reportingPolicyFor("let-const");
    const code = "let a = 1; const b = 2;";
    const msgs = await lintWithBaseline(code, policy);
    expect(msgs).toContain(yearPolicyMessage("let-const", policy));
  });

  it("[optional-catch-binding] year policy: reported with the Baseline year from the record", async () => {
    const policy = reportingPolicyFor("optional-catch-binding");
    const code = "try { throw 1 } catch { }";
    const msgs = await lintWithBaseline(code, policy);
    expect(msgs).toContain(yearPolicyMessage("optional-catch-binding", policy));
  });

  it("[proxy-reflect] year policy: reported with the Baseline year from the record", async () => {
    const policy = reportingPolicyFor("proxy-reflect");
    const code = "new Proxy({}, {}); Reflect.get({}, 'a');";
    const msgs = await lintWithBaseline(code, policy);
    expect(msgs).toContain(yearPolicyMessage("proxy-reflect", policy));
  });

  it("[shared-memory] year policy: reported with the Baseline year from the record", async () => {
    const policy = reportingPolicyFor("shared-memory");
    const code = "new SharedArrayBuffer(4); Atomics.add(new Int32Array(4), 0, 1);";
    const msgs = await lintWithBaseline(code, policy, { sourceType: "module" });
    expect(msgs).toContain(yearPolicyMessage("shared-memory", policy));
  });

  it("[spread] year policy: reported with the Baseline year from the record", async () => {
    const policy = reportingPolicyFor("spread");
    const code = "const a = [...b]; const o = { ...obj };";
    const msgs = await lintWithBaseline(code, policy);
    expect(msgs).toContain(yearPolicyMessage("spread", policy));
  });

  it("[template-literals] year policy: reported with the Baseline year from the record", async () => {
    const policy = reportingPolicyFor("template-literals");
    const code = "const s = `a" + "$" + "{'b'}" + "`" + ";";
    const msgs = await lintWithBaseline(code, policy);
    expect(msgs).toContain(yearPolicyMessage("template-literals", policy));
  });

  it("[unicode-point-escapes] year policy: reported with the Baseline year from the record", async () => {
    const policy = reportingPolicyFor("unicode-point-escapes");
    const code = "const s = '\\u{1F600}';";
    const msgs = await lintWithBaseline(code, policy);
    expect(msgs).toContain(yearPolicyMessage("unicode-point-escapes", policy));
  });

  it("[nullish-coalescing] ignoreFeatures should skip reports", async () => {
    const msgs = await lintWithBaseline(
      "const a = x ?? y;",
      reportingPolicyFor("nullish-coalescing"),
      { sourceType: "module" },
      { ignoreFeatures: ["nullish-coalescing"] },
    );
    expect(msgs.length).toBe(0);
  });

  // Meta features should never produce reports (no delegates)
  it("[functions] meta: should not be flagged even if year < baseline", async () => {
    const code = "function f(){}";
    const msgs = await lintWithBaseline(code, 2014);
    expect(msgs.length).toBe(0);
  });

  it("[javascript] meta: should not be flagged even if year < baseline", async () => {
    const code = "var x = 1;";
    const msgs = await lintWithBaseline(code, 2014);
    expect(msgs.length).toBe(0);
  });

  it("[bigint64array] year policy: reported with the Baseline year from the record", async () => {
    const policy = reportingPolicyFor("bigint64array");
    const code = "new BigInt64Array(8); new BigUint64Array(8);";
    const msgs = await lintWithBaseline(code, policy);
    expect(msgs).toContain(yearPolicyMessage("bigint64array", policy));
  });

  it("[functions-caller-arguments] (limited) should be flagged on widely", async () => {
    const code = "function f(){}; const x = f.caller; const y = f.arguments;";
    const msgs = await lintWithBaseline(code, "widely");
    expect(
      msgs.some((m) =>
        m.includes(
          "Feature 'Function caller and arguments' (functions-caller-arguments) is not a widely available Baseline feature.",
        ),
      ),
    ).toBe(true);
  });

  it("[math-sum-precise] is detected whatever its Baseline status", async () => {
    const code = "Math.sumPrecise(1,2)";
    const msgs = await lintWithBaseline(code, reportingPolicyFor("math-sum-precise"));
    expect(msgs.some((m) => m.includes("(math-sum-precise)"))).toBe(true);
  });

  it("[math-sum-precise] should not produce duplicate reports", async () => {
    const code = "Math.sumPrecise(1,2)";
    const msgs = await lintWithBaseline(code, reportingPolicyFor("math-sum-precise"));
    const count = msgs.filter((m) => m.includes("(math-sum-precise)")).length;
    expect(count).toBe(1);
  });

  it("[temporal] is detected whatever its Baseline status", async () => {
    const code = "Temporal.Now.instant()";
    const msgs = await lintWithBaseline(code, reportingPolicyFor("temporal"));
    expect(msgs.some((m) => m.includes("(temporal)"))).toBe(true);
  });
});
