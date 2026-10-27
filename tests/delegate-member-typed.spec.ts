import { promises as fs } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { reportingPolicyFor, yearPolicyMessage } from "./helpers";
import { compatYearPolicyMessage } from "./utils/policy";
import { createTypedFixture, lintTypedFixture, type TypedFixture } from "./utils/typed-fixture";

describe("typed member ownership", () => {
  let fixture: TypedFixture;

  beforeAll(async () => {
    fixture = await createTypedFixture("new WeakRef(WeakRef).deref();");
  });

  afterAll(async () => {
    await fs.rm(fixture.root, { recursive: true, force: true });
  });

  it("preserves a receiver construction and a separate bare global argument", async () => {
    const featureId = "weak-references";
    const available = reportingPolicyFor(featureId);
    const messages = await lintTypedFixture(fixture, {
      available,
      includeJsBuiltins: { preset: "type-aware", only: [featureId] },
    });
    expect(messages.some((message) => message.fatal)).toBe(false);
    expect(messages.map((message) => message.message)).toEqual([
      compatYearPolicyMessage(
        featureId,
        "javascript.builtins.WeakRef.WeakRef",
        available,
        "'WeakRef'",
      ),
      yearPolicyMessage(featureId, available, "'WeakRef'"),
      compatYearPolicyMessage(
        featureId,
        "javascript.builtins.WeakRef.deref",
        available,
        "The 'deref' member of WeakRef instances",
      ),
    ]);
  });
});
