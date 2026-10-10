import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ProductCard } from "@/components/ExploreFeed";
import { JsonLd } from "@/components/JsonLd";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { HandiDivider } from "@/components/HandiPattern";
import { EmptyState } from "@/components/ui/EmptyState";
import { categoryMetaBySlug, categoryToSlug, FEATURED_CATEGORIES } from "@/lib/categoryMeta";
import { dummyProductsByCategory } from "@/lib/dummyData";
import { fetchFeed } from "@/lib/products";
import type { Product } from "@/types";

// Listings change over time — refresh the prerender rather than freezing it.
export const revalidate = 300;

export function generateStaticParams() {
  return FEATURED_CATEGORIES.map((category) => ({
    category: categoryToSlug(category.name),
  }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ category: string }>;
}): Promise<Metadata> {
  const { category: slug } = await params;
  const meta = categoryMetaBySlug(slug);
  if (!meta) return { title: "Category not found", robots: { index: false } };

  const title = `${meta.name} — handmade in Rwanda`;
  const description = `${meta.blurb} Discover handmade ${meta.name.toLowerCase()} from verified Rwandan artisans on Handi.`;
  return {
    title,
    description,
    alternates: { canonical: `/c/${slug}` },
    openGraph: {
      title,
      description,
      url: `/c/${slug}`,
      images: [{ url: meta.image, alt: meta.name }],
    },
    twitter: { card: "summary_large_image", title, description, images: [meta.image] },
  };
}

export default async function CategoryPage({
  params,
}: {
  params: Promise<{ category: string }>;
}) {
  const { category: slug } = await params;
  const meta = categoryMetaBySlug(slug);
  if (!meta) notFound();

  let products: Product[] = [];
  try {
    const feed = await fetchFeed({ category: meta.name, sortBy: "newest", page: 1, pageSize: 24 });
    products = feed.products;
  } catch {
    // API unreachable at request time — fall through to the demo fallback.
  }
  if (products.length === 0) products = dummyProductsByCategory(meta.name);

  const schema: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: `${meta.name} — handmade in Rwanda`,
    description: meta.blurb,
    url: `/c/${slug}`,
  };

  return (
    <div className="flex-1">
      <JsonLd data={schema} />

      <section className="border-b border-border bg-surface">
        <div className="container-page py-10 sm:py-14">
          <Breadcrumbs
            items={[
              { name: "Home", path: "/" },
              { name: "Discover", path: "/explore" },
              { name: meta.name, path: `/c/${slug}` },
            ]}
          />

          <div className="mt-6 flex flex-col gap-6 sm:flex-row sm:items-center">
            <span className="relative hidden size-24 shrink-0 overflow-hidden rounded-2xl border border-border sm:block">
              <Image src={meta.image} alt="" fill sizes="96px" className="object-cover" />
            </span>
            <div>
              <h1 className="heading text-3xl text-foreground sm:text-4xl">{meta.name}</h1>
              <p className="mt-3 max-w-2xl text-base leading-7 text-secondary">{meta.blurb}</p>
            </div>
          </div>
        </div>
      </section>

      <section className="container-page py-10 sm:py-14">
        <div className="flex items-end justify-between gap-4">
          <h2 className="heading text-2xl text-foreground sm:text-3xl">
            {meta.name} on Handi
          </h2>
          <Link
            href={`/explore?category=${encodeURIComponent(meta.name)}`}
            className="btn btn-secondary"
          >
            Filter & sort
          </Link>
        </div>

        <HandiDivider className="mt-4 max-w-6xl" />

        {products.length === 0 ? (
          <div className="mt-8">
            <EmptyState
              icon="package"
              title="Nothing here just yet"
              description={`No ${meta.name.toLowerCase()} listings are live right now — be the first to share a piece.`}
            >
              <Link href="/sell/new" className="btn btn-secondary">
                Sell your craft
              </Link>
            </EmptyState>
          </div>
        ) : (
          <div className="mt-8 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {products.map((product) => (
              <ProductCard key={product.id} product={product} />
            ))}
          </div>
        )}

        <div className="mt-12 flex flex-wrap gap-2">
          {FEATURED_CATEGORIES.filter((c) => c.name !== meta.name).map((c) => (
            <Link
              key={c.name}
              href={`/c/${categoryToSlug(c.name)}`}
              className="badge badge-neutral transition-colors hover:bg-surface-muted"
            >
              {c.name}
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
