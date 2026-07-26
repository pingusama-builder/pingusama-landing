import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  images: { unoptimized: true },
  async rewrites() {
    return [
      { source: "/portrait/atlas", destination: "/portrait/atlas.html" },
    ];
  },
};

export default nextConfig;
