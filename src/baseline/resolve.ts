import type { BaselineOption } from "../config";
import apiRaw from "./data/features.api";
import raw from "./data/features.javascript";
import jsbiRaw from "./data/features.jsbi";
import compatStatuses from "./data/statuses.compat";
import type { MinFeatureRecord, WebFeaturesBaseline } from "./types";

export type { MinFeatureRecord } from "./types";

const features: Record<string, MinFeatureRecord> = {
  ...(raw as unknown as Record<string, MinFeatureRecord>),
  ...(apiRaw as unknown as Record<string, MinFeatureRecord>),
  ...(jsbiRaw as unknown as Record<string, MinFeatureRecord>),
};

export type BaselineBucket = "widely" | "newly" | "limited" | "unknown";

function mapBaseline(b: WebFeaturesBaseline | undefined): BaselineBucket {
  if (b === "high") return "widely";
  if (b === "low") return "newly";
  if (b === false) return "limited";
  return "unknown";
}

// web-features writes "≤YYYY-MM-DD" when only an upper bound of the date is
// known; the Baseline year is still YYYY.
const BASELINE_DATE = /^(≤?)(\d{4})/;

/** Year in which the feature entered Baseline, or null when it has no date. */
export function baselineYear(status: MinFeatureRecord["status"]): number | null {
  const date = status?.baseline_low_date ?? status?.baseline_high_date;
  const m = date ? BASELINE_DATE.exec(date) : null;
  return m ? Number(m[2]) : null;
}

/** Baseline year for messages, keeping the "≤" prefix of upper-bound dates. */
export function baselineYearLabel(status: MinFeatureRecord["status"]): string | null {
  const date = status?.baseline_low_date ?? status?.baseline_high_date;
  const m = date ? BASELINE_DATE.exec(date) : null;
  return m ? `${m[1]}${m[2]}` : null;
}

export function getFeatureRecord(id: string): MinFeatureRecord | null {
  return features[id] ?? null;
}

export function getFeatureStatus(id: string, compatKey?: string): MinFeatureRecord["status"] {
  return (compatKey ? compatStatuses[id]?.[compatKey] : undefined) ?? getFeatureRecord(id)?.status;
}

export function getFeatureBucket(id: string, compatKey?: string): BaselineBucket {
  return mapBaseline(getFeatureStatus(id, compatKey)?.baseline);
}

export function isBeyondBaseline(
  featureId: string,
  baseline: BaselineOption,
  compatKey?: string,
): boolean {
  const rec = getFeatureRecord(featureId);
  if (!rec) return false;
  const status = getFeatureStatus(featureId, compatKey);
  const bucket = mapBaseline(status?.baseline);
  if (baseline === "widely") {
    return bucket !== "widely";
  }
  if (baseline === "newly") {
    return bucket === "limited";
  }
  if (typeof baseline === "number") {
    // Year-based policy: anything that hasn't entered Baseline yet (limited)
    // should be considered beyond the configured year.
    if (bucket === "limited") return true;
    const y = baselineYear(status);
    if (y == null) return false;
    return y > baseline;
  }
  return false;
}

export function confidenceLabel(kind: "high" | "medium" | "low"): string {
  return kind.charAt(0).toUpperCase() + kind.slice(1);
}
