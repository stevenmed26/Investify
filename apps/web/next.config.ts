import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Required for the Docker multi-stage build — produces a self-contained
  // server in .next/standalone that doesn't need node_modules at runtime.
  output: "standalone",
};

export default nextConfig;
