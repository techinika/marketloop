import type { Metadata } from "next";

import { ProductDetail } from "@/components/ProductDetail";
import { formatPrice, mediaUrl } from "@/lib/publicApi";
import { fetchBidSummary, fetchProduct } from "@/lib/products";
import { stripHtml } from "@/lib/html";
import type { BidSummary, ProductDetail as ProductDetailData } from "@/types";

type ProductInitial = {
  productDetail: ProductDetailData;
  bidSummary: BidSummary | null;
};

/** JSON-LD Product schema for search-result rich snippets. */
function productSchema(data: ProductDetailData): Record<string, unknown> {
  const { product, seller } = data;
  const priceCurrency = product.priceCurrency;
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
      availability:
        product.status === "active"
          ? "https://schema.org/InStock"
          : "https://schema.org/OutOfStock",
      url: `/product/${product.id}`,
    },
    seller: {
      "@type": "Person",
      name: seller.name,
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
    return {
      title,
      description,
      alternates: { canonical: `/product/${id}` },
      openGraph: {
        title,
        description,
        type: "website",
        url: `/product/${id}`,
        images: product.images[0] ? [{ url: mediaUrl(product.images[0]) }] : undefined,
      },
      other: {
        "product:category": product.category,
        "product:price:amount": String(product.priceAmount),
        "product:price:currency": product.priceCurrency,
      },
    };
  } catch {
    // Unknown / removed listing: keep it out of the index.
    return { title: "Product not found — MarketLoop", robots: { index: false } };
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
      <ProductDetail initial={initial} />
    </>
  );
}
