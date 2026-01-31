import { describe, expect, it } from "vitest";
import { lintWithBaseline } from "./helpers";

describe("orchestrator (es-x delegates)", () => {
  it("[nullish-coalescing] widely: should not be flagged", async () => {
    const msgs = await lintWithBaseline("const a = x ?? y;", "widely", { sourceType: "module" });
    expect(msgs.length).toBe(0);
  });

  it("[nullish-coalescing] year: 2020 > 2018 should be flagged", async () => {
    const msgs = await lintWithBaseline("const a = x ?? y;", 2018, { sourceType: "module" });
    expect(
      msgs.some((m) =>
        m.includes(
          "Feature 'Nullish coalescing' (nullish-coalescing) became Baseline in 2020 and exceeds 2018.",
        ),
      ),
    ).toBe(true);
  });

  it("[nullish-coalescing] year: 2020 baseline should not be flagged", async () => {
    const msgs = await lintWithBaseline("const a = x ?? y;", 2020, { sourceType: "module" });
    expect(msgs.length).toBe(0);
  });

  it("[logical-assignments] year: 2020 > 2018 should be flagged", async () => {
    const msgs = await lintWithBaseline("a &&= b; a ||= c; a ??= d;", 2018);
    expect(
      msgs.some((m) =>
        m.includes(
          "Feature 'Logical assignments' (logical-assignments) became Baseline in 2020 and exceeds 2018.",
        ),
      ),
    ).toBe(true);
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

  it("[top-level-await] (limited) should be flagged on widely", async () => {
    const msgs = await lintWithBaseline("await Promise.resolve(1)", "widely", {
      filePath: "mod.mjs",
      sourceType: "module",
    });
    expect(
      msgs.some((m) =>
        m.includes(
          "Feature 'Top-level await' (top-level-await) is not a widely available Baseline feature.",
        ),
      ),
    ).toBe(true);
  });

  it("[numeric-separators] year: 2020 > 2018 should be flagged", async () => {
    const msgs = await lintWithBaseline("const n = 1_000_000;", 2018);
    expect(
      msgs.some((m) =>
        m.includes(
          "Feature 'Numeric separators' (numeric-separators) became Baseline in 2020 and exceeds 2018.",
        ),
      ),
    ).toBe(true);
  });

  it("[hashbang-comments] year: 2020 > 2018 should be flagged", async () => {
    const code = "#!/usr/bin/env node\nconst x = 1;";
    const msgs = await lintWithBaseline(code, 2018, {
      filePath: "script.js",
      sourceType: "script",
    });
    expect(
      msgs.some((m) =>
        m.includes(
          "Feature 'Hashbang comments' (hashbang-comments) became Baseline in 2020 and exceeds 2018.",
        ),
      ),
    ).toBe(true);
  });

  it("[weak-references] year: 2021 > 2018 should be flagged", async () => {
    const code = "const wr = new WeakRef({});";
    const msgs = await lintWithBaseline(code, 2018, { sourceType: "module" });
    expect(
      msgs.some((m) =>
        m.includes(
          "Feature 'Weak references' (weak-references) became Baseline in 2021 and exceeds 2018.",
        ),
      ),
    ).toBe(true);
  });

  it("[async-await] year: 2017 > 2016 should be flagged", async () => {
    const code = "async function f(){ await Promise.resolve(1) }";
    const msgs = await lintWithBaseline(code, 2016, { sourceType: "module" });
    expect(
      msgs.some((m) =>
        m.includes(
          "Feature 'Async functions' (async-await) became Baseline in 2017 and exceeds 2016.",
        ),
      ),
    ).toBe(true);
  });

  it("[async-generators] year: 2020 > 2018 should be flagged", async () => {
    const code =
      "async function* g(){ yield 1 }; async function h(){ for await (const x of g()) {} }";
    const msgs = await lintWithBaseline(code, 2018, { sourceType: "module" });
    expect(
      msgs.some((m) =>
        m.includes(
          "Feature 'Async generators' (async-generators) became Baseline in 2020 and exceeds 2018.",
        ),
      ),
    ).toBe(true);
  });

  it("[atomics-wait-async] (newly) should be flagged on widely", async () => {
    const code = "Atomics.waitAsync(new Int32Array(new SharedArrayBuffer(4)), 0, 0);";
    const msgs = await lintWithBaseline(code, "widely", { sourceType: "module" });
    expect(
      msgs.some((m) =>
        m.includes(
          "Feature 'Atomics.waitAsync()' (atomics-wait-async) is not a widely available Baseline feature.",
        ),
      ),
    ).toBe(true);
  });

  it("[bigint] year: 2020 > 2018 should be flagged", async () => {
    const code = "const a = 1n; const b = BigInt(2);";
    const msgs = await lintWithBaseline(code, 2018, { sourceType: "module" });
    expect(
      msgs.some((m) =>
        m.includes("Feature 'BigInt' (bigint) became Baseline in 2020 and exceeds 2018."),
      ),
    ).toBe(true);
  });

  it("[class-syntax] year: 2016 > 2015 should be flagged", async () => {
    const code = "class C {}";
    const msgs = await lintWithBaseline(code, 2015, { sourceType: "module" });
    expect(
      msgs.some((m) =>
        m.includes("Feature 'Classes' (class-syntax) became Baseline in 2016 and exceeds 2015."),
      ),
    ).toBe(true);
  });

  it("[destructuring] year: 2020 > 2018 should be flagged", async () => {
    const code = "const {a} = obj; const [x] = arr;";
    const msgs = await lintWithBaseline(code, 2018);
    expect(
      msgs.some((m) =>
        m.includes(
          "Feature 'Destructuring' (destructuring) became Baseline in 2020 and exceeds 2018.",
        ),
      ),
    ).toBe(true);
  });

  it("[exponentiation] year: 2017 > 2016 should be flagged", async () => {
    const code = "const x = 2 ** 3;";
    const msgs = await lintWithBaseline(code, 2016);
    expect(
      msgs.some((m) =>
        m.includes(
          "Feature 'Exponentiation operator' (exponentiation) became Baseline in 2017 and exceeds 2016.",
        ),
      ),
    ).toBe(true);
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

  it("[error-cause] year: 2021 > 2020 should be flagged", async () => {
    const code = "new Error('x', { cause: new Error('y') });";
    const msgs = await lintWithBaseline(code, 2020);
    expect(
      msgs.some((m) =>
        m.includes("Feature 'Error cause' (error-cause) became Baseline in 2021 and exceeds 2020."),
      ),
    ).toBe(true);
  });

  it("[is-error] widely: Error.isError() (limited) should be flagged", async () => {
    const msgs = await lintWithBaseline("Error.isError('x')", "widely");
    expect(
      msgs.some((m) =>
        m.includes(
          "Feature 'Error.isError()' (is-error) is not a widely available Baseline feature.",
        ),
      ),
    ).toBe(true);
  });

  it("[object-hasown] year: 2022 > 2020 should be flagged", async () => {
    const msgs = await lintWithBaseline("Object.hasOwn({a:1}, 'a')", 2020);
    expect(
      msgs.some((m) =>
        m.includes(
          "Feature 'Object.hasOwn()' (object-hasown) became Baseline in 2022 and exceeds 2020.",
        ),
      ),
    ).toBe(true);
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

  it("[transferable-arraybuffer] widely: ArrayBuffer.prototype.transfer should be flagged", async () => {
    const msgs = await lintWithBaseline("(new ArrayBuffer(8)).transfer(4)", "widely");
    expect(
      msgs.some((m) =>
        m.includes(
          "Feature 'Transferable ArrayBuffer' (transferable-arraybuffer) is not a widely available Baseline feature.",
        ),
      ),
    ).toBe(true);
  });

  // iterators: feature id no longer in JavaScript group — mapping entry removed.

  it("[generators] year: 2016 > 2015 should be flagged", async () => {
    const code = "function* g(){ yield 1 }";
    const msgs = await lintWithBaseline(code, 2015);
    expect(
      msgs.some((m) =>
        m.includes("Feature 'Generators' (generators) became Baseline in 2016 and exceeds 2015."),
      ),
    ).toBe(true);
  });

  it("[globalthis] year: 2020 > 2018 should be flagged", async () => {
    const code = "globalThis.x = 1";
    const msgs = await lintWithBaseline(code, 2018, { sourceType: "module" });
    expect(
      msgs.some((m) =>
        m.includes("Feature 'globalThis' (globalthis) became Baseline in 2020 and exceeds 2018."),
      ),
    ).toBe(true);
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

  it("[let-const] year: 2016 > 2015 should be flagged", async () => {
    const code = "let a = 1; const b = 2;";
    const msgs = await lintWithBaseline(code, 2015);
    expect(
      msgs.some((m) =>
        m.includes("Feature 'Let and const' (let-const) became Baseline in 2016 and exceeds 2015."),
      ),
    ).toBe(true);
  });

  it("[optional-catch-binding] year: 2020 > 2018 should be flagged", async () => {
    const code = "try { throw 1 } catch { }";
    const msgs = await lintWithBaseline(code, 2018);
    expect(
      msgs.some((m) =>
        m.includes(
          "Feature 'Optional catch binding' (optional-catch-binding) became Baseline in 2020 and exceeds 2018.",
        ),
      ),
    ).toBe(true);
  });

  it("[proxy-reflect] year: 2016 > 2015 should be flagged", async () => {
    const code = "new Proxy({}, {}); Reflect.get({}, 'a');";
    const msgs = await lintWithBaseline(code, 2015);
    expect(
      msgs.some((m) =>
        m.includes(
          "Feature 'Proxy and Reflect' (proxy-reflect) became Baseline in 2016 and exceeds 2015.",
        ),
      ),
    ).toBe(true);
  });

  it("[shared-memory] year: 2021 > 2018 should be flagged", async () => {
    const code = "new SharedArrayBuffer(4); Atomics.add(new Int32Array(4), 0, 1);";
    const msgs = await lintWithBaseline(code, 2018, { sourceType: "module" });
    expect(
      msgs.some((m) =>
        m.includes(
          "Feature 'SharedArrayBuffer and Atomics' (shared-memory) became Baseline in 2021 and exceeds 2018.",
        ),
      ),
    ).toBe(true);
  });

  it("[spread] year: 2020 > 2018 should be flagged", async () => {
    const code = "const a = [...b]; const o = { ...obj };";
    const msgs = await lintWithBaseline(code, 2018);
    expect(
      msgs.some((m) =>
        m.includes("Feature 'Spread syntax' (spread) became Baseline in 2020 and exceeds 2018."),
      ),
    ).toBe(true);
  });

  it("[template-literals] year: 2020 > 2018 should be flagged", async () => {
    const code = "const s = `a" + "$" + "{'b'}" + "`" + ";";
    const msgs = await lintWithBaseline(code, 2018);
    expect(
      msgs.some((m) =>
        m.includes(
          "Feature 'Template literals' (template-literals) became Baseline in 2020 and exceeds 2018.",
        ),
      ),
    ).toBe(true);
  });

  it("[unicode-point-escapes] year: 2015 > 2014 should be flagged", async () => {
    const code = "const s = '\\u{1F600}';";
    const msgs = await lintWithBaseline(code, 2014);
    expect(
      msgs.some((m) =>
        m.includes(
          "Feature 'Unicode point escapes' (unicode-point-escapes) became Baseline in 2015 and exceeds 2014.",
        ),
      ),
    ).toBe(true);
  });

  it("[nullish-coalescing] ignoreFeatures should skip reports", async () => {
    const msgs = await lintWithBaseline(
      "const a = x ?? y;",
      2018,
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

  it("[bigint64array] year: 2021 > 2018 should be flagged", async () => {
    const code = "new BigInt64Array(8); new BigUint64Array(8);";
    const msgs = await lintWithBaseline(code, 2018);
    expect(
      msgs.some((m) =>
        m.includes(
          "Feature 'BigInt64Array' (bigint64array) became Baseline in 2021 and exceeds 2018.",
        ),
      ),
    ).toBe(true);
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

  it("[math-sum-precise] (limited) should be flagged on widely", async () => {
    const code = "Math.sumPrecise(1,2)";
    const msgs = await lintWithBaseline(code, "widely");
    expect(
      msgs.some((m) =>
        m.includes(
          "Feature 'Math.sumPrecise()' (math-sum-precise) is not a widely available Baseline feature.",
        ),
      ),
    ).toBe(true);
  });

  it("[math-sum-precise] should not produce duplicate reports", async () => {
    const code = "Math.sumPrecise(1,2)";
    const msgs = await lintWithBaseline(code, "widely");
    const count = msgs.filter((m) =>
      m.includes(
        "Feature 'Math.sumPrecise()' (math-sum-precise) is not a widely available Baseline feature.",
      ),
    ).length;
    expect(count).toBe(1);
  });

  it("[temporal] (limited) should be flagged on widely", async () => {
    const code = "Temporal.Now.instant()";
    const msgs = await lintWithBaseline(code, "widely");
    expect(
      msgs.some((m) =>
        m.includes("Feature 'Temporal' (temporal) is not a widely available Baseline feature."),
      ),
    ).toBe(true);
  });
});
