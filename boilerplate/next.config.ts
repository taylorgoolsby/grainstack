import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Self-contained Node server, which is what runs on your Lambda Web Function.
  output: "standalone",
  // Keep the standalone output at .next/standalone even if a parent folder has a lockfile.
  outputFileTracingRoot: process.cwd(),
  // Lambda's filesystem is read-only and the image optimizer needs native binaries.
  images: { unoptimized: true },
};

export default nextConfig;
