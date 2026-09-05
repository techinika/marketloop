import type { NextConfig } from "next";

const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL;

/** Allowed host for Workers-hosted product media (GET /media/*). */
const mediaHosts = new Set<string>();
if (apiBaseUrl) {
  try {
    const host = new URL(apiBaseUrl).hostname;
    if (host) mediaHosts.add(host);
  } catch {
    // Ignore malformed env; fall back to defaults below.
  }
}
mediaHosts.add("localhost");

const remotePatterns: NonNullable<NextConfig["images"]>["remotePatterns"] = [];
for (const host of mediaHosts) {
  const port = host === "localhost" ? "8787" : undefined;
  remotePatterns.push(
    { protocol: "http", hostname: host, port, pathname: "/media/**" },
    { protocol: "https", hostname: host, port, pathname: "/media/**" },
  );
}
// Firebase Auth avatar URLs (Google profile pictures).
remotePatterns.push(
  { protocol: "https", hostname: "**.googleusercontent.com" },
  { protocol: "http", hostname: "**.googleusercontent.com" },
);

const nextConfig: NextConfig = {
  images: { remotePatterns },
};

export default nextConfig;
