// Vocabulary shared by the probe rule, the assessment and its tests. The probe reports its
// observation inside an ordinary diagnostic message; this is the only place that says how that
// message is recognised and which reasons the assessment acts on.
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

// Reasons the probe gives for an unavailable capability. Rewording one changes how rows are
// classified, so they live here rather than in the probe and the assessment separately.
export const reasons = {
  typedServicesUnavailable: "typed parser services unavailable",
  fixtureNodeNotVisited: "fixture node not visited",
  optionsNotDelivered: "rule options not delivered",
};
