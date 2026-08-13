import { readFileSync } from "node:fs";

const EXPORT_PREFIX = "export default ";
const CONST_SUFFIX = " as const;";

export function parseGeneratedFeaturesSource(source, sourceLabel = "generated features") {
  const start = source.indexOf(EXPORT_PREFIX);
  const end = source.lastIndexOf(CONST_SUFFIX);
  const jsonStart = start + EXPORT_PREFIX.length;

  if (start === -1 || end < jsonStart) {
    throw new Error(`Could not find the generated feature object in ${sourceLabel}.`);
  }

  const parsed = JSON.parse(source.slice(jsonStart, end).trim());
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Expected a feature object in ${sourceLabel}.`);
  }
  return parsed;
}

export function readGeneratedFeatures(path) {
  return parseGeneratedFeaturesSource(readFileSync(path, "utf8"), path);
}

export function formatBaselineYear(status = {}) {
  const date = status.baseline_low_date || status.baseline_high_date;
  const match = typeof date === "string" ? /^(≤)?(\d{4})-/.exec(date) : null;
  return match ? `${match[1] || ""}${match[2]}` : "";
}
