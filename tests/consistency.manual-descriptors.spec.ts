import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

function readText(p: string): string {
  return readFileSync(p, "utf8");
}

function parseManualFeatureIdsFromScript(): { api: Set<string>; jsbi: Set<string> } {
  const p = resolve(process.cwd(), "scripts/data/build-descriptors.mjs");
  const src = readText(p);
  function collect(name: string): Set<string> {
    const out = new Set<string>();
    const re = new RegExp(`${name}\\s*=\\s*\\[([\\\\s\\S]*?)\\]`, "m");
    const m = re.exec(src);
    if (!m) return out;
    const block = m[1];
    const fe = /featureId:\s*['"]([^'"]+)['"]/g;
    for (const x of block.matchAll(fe)) out.add(x[1]);
    return out;
  }
  return { api: collect("manualApi"), jsbi: collect("manualJsbi") };
}

function parseGeneratedDescriptors(pathFromRoot: string): unknown[] {
  const p = resolve(process.cwd(), pathFromRoot);
  const src = readText(p);
  const m = src.match(/=\s*(\[[\s\S]*\]);\s*export default /m);
  if (!m) return [];
  return JSON.parse(m[1]) as unknown[];
}

function parseManualDescriptorsFromScript(): { api: unknown[]; jsbi: unknown[] } {
  const p = resolve(process.cwd(), "scripts/data/build-descriptors.mjs");
  const src = readText(p);
  function extract(name: "manualApi" | "manualJsbi"): unknown[] {
    const re = new RegExp(`const\\s+${name}\\s*=\\s*(\\[[\\s\\S]*?\\]);`, "m");
    const m = re.exec(src);
    if (!m) return [];
    return runInNewContext(m[1], {}) as unknown[];
  }
  return { api: extract("manualApi"), jsbi: extract("manualJsbi") };
}

function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((v) => normalize(v));
  if (!value || typeof value !== "object") return value;
  const src = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(src).sort()) out[key] = normalize(src[key]);
  return out;
}

function keyOf(value: unknown): string {
  return JSON.stringify(normalize(value));
}

function readManifest(): { api: string[]; jsbi: string[] } {
  const p = resolve(process.cwd(), "tests/fixtures/manifest.manual.json");
  return JSON.parse(readText(p));
}

describe("manual descriptors consistency", () => {
  it("manifest covers all manualApi/manualJsbi featureIds", () => {
    const script = parseManualFeatureIdsFromScript();
    const manifest = readManifest();
    const missApi = [...script.api].filter((id) => !manifest.api.includes(id));
    const missJsbi = [...script.jsbi].filter((id) => !manifest.jsbi.includes(id));
    expect({ missApi, missJsbi }).toEqual({ missApi: [], missJsbi: [] });
  });

  it("generated descriptors include every manual descriptor entry (member-level)", () => {
    const manual = parseManualDescriptorsFromScript();
    const generatedApi = parseGeneratedDescriptors("src/baseline/data/descriptors.api.ts");
    const generatedJsbi = parseGeneratedDescriptors("src/baseline/data/descriptors.jsbi.ts");

    const generatedApiKeys = new Set(generatedApi.map((d) => keyOf(d)));
    const generatedJsbiKeys = new Set(generatedJsbi.map((d) => keyOf(d)));

    const missingApi = manual.api.filter((d) => !generatedApiKeys.has(keyOf(d)));
    const missingJsbi = manual.jsbi.filter((d) => !generatedJsbiKeys.has(keyOf(d)));

    expect(missingApi).toEqual([]);
    expect(missingJsbi).toEqual([]);
  });
});
