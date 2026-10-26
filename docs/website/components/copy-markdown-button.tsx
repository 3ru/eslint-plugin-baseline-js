"use client";

import { buttonVariants } from "fumadocs-ui/components/ui/button";
import { Check, Copy } from "lucide-react";
import { useEffect, useState } from "react";

const cache = new Map<string, string>();

export function CopyMarkdownButton({ markdownUrl }: { markdownUrl: string }) {
  const [state, setState] = useState<"idle" | "loading" | "copied" | "error">("idle");

  useEffect(() => {
    if (state !== "copied") return;
    const timeout = window.setTimeout(() => setState("idle"), 1500);
    return () => window.clearTimeout(timeout);
  }, [state]);

  async function onClick() {
    setState("loading");
    try {
      const cached = cache.get(markdownUrl);
      if (cached) {
        await navigator.clipboard.writeText(cached);
      } else {
        await navigator.clipboard.write([
          new ClipboardItem({
            "text/plain": fetch(markdownUrl).then(async (res) => {
              if (!res.ok) throw new Error(`Markdown request failed with HTTP ${res.status}`);
              const content = await res.text();
              cache.set(markdownUrl, content);
              return content;
            }),
          }),
        ]);
      }
      setState("copied");
    } catch {
      setState("error");
    }
  }

  return (
    <>
      <button
        disabled={state === "loading"}
        className={buttonVariants({
          color: "secondary",
          size: "sm",
          className: "gap-2 [&_svg]:size-3.5",
        })}
        onClick={onClick}
        type="button"
      >
        {state === "copied" ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
        {state === "copied" ? "Copied" : "Copy Markdown"}
      </button>
      <span role="status" className="text-sm text-fd-muted-foreground">
        {state === "error" ? "Could not copy Markdown. Try again." : null}
      </span>
    </>
  );
}
