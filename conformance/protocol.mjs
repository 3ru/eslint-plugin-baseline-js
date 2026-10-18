// Vocabulary shared by the probe rule, the assessment and its tests. The probe reports its
// observation inside an ordinary diagnostic message; this is the only place that says how that
// message is recognised. Plain ESM so the instrument loads like a shipped JavaScript plugin,
// independent of each host's TypeScript loading.
export const probePluginName = "toolchain-probe";
export const probeRuleId = `${probePluginName}/inspect`;
export const productPluginName = "baseline-js";
export const productRuleId = `${productPluginName}/use-baseline`;
export const sentinelPrefix = `${probePluginName}:`;

export const checks = /** @type {const} */ ([
  "options",
  "selectors",
  "scope",
  "source",
  "location",
  "fixes",
  "ancestors",
  "types",
  "execution",
]);

// Reasons the probe gives for an unavailable capability, shared so the report says what the probe
// said. Only typedServicesUnavailable decides a classification (the documented type gap); the
// others are display text.
export const reasons = /** @type {const} */ ({
  typedServicesUnavailable: "typed parser services unavailable",
  fixtureNodeNotVisited: "fixture node not visited",
  optionsNotDelivered: "rule options not delivered",
});
