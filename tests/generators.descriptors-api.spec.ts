import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function readDescriptorsApi(): string {
  const p = resolve(process.cwd(), "src/baseline/data/descriptors.api.ts");
  return readFileSync(p, "utf8");
}

describe("descriptors.api generation (manual + auto WebGL)", () => {
  it("contains typed heading offset properties", () => {
    // web-features: https://github.com/web-platform-dx/web-features/blob/v3.34.3/features/heading-offset.yml
    // spec: https://html.spec.whatwg.org/multipage/sections.html#heading-levels-&-offsets
    const src = readDescriptorsApi();
    for (const prop of ["headingOffset", "headingReset"]) {
      expect(src).toMatch(
        new RegExp(
          `(?:"featureId"|featureId):\\s*"heading-offset"[\\s\\S]*?(?:"kind"|kind):\\s*"instanceMember"[\\s\\S]*?(?:"iface"|iface):\\s*"HTMLElement"[\\s\\S]*?(?:"prop"|prop):\\s*"${prop}"`,
        ),
      );
    }
  });

  it("contains Canvas 2D willReadFrequently option", () => {
    const src = readDescriptorsApi();
    expect(src).toMatch(
      /(?:"featureId"|featureId):\s*"canvas-2d-willreadfrequently"[\s\S]*?(?:"kind"|kind):\s*"callMemberWithArgs"[\s\S]*?(?:"prop"|prop):\s*"getContext"[\s\S]*?(?:"values"|values):\s*\[\s*"2d"\s*\][\s\S]*?(?:"hasKeys"|hasKeys):\s*\[\s*"willReadFrequently"\s*\]/,
    );
  });

  it("contains WebGL extension EXT_sRGB (getExtension + includes via getSupportedExtensions)", () => {
    const src = readDescriptorsApi();
    expect(src).toMatch(
      /(?:"featureId"|featureId):\s*"ext-srgb"[\s\S]*?(?:"prop"|prop):\s*"getExtension"[\s\S]*?(?:"values"|values):\s*\[\s*"EXT_sRGB"\s*\]/,
    );
    expect(src).toMatch(
      /(?:"featureId"|featureId):\s*"ext-srgb"[\s\S]*?(?:"prop"|prop):\s*"includes"[\s\S]*?(?:"values"|values):\s*\[\s*"EXT_sRGB"\s*\][\s\S]*?(?:"viaCall"|viaCall):[\s\S]*?"getSupportedExtensions"/,
    );
  });
});
