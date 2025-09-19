import { DocsLayout as DocsLayoutUI } from "fumadocs-ui/layouts/docs";
import type { ReactNode } from "react";
import { baseOptions } from "@/lib/layout.shared";
import { source } from "@/lib/source";
import { DOCS_SIDEBAR } from "@/lib/ui";

const DocsLayout: typeof DocsLayoutUI = DocsLayoutUI;

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <DocsLayout tree={source.pageTree} sidebar={DOCS_SIDEBAR} {...baseOptions()}>
      {children}
    </DocsLayout>
  );
}
