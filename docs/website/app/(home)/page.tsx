import type { Metadata } from "next";
import Link from "next/link";
import { BaselineEditor } from "@/components/baseline-editor";
import { GithubIcon } from "@/components/github-icon";
import { InstallCommand } from "@/components/install-command";

export const metadata: Metadata = {
  title: { absolute: "eslint-plugin-baseline-js" },
  description: "Catch the JavaScript your visitors cannot run.",
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
      <header className="lp-nav">
        <div className="lp-frame">
          <Link href="/" className="lp-wordmark">
            eslint-plugin-baseline-js
          </Link>
          <nav>
            <Link href="/docs">Docs</Link>
            <a
              href="https://github.com/3ru/eslint-plugin-baseline-js"
              target="_blank"
              rel="noreferrer noopener"
            >
              GitHub
            </a>
          </nav>
        </div>
      </header>

      <main className="lp-main">
        <div className="lp-frame">
          <h1>
            Catch the JavaScript <br />
            your visitors cannot run.
          </h1>

          <div className="lp-actions">
            <div className="lp-install">
              <InstallCommand />
            </div>
            <a
              className="lp-github"
              href="https://github.com/3ru/eslint-plugin-baseline-js"
              target="_blank"
              rel="noreferrer noopener"
            >
              <GithubIcon />
              GitHub
            </a>
          </div>
          <p className="lp-meta">0.7.7 · before 1.0 · ESLint 9.29–10</p>

          <section className="lp-stage" aria-label="Live Baseline editor">
            <BaselineEditor />
          </section>

          <section className="lp-config">
            <h2>Flat config</h2>
            <pre>
              <code>{flatConfig}</code>
            </pre>
            <p className="lp-aside">
              <code>Set.prototype.difference</code> does not run here.
            </p>
            <Link href="/docs/config">Config</Link>
          </section>
        </div>
      </main>

      <footer className="lp-footer">
        <p>
          MIT license. Baseline is a trademark of Google LLC. This project is not sponsored by or
          affiliated with Google.
        </p>
      </footer>
    </>
  );
}
