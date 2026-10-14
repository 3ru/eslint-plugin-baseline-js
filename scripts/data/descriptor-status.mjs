/** @typedef {import("../../src/baseline/types").GeneratedDescriptor} GeneratedDescriptor */
/** @typedef {import("../../src/baseline/types").CompatStatus} CompatStatus */
/** @typedef {typeof import("web-features").features} SourceFeatures */
/** @typedef {{ baseline?: boolean | "high" | "low", baseline_low_date?: string, baseline_high_date?: string }} SourceStatus */

/** @type {(keyof CompatStatus)[]} */
const STATUS_FIELDS = ["baseline", "baseline_low_date", "baseline_high_date"];

/** @param {unknown} value @returns {unknown} */
function normalize(value) {
  if (Array.isArray(value)) return value.map(normalize);
  if (value === null || typeof value !== "object") return value;
  const record = /** @type {Record<string, unknown>} */ (value);
  return Object.fromEntries(
    Object.keys(record)
      .sort()
      .map((key) => [key, normalize(record[key])]),
  );
}

/** @param {GeneratedDescriptor} descriptor */
function patternKey({ compatKey: _, ...descriptor }) {
  return JSON.stringify(normalize(descriptor));
}

/** @param {GeneratedDescriptor} descriptor */
function isConstructorKey(descriptor) {
  if (descriptor.kind !== "newIdent" && descriptor.kind !== "newMember") return false;
  const name = descriptor.kind === "newMember" ? descriptor.prop : descriptor.name;
  return descriptor.compatKey.endsWith(`.${name}.${name}`);
}

/**
 * Select the exact API before policy filtering, including manual/automatic overlaps.
 * @param {GeneratedDescriptor[]} descriptors
 * @returns {GeneratedDescriptor[]}
 */
export function canonicalizeDescriptors(descriptors) {
  /** @type {Map<string, GeneratedDescriptor[]>} */
  const groups = new Map();
  for (const descriptor of descriptors) {
    if (!descriptor.compatKey) {
      throw new Error(`Missing compat key for descriptor: ${JSON.stringify(descriptor)}`);
    }
    const key = patternKey(descriptor);
    const group = groups.get(key);
    if (group) group.push(descriptor);
    else groups.set(key, [descriptor]);
  }

  return [...groups.values()].flatMap((group) => {
    const constructors = group.filter(isConstructorKey);
    const candidates = constructors.length ? constructors : group;
    const unique = new Map(candidates.map((descriptor) => [descriptor.compatKey, descriptor]));
    if (unique.size > 1) {
      throw new Error(`Ambiguous compat keys for descriptor: ${JSON.stringify(group)}`);
    }
    return [...unique.values()];
  });
}

/** @param {SourceStatus} source @returns {CompatStatus} */
function projectStatus(source) {
  if (source.baseline === true) throw new Error("Unexpected Baseline status: true");
  /** @type {CompatStatus} */
  const status = {};
  if (source.baseline !== undefined) status.baseline = source.baseline;
  if (source.baseline_low_date !== undefined) status.baseline_low_date = source.baseline_low_date;
  if (source.baseline_high_date !== undefined)
    status.baseline_high_date = source.baseline_high_date;
  return status;
}

/**
 * Runtime projection: only exact descriptor statuses differing from the feature headline.
 * @param {GeneratedDescriptor[]} descriptors
 * @param {SourceFeatures} features
 * @returns {import("../../src/baseline/types").CompatStatusOverrides}
 */
export function buildCompatStatusOverrides(descriptors, features) {
  /** @type {Record<string, Record<string, CompatStatus>>} */
  const overrides = {};
  for (const { featureId, compatKey } of descriptors) {
    const feature = features[featureId];
    if (
      !feature ||
      !("compat_features" in feature) ||
      !feature.compat_features?.includes(compatKey)
    ) {
      throw new Error(`Unknown compat key for ${featureId}: ${compatKey}`);
    }
    const byKey = feature.status.by_compat_key;
    if (!byKey || !Object.hasOwn(byKey, compatKey)) continue;
    const exact = projectStatus(byKey[compatKey]);
    if (STATUS_FIELDS.every((field) => exact[field] === feature.status[field])) continue;
    (overrides[featureId] ??= {})[compatKey] = exact;
  }
  return overrides;
}
