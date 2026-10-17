import { features as webFeatures } from "web-features";
import {
  baselineYear,
  baselineYearLabel,
  getFeatureRecord,
  isBeyondBaseline,
} from "../../src/baseline/resolve";

/** Year policy that reports only Limited features: no Baseline year exceeds it. */
export const LIMITED_ONLY_YEAR = 9999;

function recordOf(id: string) {
  const rec = getFeatureRecord(id);
  if (!rec) throw new Error(`unknown feature id: ${id}`);
  return rec;
}

/** The year in which the feature entered Baseline according to the bundled snapshot. */
export function baselineYearOf(id: string): number {
  const year = baselineYear(recordOf(id).status);
  if (year == null) throw new Error(`${id} has no Baseline date (Limited availability)`);
  return year;
}

/**
 * A year policy under which each listed feature is reported, whatever its
 * Baseline status is in the bundled web-features snapshot.
 *
 * A year policy reports a feature when its Baseline year is later than the
 * configured year, and always reports Limited features. Taking "the year
 * before the feature entered Baseline" from the feature's own record keeps an
 * assertion valid while the feature moves from newly to widely available, and
 * keeps long-established syntax used incidentally by a snippet silent.
 * Limited features have no Baseline year yet and fall back to
 * LIMITED_ONLY_YEAR. Throws for unknown ids and for features no year policy
 * reports.
 */
export function reportingPolicyFor(...featureIds: string[]): number {
  let year = LIMITED_ONLY_YEAR;
  for (const id of featureIds) {
    const y = baselineYear(recordOf(id).status);
    if (y != null) year = Math.min(year, y - 1);
  }
  for (const id of featureIds) {
    if (!isBeyondBaseline(id, year)) {
      throw new Error(`no year policy reports ${id}; check its Baseline dates in the snapshot`);
    }
  }
  return year;
}

/**
 * The message use-baseline reports for `id` under the year policy `policy`,
 * with the feature name and Baseline year taken from the bundled record.
 */
export function yearPolicyMessage(id: string, policy: number, subject?: string): string {
  const rec = recordOf(id);
  const label = subject ?? `'${rec.name ?? id}'`;
  const year = baselineYearLabel(rec.status);
  if (year == null) {
    throw new Error(`${id} has no Baseline date; the plugin reports the Limited message instead`);
  }
  return `${label} became Baseline in ${year} and exceeds ${policy} (${id}).`;
}

/**
 * The exact Baseline status of one compatibility key, independently read from
 * the canonical package rather than from the plugin's generated data. Keys
 * without their own entry inherit the feature status, as web-features does.
 */
export function compatStatusOf(featureId: string, compatKey: string) {
  const feature = webFeatures[featureId as keyof typeof webFeatures];
  if (
    !feature ||
    !("compat_features" in feature) ||
    !feature.compat_features?.includes(compatKey)
  ) {
    throw new Error(`unknown compat key for ${featureId}: ${compatKey}`);
  }
  return feature.status?.by_compat_key?.[compatKey] ?? feature.status;
}

/** The "≤2015" style year label of an exact status, or null when it has no Baseline date. */
function compatYearLabel(featureId: string, compatKey: string): string | null {
  const status = compatStatusOf(featureId, compatKey);
  const date = status?.baseline_low_date ?? status?.baseline_high_date;
  const m = date ? /^(≤?)(\d{4})/.exec(date) : null;
  return m ? `${m[1]}${m[2]}` : null;
}

/** Reporting floor for a known API member, independently read from the canonical package. */
export function reportingPolicyForCompat(featureId: string, compatKey: string): number {
  if (compatStatusOf(featureId, compatKey)?.baseline === false) return LIMITED_ONLY_YEAR;
  const year = compatYearLabel(featureId, compatKey);
  if (year == null) throw new Error(`${compatKey} has no Baseline date`);
  return Number(year.replace(/^≤/, "")) - 1;
}

/**
 * Whether a year policy reports the member on its own status: Limited members
 * always, dated members when their Baseline year is later than `policy`, and
 * members without a Baseline date never.
 */
export function compatReportedUnder(featureId: string, compatKey: string, policy: number): boolean {
  if (compatStatusOf(featureId, compatKey)?.baseline === false) return true;
  const year = compatYearLabel(featureId, compatKey);
  return year != null && Number(year.replace(/^≤/, "")) > policy;
}

/**
 * The message use-baseline reports for a member under the year policy
 * `policy`, with the member's own Baseline status taken from the canonical package.
 */
export function compatYearPolicyMessage(
  featureId: string,
  compatKey: string,
  policy: number,
  subject: string,
): string {
  if (compatStatusOf(featureId, compatKey)?.baseline === false) {
    return `${subject} has Limited availability and exceeds ${policy} (${featureId}).`;
  }
  const year = compatYearLabel(featureId, compatKey);
  if (year == null) throw new Error(`${compatKey} has no Baseline date`);
  return `${subject} became Baseline in ${year} and exceeds ${policy} (${featureId}).`;
}
