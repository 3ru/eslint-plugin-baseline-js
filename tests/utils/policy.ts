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
export function yearPolicyMessage(id: string, policy: number): string {
  const rec = recordOf(id);
  const label = rec.name ? `${rec.name}' (${id})` : `${id}'`;
  const year = baselineYearLabel(rec.status);
  if (year == null) {
    throw new Error(`${id} has no Baseline date; the plugin reports the Limited message instead`);
  }
  return `Feature '${label} became Baseline in ${year} and exceeds ${policy}.`;
}
