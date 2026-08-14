import type { MetadataRoute } from "next";

import { siteUrl } from "@/lib/env";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/explore", "/product/"],
        disallow: [
          "/admin",
          "/account",
          "/checkout",
          "/orders",
          "/wallet",
          "/dashboard",
          "/my-bids",
          "/sell",
        ],
      },
    ],
    sitemap: `${siteUrl}/sitemap.xml`,
  };
}
