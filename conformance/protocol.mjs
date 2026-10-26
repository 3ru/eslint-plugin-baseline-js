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
  "ancestors",
  "types",
  "execution",
]);

export const reasons = /** @type {const} */ ({
  typedServicesUnavailable: "typed parser services unavailable",
  fixtureNodeNotVisited: "fixture node not visited",
  optionsNotDelivered: "rule options not delivered",
});
