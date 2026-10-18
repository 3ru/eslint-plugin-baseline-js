// What each host is known to give external JavaScript rules, and which ways of checking a
// suggestion its command line allows. Observations are always recorded; these entries only set
// the expectation a row is judged against. Revisit them when a host changes:
// - Oxlint: https://oxc.rs/docs/guide/usage/linter/js-plugins.html#api-support
// - Bun: https://bun.sh/docs/lint/plugins#notes
export const hosts = {
  eslint: {
    configFiles: { inspect: "eslint.config.mjs", suggest: "eslint.suggest.config.mjs" },
    typeServices: true,
    // `-f json` carries each suggestion's description and edit on the diagnostic.
    suggestionPayload: true,
    // There is no --fix-suggestions.
    appliesSuggestions: false,
  },
  oxlint: {
    configFiles: { inspect: ".oxlintrc.json", suggest: ".oxlintrc.suggest.json" },
    typeServices: false,
    suggestionPayload: false,
    appliesSuggestions: true,
  },
  bun: {
    configFiles: { inspect: "eslint.config.mjs", suggest: "eslint.suggest.config.mjs" },
    typeServices: false,
    suggestionPayload: true,
    appliesSuggestions: true,
  },
};

export const hostNames = Object.keys(hosts);
