// What each host is known to give external JavaScript rules, which configuration format it
// reads, which ways of checking a suggestion its command line allows, and how it is invoked.
// `typeServices` only sets the expectation a row is judged against; observations are always
// recorded. Revisit an entry when its host changes:
// - Oxlint: https://oxc.rs/docs/guide/usage/linter/js-plugins.html#api-support
// - Bun: https://bun.sh/docs/lint/plugins#notes
import type { Format, Host, HostName, Phase } from "./types.ts";

export const configFiles: Record<Format, Record<Exclude<Phase, "fix">, string>> = {
  eslint: { inspect: "eslint.config.mjs", suggest: "eslint.suggest.config.mjs" },
  oxlint: { inspect: ".oxlintrc.json", suggest: ".oxlintrc.suggest.json" },
};

export const hosts = {
  eslint: {
    format: "eslint",
    typeServices: true,
    suggestionPayload: true,
    appliesSuggestions: false,
    typedFlags: [],
    invoke: (paths, args) => ({ command: process.execPath, args: [paths.eslint, ...args] }),
  },
  oxlint: {
    format: "oxlint",
    typeServices: false,
    suggestionPayload: false,
    appliesSuggestions: true,
    typedFlags: [],
    invoke: (paths, args) => ({ command: process.execPath, args: [paths.oxlint, ...args] }),
  },
  bun: {
    format: "eslint",
    typeServices: false,
    suggestionPayload: true,
    appliesSuggestions: true,
    typedFlags: ["--type-aware"],
    invoke: (paths, args) => ({ command: paths.bun, args: ["lint", ...args] }),
  },
} as const satisfies Record<HostName, Host>;

export const hostNames = Object.keys(hosts) as HostName[];
