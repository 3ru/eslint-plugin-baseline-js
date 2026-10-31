import { describe, expect, it } from "vitest";
import { lintWithBaseline, reportingPolicyFor } from "./helpers";

describe("Web API safe argument patterns", () => {
  it("checks constructor options without type services", async () => {
    const messages = await lintWithBaseline(
      "new Worker('worker.js', { type: 'module' });",
      reportingPolicyFor("js-modules-workers"),
      {},
      { includeWebApis: { preset: "safe", only: ["js-modules-workers"] } },
    );
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("Feature ID: js-modules-workers.");
  });

  it.each([
    ["const options = { type: 'module' }; new Worker('worker.js', options);", "js-modules-workers"],
    [
      "const canvas = document.createElement('canvas'); canvas.getContext('2d', { alpha: true });",
      "canvas-2d-alpha",
    ],
    ["const options = { alpha: true }; canvas.getContext('2d', options);", "canvas-2d-alpha"],
  ])("skips usages that need receiver or option information: %s", async (code, featureId) => {
    expect(
      await lintWithBaseline(
        code,
        reportingPolicyFor(featureId),
        {},
        {
          includeWebApis: { preset: "safe", only: [featureId] },
        },
      ),
    ).toEqual([]);
  });
});
