// Vocabulary shared by the probe rule, the assessment and its tests. The probe reports its
// observation inside an ordinary diagnostic message; this is the only place that says how that
// message is recognised.
export const probePluginName = "toolchain-probe";
export const probeRuleId = `${probePluginName}/inspect`;
export const productPluginName = "baseline-js";
export const productRuleId = `${productPluginName}/use-baseline`;
export const sentinelPrefix = `${probePluginName}:`;

export const checks = [
  "options",
  "selectors",
  "scope",
  "source",
  "location",
  "fixes",
  "ancestors",
  "types",
  "execution",
];

// Reasons the probe gives for an unavailable capability, shared so the report says what the probe
// said. Only typedServicesUnavailable decides a classification (the documented type gap); the
// others are display text.
export const reasons = {
  typedServicesUnavailable: "typed parser services unavailable",
  fixtureNodeNotVisited: "fixture node not visited",
  optionsNotDelivered: "rule options not delivered",
};
