// What each host is known to give external JavaScript rules, which configuration format it
// reads, and how it is invoked.
// `typeServices` only sets the expectation a row is judged against; observations are always
// recorded. Revisit an entry when its host changes:
// - Oxlint: https://oxc.rs/docs/guide/usage/linter/js-plugins.html#api-support
// - Bun: https://bun.sh/docs/lint/plugins#notes
import type { Format, Host, HostName } from "./types.ts";

export const configFiles: Record<Format, string> = {
  eslint: "eslint.config.mjs",
  oxlint: ".oxlintrc.json",
};

export const hosts = {
  eslint: {
    format: "eslint",
    typeServices: true,
    typedFlags: [],
    invoke: (paths, args) => ({ command: process.execPath, args: [paths.eslint, ...args] }),
  },
  oxlint: {
    format: "oxlint",
    typeServices: false,
    typedFlags: [],
    invoke: (paths, args) => ({ command: process.execPath, args: [paths.oxlint, ...args] }),
  },
  bun: {
    format: "eslint",
    typeServices: false,
    typedFlags: ["--type-aware"],
    invoke: (paths, args) => ({ command: paths.bun, args: ["lint", ...args] }),
  },
} as const satisfies Record<HostName, Host>;

export const hostNames = Object.keys(hosts) as HostName[];
