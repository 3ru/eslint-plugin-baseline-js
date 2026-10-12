import { RuleTester } from "eslint";
import { describe, it } from "vitest";
import plugin from "../dist/index.mjs";
import { reportingPolicyFor } from "./utils/policy";

const rule = plugin.rules["use-baseline"];
const tester = new RuleTester({
  languageOptions: { ecmaVersion: 2022, sourceType: "module" },
});

describe("Window global APIs", () => {
  it("reports bare fetchLater calls without reporting shadowed functions", () => {
    const options = [
      {
        available: reportingPolicyFor("fetchlater"),
        includeWebApis: { preset: "safe", only: ["fetchlater"] },
      },
    ];
    tester.run("baseline-js/use-baseline (fetchLater)", rule, {
      valid: [
        { code: "function fetchLater() {} fetchLater('/collect');", options },
        { code: "function send(fetchLater) { fetchLater('/collect'); }", options },
        { code: "import { fetchLater } from 'client'; fetchLater('/collect');", options },
        {
          code: "var fetchLater = () => {}; fetchLater('/collect');",
          options,
          languageOptions: { sourceType: "script" },
        },
        { code: "fetchLater('/collect');", options: [{ available: "widely" }] },
      ],
      invalid: [
        { code: "fetchLater('/collect');", options, errors: [{ message: /\(fetchlater\)/ }] },
        { code: "fetchLater?.('/collect');", options, errors: [{ message: /\(fetchlater\)/ }] },
        {
          code: "window.fetchLater('/collect');",
          options,
          errors: [{ message: /\(fetchlater\)/ }],
        },
        {
          code: "fetchLater('/collect');",
          options,
          languageOptions: { globals: { fetchLater: "readonly" } },
          errors: [{ message: /\(fetchlater\)/ }],
        },
      ],
    });
  });
});
