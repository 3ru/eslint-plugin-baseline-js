// What each host is known to give external JavaScript rules. Observations are always recorded;
// these entries only set the expectation a row is judged against. Revisit them when a host changes:
// - Oxlint: https://oxc.rs/docs/guide/usage/linter/js-plugins.html#api-support
// - Bun: https://bun.sh/docs/lint/plugins#notes
export const hosts = {
  eslint: { configFile: "eslint.config.mjs", typeServices: true },
  oxlint: { configFile: ".oxlintrc.json", typeServices: false },
  bun: { configFile: "eslint.config.mjs", typeServices: false },
};

export const hostNames = Object.keys(hosts);
