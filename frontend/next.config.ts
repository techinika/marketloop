import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      // Product media is served by the Workers API (GET /media/*).
      // Match any host because NEXT_PUBLIC_API_BASE_URL differs per environment.
      { protocol: "http", hostname: "localhost", port: "8787", pathname: "/media/**" },
      { protocol: "https", hostname: "**", pathname: "/media/**" },
      // Google profile pictures (Firebase Auth avatars).
      { protocol: "https", hostname: "lh3.googleusercontent.com" },
      { protocol: "https", hostname: "**" },
    ],
  },
};

export default nextConfig;
