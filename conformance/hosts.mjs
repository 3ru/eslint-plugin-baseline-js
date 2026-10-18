// What each host is known to give external JavaScript rules, which configuration format it
// reads, and which ways of checking a suggestion its command line allows. `typeServices` only
// sets the expectation a row is judged against; observations are always recorded. The other
// entries choose the files and commands run.mjs uses. Revisit them when a host changes:
// - Oxlint: https://oxc.rs/docs/guide/usage/linter/js-plugins.html#api-support
// - Bun: https://bun.sh/docs/lint/plugins#notes
export const configFiles = {
  eslint: { inspect: "eslint.config.mjs", suggest: "eslint.suggest.config.mjs" },
  oxlint: { inspect: ".oxlintrc.json", suggest: ".oxlintrc.suggest.json" },
};

export const hosts = {
  eslint: {
    configFormat: "eslint",
    typeServices: true,
    // `-f json` carries each suggestion's description and edit on the diagnostic.
    suggestionPayload: true,
    // There is no --fix-suggestions.
    appliesSuggestions: false,
  },
  oxlint: {
    configFormat: "oxlint",
    typeServices: false,
    suggestionPayload: false,
    appliesSuggestions: true,
  },
  bun: {
    configFormat: "eslint",
    typeServices: false,
    suggestionPayload: true,
    appliesSuggestions: true,
  },
};

export const hostNames = Object.keys(hosts);
