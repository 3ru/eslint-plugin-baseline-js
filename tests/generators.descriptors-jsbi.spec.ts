import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function readDescriptorsJsbi(): string {
  const p = resolve(process.cwd(), "src/baseline/data/descriptors.jsbi.ts");
  return readFileSync(p, "utf8");
}

describe("descriptors.jsbi generation (manual JS builtins)", () => {
  it("contains Error cause (Error/AggregateError newWithOptions)", () => {
    const src = readDescriptorsJsbi();
    // Error(msg, { cause })
    expect(src).toMatch(
      /(?:"featureId"|featureId):\s*"error-cause"[\s\S]*?(?:"kind"|kind):\s*"newWithOptions"[\s\S]*?(?:"name"|name):\s*"Error"[\s\S]*?(?:"index"|index):\s*1[\s\S]*?(?:"hasKeys"|hasKeys):\s*\[\s*"cause"\s*\]/,
    );
    // AggregateError(errors, msg, { cause })
    expect(src).toMatch(
      /(?:"featureId"|featureId):\s*"error-cause"[\s\S]*?(?:"kind"|kind):\s*"newWithOptions"[\s\S]*?(?:"name"|name):\s*"AggregateError"[\s\S]*?(?:"index"|index):\s*2[\s\S]*?(?:"hasKeys"|hasKeys):\s*\[\s*"cause"\s*\]/,
    );
  });

  it("contains ArrayBuffer resizable option (maxByteLength)", () => {
    const src = readDescriptorsJsbi();
    expect(src).toMatch(
      /(?:"featureId"|featureId):\s*"resizable-buffers"[\s\S]*?(?:"kind"|kind):\s*"newWithOptions"[\s\S]*?(?:"name"|name):\s*"ArrayBuffer"[\s\S]*?(?:"index"|index):\s*1[\s\S]*?(?:"hasKeys"|hasKeys):\s*\[\s*"maxByteLength"\s*\]/,
    );
  });

  it("contains Uint8Array base64/hex (static + instance)", () => {
    const src = readDescriptorsJsbi();
    expect(src).toMatch(
      /(?:"featureId"|featureId):\s*"uint8array-base64-hex"[\s\S]*?(?:"kind"|kind):\s*"callStatic"[\s\S]*?(?:"base"|base):\s*"Uint8Array"[\s\S]*?(?:"prop"|prop):\s*"fromBase64"/,
    );
    expect(src).toMatch(
      /(?:"featureId"|featureId):\s*"uint8array-base64-hex"[\s\S]*?(?:"kind"|kind):\s*"instanceMember"[\s\S]*?(?:"iface"|iface):\s*"Uint8Array"[\s\S]*?(?:"prop"|prop):\s*"toHex"/,
    );
  });

  it("contains Weak references constructors", () => {
    const src = readDescriptorsJsbi();
    expect(src).toMatch(
      /(?:"featureId"|featureId):\s*"weak-references"[\s\S]*?(?:"kind"|kind):\s*"newIdent"[\s\S]*?(?:"name"|name):\s*"WeakRef"/,
    );
    expect(src).toMatch(
      /(?:"featureId"|featureId):\s*"weak-references"[\s\S]*?(?:"kind"|kind):\s*"newIdent"[\s\S]*?(?:"name"|name):\s*"FinalizationRegistry"/,
    );
  });

  it("contains Map and WeakMap getOrInsert instance members", () => {
    const src = readDescriptorsJsbi();
    expect(src).toMatch(
      /(?:"featureId"|featureId):\s*"getorinsert"[\s\S]*?(?:"kind"|kind):\s*"instanceMember"[\s\S]*?(?:"iface"|iface):\s*"Map"[\s\S]*?(?:"prop"|prop):\s*"getOrInsert"/,
    );
    expect(src).toMatch(
      /(?:"featureId"|featureId):\s*"getorinsert"[\s\S]*?(?:"kind"|kind):\s*"instanceMember"[\s\S]*?(?:"iface"|iface):\s*"Map"[\s\S]*?(?:"prop"|prop):\s*"getOrInsertComputed"/,
    );
    expect(src).toMatch(
      /(?:"featureId"|featureId):\s*"getorinsert"[\s\S]*?(?:"kind"|kind):\s*"instanceMember"[\s\S]*?(?:"iface"|iface):\s*"WeakMap"[\s\S]*?(?:"prop"|prop):\s*"getOrInsert"/,
    );
    expect(src).toMatch(
      /(?:"featureId"|featureId):\s*"getorinsert"[\s\S]*?(?:"kind"|kind):\s*"instanceMember"[\s\S]*?(?:"iface"|iface):\s*"WeakMap"[\s\S]*?(?:"prop"|prop):\s*"getOrInsertComputed"/,
    );
  });
});
