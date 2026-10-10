import type { Metadata } from "next";
import { Suspense } from "react";

import { ProductDetail } from "@/components/ProductDetail";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { ProductDetailSkeleton } from "@/components/ui/Skeleton";
import { formatPrice, mediaUrl } from "@/lib/publicApi";
import { categoryToSlug } from "@/lib/categoryMeta";
import { fetchBidSummary, fetchProduct } from "@/lib/products";
import { stripHtml } from "@/lib/html";
import type { BidSummary, ProductDetail as ProductDetailData } from "@/types";

type ProductInitial = {
  productDetail: ProductDetailData;
  bidSummary: BidSummary | null;
};

/** JSON-LD Product schema for search-result rich snippets. */
function productSchema(data: ProductDetailData): Record<string, unknown> {
  const { product, artisan } = data;
  const priceCurrency = product.priceCurrency;
  const soldOut =
    product.status !== "active" ||
    (product.productType === "ready_to_ship" && (product.quantityAvailable ?? 0) <= 0);
  return {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.title,
    description: stripHtml(product.description),
    image: product.images.map((key) => mediaUrl(key)),
    category: product.category,
    sku: product.id,
    offers: {
      "@type": "Offer",
      price: product.priceAmount,
      priceCurrency,
      availability: soldOut
        ? "https://schema.org/OutOfStock"
        : "https://schema.org/InStock",
      url: `/product/${product.id}`,
    },
    artisan: {
      "@type": "Person",
      name: artisan.name,
    },
  };
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  try {
    const { product } = await fetchProduct(id);
    const title = `${product.title} — ${formatPrice(product.priceAmount, product.priceCurrency)}`;
    const description = stripHtml(product.description).slice(0, 160);
    const image = product.images[0] ? mediaUrl(product.images[0]) : "/opengraph-image";
    return {
      title,
      description,
      alternates: { canonical: `/product/${id}` },
      openGraph: {
        title,
        description,
        url: `/product/${id}`,
        images: [
          { url: image, width: image === "/opengraph-image" ? 1200 : undefined, height: image === "/opengraph-image" ? 630 : undefined, alt: product.title },
        ],
      },
      twitter: {
        card: "summary_large_image",
        title,
        description,
        images: [image],
      },
      other: {
        "product:category": product.category,
        "product:price:amount": String(product.priceAmount),
        "product:price:currency": product.priceCurrency,
      },
    };
  } catch {
    // Unknown / removed listing: keep it out of the index.
    return { title: "Product not found", robots: { index: false } };
  }
}

export default async function ProductPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  let initial: ProductInitial | null = null;
  try {
    const productDetail = await fetchProduct(id);
    const bidSummary = productDetail.product.isBiddingEnabled
      ? await fetchBidSummary(id)
      : null;
    initial = { productDetail, bidSummary };
  } catch {
    initial = null;
  }

  return (
    <>
      {initial && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(productSchema(initial.productDetail)) }}
        />
      )}
      {initial && (
        <div className="container-page pt-6">
          <Breadcrumbs
            items={[
              { name: "Home", path: "/" },
              { name: "Discover", path: "/explore" },
              {
                name: initial.productDetail.product.category,
                path: `/c/${categoryToSlug(initial.productDetail.product.category)}`,
              },
              { name: initial.productDetail.product.title, path: `/product/${id}` },
            ]}
          />
        </div>
      )}
      <Suspense fallback={<ProductDetailSkeleton />}>
        <ProductDetail initial={initial} />
      </Suspense>
    </>
  );
}
