import { describe, expect, it } from "vitest";
import { lintWithBaseline, reportingPolicyFor } from "./helpers";

async function workerMessages(options: string) {
  return lintWithBaseline(
    `new Worker('worker.js', ${options});`,
    reportingPolicyFor("js-modules-workers"),
    { sourceType: "module" },
    {
      includeWebApis: { preset: "safe", only: ["js-modules-workers"] },
      includeJsBuiltins: false,
    },
  );
}

describe("Web API option overrides", () => {
  it.each([
    "{ type: 'classic', type: 'module' }",
    "{ type: 'classic', ['type']: 'module' }",
    "{ ['type']: 'classic', type: 'module' }",
    "{ ...unknown, type: 'module' }",
    "{ ...unknown, ['type']: 'module' }",
    "{ [key]: 'classic', type: 'module' }",
    "{ [key]: 'classic', ['type']: 'module' }",
    "{ type: 'module', other: value }",
    "{ type: 'module', ['other']: value }",
    "{ type: 'module', [0]: value }",
    "{ type: 'module', type: 'classic', type: 'module' }",
  ])("reports a final module worker option: %s", async (options) => {
    expect(await workerMessages(options)).toHaveLength(1);
  });

  it.each([
    "{ type: 'module', type: 'classic' }",
    "{ type: 'module', ['type']: 'classic' }",
    "{ ['type']: 'module', type: 'classic' }",
    "{ type: 'module', ...unknown }",
    "{ ['type']: 'module', ...unknown }",
    "{ type: 'module', [key]: value }",
    "{ ['type']: 'module', [key]: value }",
    "{ type: 'module', type: unknown }",
    "{ type: 'module', get type() { return 'module'; } }",
    "{ type: 'module', type() {} }",
  ])("ignores overwritten or uncertain module worker options: %s", async (options) => {
    expect(await workerMessages(options)).toEqual([]);
  });
});
