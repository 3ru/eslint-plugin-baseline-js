const STATUS_FIELDS = ["baseline", "baseline_low_date", "baseline_high_date"];

function normalize(value) {
  if (Array.isArray(value)) return value.map(normalize);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, normalize(value[key])]),
  );
}

function patternKey({ compatKey: _, ...descriptor }) {
  return JSON.stringify(normalize(descriptor));
}

function isConstructorKey(descriptor) {
  const name = descriptor.kind === "newMember" ? descriptor.prop : descriptor.name;
  return name && descriptor.compatKey?.endsWith(`.${name}.${name}`);
}

/** Select the exact API before policy filtering, including manual/automatic overlaps. */
export function canonicalizeDescriptors(descriptors) {
  const groups = new Map();
  for (const descriptor of descriptors) {
    const key = patternKey(descriptor);
    const group = groups.get(key);
    if (group) group.push(descriptor);
    else groups.set(key, [descriptor]);
  }

  return [...groups.values()].flatMap((group) => {
    const keyed = group.filter((descriptor) => descriptor.compatKey);
    const constructors = keyed.filter(isConstructorKey);
    const candidates = constructors.length ? constructors : keyed.length ? keyed : group;
    const unique = new Map(candidates.map((descriptor) => [descriptor.compatKey, descriptor]));
    if (unique.size > 1) {
      throw new Error(`Ambiguous compat keys for descriptor: ${JSON.stringify(group)}`);
    }
    return [...unique.values()];
  });
}

/** Runtime projection: only exact descriptor statuses differing from the feature headline. */
export function buildCompatStatusOverrides(descriptors, features) {
  const overrides = {};
  for (const { featureId, compatKey } of descriptors) {
    if (!compatKey) continue;
    const feature = features[featureId];
    if (!feature?.compat_features?.includes(compatKey)) {
      throw new Error(`Unknown compat key for ${featureId}: ${compatKey}`);
    }
    const byKey = feature.status?.by_compat_key;
    if (!byKey || !Object.hasOwn(byKey, compatKey)) continue;
    const exact = byKey[compatKey];
    if (STATUS_FIELDS.every((field) => exact[field] === feature.status[field])) continue;
    (overrides[featureId] ??= {})[compatKey] = Object.fromEntries(
      STATUS_FIELDS.filter((field) => exact[field] !== undefined).map((field) => [
        field,
        exact[field],
      ]),
    );
  }
  return overrides;
}
