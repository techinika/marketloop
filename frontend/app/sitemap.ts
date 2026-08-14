import type { MetadataRoute } from "next";

import { fetchFeed } from "@/lib/products";
import { siteUrl } from "@/lib/env";

/**
 * Sitemap: home + explore, then the newest active listings.
 *
 * The explore feed is paginated, so only page 1 is enumerated here; deeper
 * listings remain crawlable through the feed itself (internal links).
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const entries: MetadataRoute.Sitemap = [
    { url: siteUrl, changeFrequency: "monthly", priority: 1 },
    { url: `${siteUrl}/explore`, changeFrequency: "daily", priority: 0.8 },
  ];

  try {
    const feed = await fetchFeed({ page: 1, pageSize: 20 });
    for (const product of feed.products) {
      entries.push({
        url: `${siteUrl}/product/${product.id}`,
        lastModified: product.updatedAt,
        changeFrequency: "weekly",
        priority: 0.6,
      });
    }
  } catch {
    // Workers API unreachable (e.g. offline build) — serve the static entries.
  }

  return entries;
}
