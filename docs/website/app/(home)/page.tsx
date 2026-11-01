import type { Metadata } from "next";
import Link from "next/link";
import { BaselineEditor } from "@/components/baseline-editor";
import { GithubIcon } from "@/components/github-icon";
import { InstallCommand } from "@/components/install-command";

export const metadata: Metadata = {
  title: { absolute: "eslint-plugin-baseline-js" },
  description:
    "Catch the JavaScript your visitors cannot run. One ESLint rule checks widely, newly, or a Baseline year against web-features.",
};

const flatConfig = `import baselineJs from "eslint-plugin-baseline-js";

export default [
  { plugins: { "baseline-js": baselineJs } },
  baselineJs.configs.recommended({ available: "widely" }),
];
`;

export default function HomePage() {
  return (
    <>
      <header className="border-b border-[var(--lp-line)]">
        <div className="mx-auto flex h-12 max-w-5xl items-center justify-between px-6">
          <Link href="/" className="text-sm font-medium tracking-tight">
            eslint-plugin-baseline-js
          </Link>
          <nav className="flex items-center gap-5 text-sm text-[var(--lp-muted)]">
            <Link href="/docs" className="hover:text-[var(--lp-fg)]">
              Docs
            </Link>
            <a
              href="https://github.com/3ru/eslint-plugin-baseline-js"
              className="hover:text-[var(--lp-fg)]"
              target="_blank"
              rel="noreferrer noopener"
            >
              GitHub
            </a>
          </nav>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-6 pt-8 pb-16">
        <h1 className="max-w-3xl text-4xl leading-[1.15] font-medium tracking-tight sm:text-[2.75rem]">
          Catch the JavaScript your visitors cannot run.
        </h1>
        <p className="mt-4 max-w-2xl text-base leading-relaxed text-[var(--lp-muted)]">
          Baseline is a public line for the web platform, maintained by the W3C WebDX Community
          Group. Newly available means the core browsers have shipped a feature. Widely available is
          30 months later. A year keeps features from that Baseline year or earlier.
        </p>
        <p className="mt-3 max-w-2xl text-base leading-relaxed text-[var(--lp-muted)]">
          An API can work in your browser and be missing in a visitor&apos;s, so the call throws and
          they never reach the feature. This one rule shows that gap while you type. It reads
          web-features and delegates detection to eslint-plugin-es-x and ESLint core, with small
          gap-filling rules. The target is widely, newly, or a year.
        </p>

        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
          <InstallCommand />
          <a
            href="https://github.com/3ru/eslint-plugin-baseline-js"
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex h-10 shrink-0 items-center gap-2 rounded-md border border-[var(--lp-line)] px-3 text-sm"
          >
            <GithubIcon className="h-4 w-4" />
            GitHub
          </a>
        </div>
        <p className="mt-3 text-xs text-[var(--lp-muted)]">
          Version 0.7.7, before 1.0. The rule and its options can still change. Requires ESLint 9.29
          through 10.
        </p>

        <section className="mt-8" aria-label="Live Baseline editor">
          <BaselineEditor />
          <p className="mt-3 max-w-3xl text-sm leading-relaxed text-[var(--lp-muted)]">
            <code className="font-mono text-[13px]">URL.parse()</code> and{" "}
            <code className="font-mono text-[13px]">Promise.withResolvers()</code> are absent until
            a browser ships them, so the call throws there.{" "}
            <code className="font-mono text-[13px]">getYear()</code> is different: browsers still
            implement it, and it is Limited, outside Baseline Widely. The rule reports both. It
            does not catch every runtime error. On Widely the sample reports{" "}
            <code className="font-mono text-[13px]">getYear()</code> and{" "}
            <code className="font-mono text-[13px]">URL.parse()</code>.{" "}
            <code className="font-mono text-[13px]">1n</code> and{" "}
            <code className="font-mono text-[13px]">??</code> stay quiet. Newly keeps{" "}
            <code className="font-mono text-[13px]">getYear()</code> only. Year 2020 also reports{" "}
            <code className="font-mono text-[13px]">Promise.withResolvers()</code>, Baseline year
            2024.
          </p>
        </section>

        <section className="mt-16 max-w-3xl">
          <h2 className="text-lg font-medium">Flat config</h2>
          <p className="mt-2 text-sm leading-relaxed text-[var(--lp-muted)]">
            ESLint 9 flat config. <code className="font-mono text-[13px]">available</code> is{" "}
            <code className="font-mono text-[13px]">&quot;widely&quot;</code>,{" "}
            <code className="font-mono text-[13px]">&quot;newly&quot;</code>, or a year such as{" "}
            <code className="font-mono text-[13px]">2020</code>. The editor sends that value to the
            same rule, with <code className="font-mono text-[13px]">includeWebApis</code> and{" "}
            <code className="font-mono text-[13px]">includeJsBuiltins</code> set to{" "}
            <code className="font-mono text-[13px]">{`{ preset: "auto" }`}</code>.
          </p>
          <pre className="mt-4 overflow-x-auto rounded-lg border border-[var(--lp-line)] bg-[var(--lp-card)] p-4 font-mono text-[13px] leading-6">
            <code>{flatConfig}</code>
          </pre>
          <p className="mt-4 text-sm leading-relaxed text-[var(--lp-muted)]">
            Type-aware checks, such as{" "}
            <code className="font-mono text-[13px]">Set.prototype.difference()</code>, need ESLint
            with typescript-eslint and a TypeScript program. They do not run in this editor.
          </p>
          <p className="mt-4 text-sm">
            <Link
              href="/docs/config"
              className="underline decoration-[var(--lp-line)] underline-offset-4"
            >
              Config reference
            </Link>
          </p>
        </section>
      </main>

      <footer className="mt-auto border-t border-[var(--lp-line)]">
        <p className="mx-auto max-w-5xl px-6 py-6 text-xs leading-relaxed text-[var(--lp-muted)]">
          MIT license. Baseline is a trademark of Google LLC. This project is not sponsored by or
          affiliated with Google.
        </p>
      </footer>
    </>
  );
}
