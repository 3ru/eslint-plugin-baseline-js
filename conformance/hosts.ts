import { hosts as hostNames } from "../docs/website/lib/compatibility-report.ts";
import type { Format, Host, HostName } from "./types.ts";

export { hostNames };

export const configFiles: Record<Format, string> = {
  eslint: "eslint.config.mjs",
  oxlint: ".oxlintrc.json",
};

export const hosts = {
  eslint: {
    format: "eslint",
    typeServices: true,
    typedFlags: [],
    invoke: (paths, args) => ({ command: process.execPath, args: [paths.executable, ...args] }),
  },
  // JavaScript rules lack typed parser services: https://oxc.rs/docs/guide/usage/linter/js-plugins.html#api-support
  oxlint: {
    format: "oxlint",
    typeServices: false,
    typedFlags: [],
    invoke: (paths, args) => ({ command: process.execPath, args: [paths.executable, ...args] }),
  },
  // JavaScript rules lack typed parser services: https://bun.sh/docs/lint/plugins#notes
  bun: {
    format: "eslint",
    typeServices: false,
    typedFlags: ["--type-aware"],
    invoke: (paths, args) => ({ command: paths.executable, args: ["lint", ...args] }),
  },
} as const satisfies Record<HostName, Host>;
