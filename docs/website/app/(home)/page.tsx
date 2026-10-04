import { buttonVariants } from "fumadocs-ui/components/ui/button";
import { ArrowRight, Github } from "lucide-react";
import Link from "next/link";

export default function HomePage() {
  return (
    <main className="flex flex-1 flex-col items-center px-6 py-20 md:py-28 bg-page-surface">
      {/* Hero */}
      <section className="relative z-0 w-full max-w-5xl text-center">
        <h1 className="hero-heading mx-auto max-w-4xl text-4xl tracking-tight sm:text-5xl md:text-6xl">
          ESLint Plugin for <span className="text-royal-texture">Baseline</span> JavaScript
        </h1>
        <p className="text-pretty mx-auto mt-4 max-w-2xl text-sm text-fd-muted-foreground sm:text-base md:text-lg">
          Default to the Web Platform Baseline, the cross‑browser compatibility standard. Ship code
          that works for everyone.
        </p>

        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/docs"
            className={buttonVariants({
              variant: "outline",
              className:
                "btn-outline-noise group gap-2 px-5 py-2.5 md:px-6 hover:bg-transparent text-[#0b1215]",
            })}
          >
            Get Started
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </Link>
          <a
            href="https://github.com/3ru/eslint-plugin-baseline-js"
            target="_blank"
            rel="noreferrer noopener"
            className={buttonVariants({
              variant: "outline",
              className: "gap-2 px-5 py-2.5 md:px-6",
            })}
          >
            <Github className="h-4 w-4" /> GitHub
          </a>
        </div>
      </section>

      {/* Code demo */}
      <section className="relative mt-10 w-full max-w-3xl">
        <div className="panel-royal baseline-lined mx-auto overflow-hidden rounded-lg ring-1 ring-white/5">
          <div className="baseline-rails" />
          {/* Header bar */}
          <div className="demo-header px-4 sm:px-6 text-xs sm:text-sm">
            <div className="flex items-center gap-2">
              <span className="demo-dot bg-rose-500" />
              <span className="demo-dot bg-amber-500" />
              <span className="demo-dot bg-emerald-500" />
            </div>
            <span className="font-mono">example.js</span>
          </div>

          <pre className="overflow-auto p-4 text-sm leading-7 sm:px-6 sm:py-7 sm:text-base md:text-lg md:leading-8 bg-transparent">
            <code>
              {"const date = new Date();\n"}
              {"const year = "}
              <span className="underline decoration-rose-500 decoration-3 underline-offset-4 [text-decoration-style:wavy]">
                date.getYear();
              </span>
            </code>
          </pre>
          <div className="demo-footer px-4 py-3 text-xs sm:px-6 sm:text-sm md:text-base">
            <p className="flex items-start gap-2 text-rose-500">
              <span className="mt-1.5 inline-block h-2.5 w-2.5 rounded-full bg-rose-500 sm:h-3 sm:w-3" />
              <span>
                Feature{" "}
                <code className="font-mono rounded border bg-fd-muted px-1.5 py-0.5">
                  getYear()
                </code>{" "}
                is not a widely available Baseline feature.
              </span>
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}
