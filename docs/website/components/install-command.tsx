"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";

const commands = {
  npm: "npm install -D eslint eslint-plugin-baseline-js",
  pnpm: "pnpm add -D eslint eslint-plugin-baseline-js",
  yarn: "yarn add -D eslint eslint-plugin-baseline-js",
} as const;

type Manager = keyof typeof commands;

export function InstallCommand() {
  const [manager, setManager] = useState<Manager>("npm");
  const [copied, setCopied] = useState(false);
  const command = commands[manager];

  async function copy() {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-center">
      <div
        className="inline-flex shrink-0 rounded-md border border-[var(--lp-line)] p-0.5"
        role="tablist"
        aria-label="Package manager"
      >
        {(Object.keys(commands) as Manager[]).map((name) => {
          const selected = manager === name;
          return (
            <button
              key={name}
              type="button"
              role="tab"
              aria-selected={selected}
              className={`rounded px-2.5 py-1 font-mono text-xs ${
                selected
                  ? "bg-[var(--lp-button)] text-[var(--lp-button-text)]"
                  : "text-[var(--lp-muted)]"
              }`}
              onClick={() => {
                setManager(name);
                setCopied(false);
              }}
            >
              {name}
            </button>
          );
        })}
      </div>
      <div className="flex min-w-0 flex-1 items-center gap-2 rounded-md border border-[var(--lp-line)] bg-[var(--lp-card)] py-1 pr-1 pl-3">
        <code className="min-w-0 flex-1 overflow-x-auto font-mono text-[13px] whitespace-nowrap">
          {command}
        </code>
        <button
          type="button"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-[var(--lp-button)] px-3 py-1.5 text-sm text-[var(--lp-button-text)]"
          onClick={() => void copy()}
        >
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}
