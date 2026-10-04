import { notFound } from "next/navigation";
import { source } from "@/lib/source";

export async function GET(_request: Request, { params }: { params: Promise<{ slug?: string[] }> }) {
  const { slug = [] } = await params;
  const page = source.getPage(slug);
  if (!page) notFound();

  return new Response(await page.data.getText("raw"), {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
