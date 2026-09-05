import type { MetadataRoute } from "next";

import { fetchFeed } from "@/lib/products";
import { siteUrl } from "@/lib/env";

/**
 * Sitemap: home + explore, then active listings from the feed.
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
  ];

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
