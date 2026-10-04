import "@/app/global.css";
import { RootProvider } from "fumadocs-ui/provider";
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import type { ReactNode } from "react";
import { baseUrl, createMetadata } from "@/lib/metadata";

const inter = Inter({
  subsets: ["latin"],
});

export const metadata: Metadata = createMetadata({
  title: {
    template: "%s | Baseline JS",
    default: "Baseline JS Docs",
  },
  description:
    "Check JavaScript syntax, built-ins, and Web APIs against Baseline browser support data with eslint-plugin-baseline-js.",
  icons: {
    icon: "/logos/baseline-widely-icon.svg",
  },
  metadataBase: baseUrl, // ensure absolute URLs in OGP
});

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={inter.className} suppressHydrationWarning>
      <body className="flex flex-col min-h-screen">
        <RootProvider>{children}</RootProvider>
      </body>
    </html>
  );
}
