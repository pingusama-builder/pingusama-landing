import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  images: { unoptimized: true },
  async rewrites() {
    return [
      { source: "/portrait/atlas", destination: "/portrait/atlas.html" },
      { source: "/portrait/vn", destination: "/portrait/vn.html" },
      { source: "/portrait/books", destination: "/portrait/books.html" },
      { source: "/portrait/tinker", destination: "/portrait/tinker.html" },
    ];
  },
};

export default nextConfig;
