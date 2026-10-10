import type { MetadataRoute } from "next";

import { fetchFeed, fetchArtisans } from "@/lib/products";
import { categoryToSlug, FEATURED_CATEGORIES } from "@/lib/categoryMeta";
import { siteUrl } from "@/lib/env";

/**
 * Sitemap: static pages + category landing pages, then the active listings and
 * artisan storefronts from the API.
 *
 * The explore feed is paginated, so pages are walked until `hasMore` is false,
 * capped at a few thousand URLs to keep the build cheap. Anything deeper stays
 * crawlable through the feed's internal links.
 */
const MAX_PAGES = 50;
const PAGE_SIZE = 100;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const entries: MetadataRoute.Sitemap = [
    { url: siteUrl, changeFrequency: "monthly", priority: 1 },
    { url: `${siteUrl}/explore`, changeFrequency: "daily", priority: 0.8 },
    { url: `${siteUrl}/artisan`, changeFrequency: "weekly", priority: 0.7 },
    { url: `${siteUrl}/about`, changeFrequency: "monthly", priority: 0.4 },
    { url: `${siteUrl}/faq`, changeFrequency: "monthly", priority: 0.4 },
    { url: `${siteUrl}/contact`, changeFrequency: "yearly", priority: 0.3 },
    { url: `${siteUrl}/shipping`, changeFrequency: "yearly", priority: 0.3 },
    { url: `${siteUrl}/terms`, changeFrequency: "yearly", priority: 0.3 },
    { url: `${siteUrl}/privacy`, changeFrequency: "yearly", priority: 0.3 },
    ...FEATURED_CATEGORIES.map((category) => ({
      url: `${siteUrl}/c/${categoryToSlug(category.name)}`,
      changeFrequency: "weekly" as const,
      priority: 0.7,
    })),
  ];

  try {
    const artisans = await fetchArtisans(24);
    for (const artisan of artisans) {
      entries.push({
        url: `${siteUrl}/artisan/${artisan.uid}`,
        changeFrequency: "weekly",
        priority: 0.6,
      });
    }
  } catch {
    // Workers API unreachable (e.g. offline build) — serve the static entries.
  }

  try {
    for (let page = 1; page <= MAX_PAGES; page++) {
      const feed = await fetchFeed({ page, pageSize: PAGE_SIZE });
      for (const product of feed.products) {
        entries.push({
          url: `${siteUrl}/product/${product.id}`,
          lastModified: product.updatedAt,
          changeFrequency: "weekly",
          priority: 0.6,
        });
      }
      if (!feed.hasMore) break;
    }
  } catch {
    // Workers API unreachable (e.g. offline build) — serve the static entries.
  }

  return entries;
}
