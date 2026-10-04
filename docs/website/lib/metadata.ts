import type { Metadata } from "next";

export function createMetadata(override: Metadata): Metadata {
  const defaultImage = "/og.jpg";
  return {
    ...override,
    openGraph: {
      title: (override.title as string | undefined) ?? undefined,
      description: override.description ?? undefined,
      images: defaultImage,
      siteName: "Baseline JS Docs",
      ...override.openGraph,
    },
    twitter: {
      card: "summary_large_image",
      title: (override.title as string | undefined) ?? undefined,
      description: override.description ?? undefined,
      images: defaultImage,
      ...override.twitter,
    },
  } as Metadata;
}

export const baseUrl =
  process.env.NODE_ENV === "development"
    ? new URL("http://localhost:3000")
    : new URL(process.env.NEXT_PUBLIC_SITE_URL || "https://baselinejs.vercel.app");
