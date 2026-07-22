import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  images: { unoptimized: true },
  async rewrites() {
    return [
      { source: "/portrait/atlas", destination: "/portrait/atlas.html" },
      { source: "/portrait/vn", destination: "/portrait/vn.html" },
      { source: "/portrait/books", destination: "/portrait/books.html" },
      { source: "/portrait/world-name-of-the-wind", destination: "/portrait/world-name-of-the-wind.html" },
    ];
  },
};

export default nextConfig;
