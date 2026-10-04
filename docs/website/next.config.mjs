import { createMDX } from "fumadocs-mdx/next";

const withMDX = createMDX();

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  // Silence Next.js Turbopack workspace root warning by pinning the root
  // to this app directory. This avoids auto-detection across parent lockfiles.
  turbopack: {
    root: process.cwd(),
  },
  serverExternalPackages: ["typescript"],
};

export default withMDX(config);
