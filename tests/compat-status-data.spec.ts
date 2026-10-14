import { expect, it } from "vitest";
import { features as webFeatures } from "web-features";
import apiDescriptors from "../src/baseline/data/descriptors.api";
import jsbiDescriptors from "../src/baseline/data/descriptors.jsbi";
import { getFeatureStatus } from "../src/baseline/resolve";
import type { BaselineStatus } from "../src/baseline/types";

function statusFields(status: BaselineStatus | undefined) {
  return [status?.baseline, status?.baseline_low_date, status?.baseline_high_date];
}

it("resolves each generated compatibility key to its upstream Baseline status", () => {
  const keys = new Map(
    [...apiDescriptors, ...jsbiDescriptors].map(({ featureId, compatKey }) => [
      `${featureId}:${compatKey}`,
      { featureId, compatKey },
    ]),
  );
  expect(keys.size).toBeGreaterThan(0);
  for (const [label, { featureId, compatKey }] of keys) {
    const feature = webFeatures[featureId as keyof typeof webFeatures];
    if (!feature || !("status" in feature))
      throw new Error(`Missing upstream feature: ${featureId}`);
    const expected = feature.status?.by_compat_key?.[compatKey] ?? feature.status;
    expect(statusFields(getFeatureStatus(featureId, compatKey)), label).toEqual(
      statusFields(expected),
    );
  }
});
