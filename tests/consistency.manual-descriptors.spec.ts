import { describe, expect, it } from "vitest";
import { manualApi, manualJsbi } from "../scripts/data/manual-descriptors.mjs";
import apiDescriptors from "../src/baseline/data/descriptors.api";
import jsbiDescriptors from "../src/baseline/data/descriptors.jsbi";
import manifest from "./fixtures/manifest.manual.json";

describe("manual descriptors consistency", () => {
  it("manifest covers the complete manual feature list", () => {
    expect([...new Set(manualApi.map(({ featureId }) => featureId))].sort()).toEqual(
      [...manifest.api].sort(),
    );
    expect([...new Set(manualJsbi.map(({ featureId }) => featureId))].sort()).toEqual(
      [...manifest.jsbi].sort(),
    );
  });

  it("retains every manual detection pattern and its explicit compatibility key", () => {
    expect(apiDescriptors).toEqual(expect.arrayContaining(manualApi));
    expect(jsbiDescriptors).toEqual(expect.arrayContaining(manualJsbi));
  });
});
