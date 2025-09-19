import { createRelativeLink } from "fumadocs-ui/mdx";
import { DocsBody, DocsDescription, DocsPage, DocsTitle } from "fumadocs-ui/page";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CopyMarkdownButton } from "@/components/copy-markdown-button";
import { createMetadata } from "@/lib/metadata";
import { source } from "@/lib/source";
import { DOCS_TOC } from "@/lib/ui";
import { getMDXComponents } from "@/mdx-components";

export default async function Page(props: PageProps<"/docs/[[...slug]]">) {
  const params = await props.params;
  const page = source.getPage(params.slug);
  if (!page) notFound();

  const MDXContent = page.data.body;
  const slug = params.slug ?? [];
  const slugPath =
    Array.isArray(slug) && slug.length > 0 ? `/docs/raw/${slug.join("/")}` : "/docs/raw";

  return (
    <DocsPage
      toc={page.data.toc}
      full={page.data.full}
      tableOfContent={DOCS_TOC}
      lastUpdate={page.data.lastModified ? new Date(page.data.lastModified) : undefined}
    >
      <DocsTitle>{page.data.title}</DocsTitle>
      <DocsDescription className="mb-0">{page.data.description}</DocsDescription>
      <div className="flex items-center gap-2 border-b pb-4 mb-4">
        <CopyMarkdownButton markdownUrl={slugPath} />
      </div>
      <DocsBody>
        <MDXContent
          components={getMDXComponents({
            // this allows you to link to other pages with relative file paths
            a: createRelativeLink(source, page),
          })}
        />
      </DocsBody>
    </DocsPage>
  );
}

export async function generateStaticParams() {
  return source.generateParams();
}

export async function generateMetadata(props: PageProps<"/docs/[[...slug]]">): Promise<Metadata> {
  const params = await props.params;
  const page = source.getPage(params.slug);
  if (!page) notFound();

  return createMetadata({
    title: page.data.title,
    description: page.data.description,
    openGraph: {
      images: (page.data as { image?: string }).image || "/eslint-plugin-baseline-js.jpg",
    },
  });
}
