import { NextResponse } from "next/server";
import { lintWithPlugin } from "@/lib/baseline-linter";
import { type BaselineTarget, isBaselineYear, MAX_SOURCE_BYTES } from "@/lib/editor-lint";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseTarget(value: unknown): BaselineTarget | null {
  if (value === "widely" || value === "newly") return value;
  if (typeof value === "number" && isBaselineYear(value)) return value;
  return null;
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Expected a JSON object." }, { status: 400 });
  }

  const { code, available } = body as { code?: unknown; available?: unknown };
  if (typeof code !== "string") {
    return NextResponse.json({ error: "Source must be a string." }, { status: 400 });
  }

  if (Buffer.byteLength(code, "utf8") > MAX_SOURCE_BYTES) {
    return NextResponse.json({ error: "Source exceeds 8 KB." }, { status: 413 });
  }

  const target = parseTarget(available);
  if (target === null) {
    return NextResponse.json(
      { error: 'Target must be "widely", "newly", or a year.' },
      { status: 400 },
    );
  }

  try {
    const messages = await lintWithPlugin(code, target);
    return NextResponse.json({ messages }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Linting failed.";
    console.error("baseline-js lint failed", message);
    return NextResponse.json(
      {
        error: message.includes("plugin build")
          ? "The plugin build could not be loaded."
          : "Linting failed.",
      },
      { status: 500 },
    );
  }
}
