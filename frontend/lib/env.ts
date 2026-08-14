/**
 * Centralized access to public env vars (Next.js inlines `NEXT_PUBLIC_*` at
 * build time). Every value has a sensible default so the app still runs in
 * local dev and preview deployments without extra setup.
 */

export const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://marketloop.techinika.com";

export const apiBaseUrl =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8787";
