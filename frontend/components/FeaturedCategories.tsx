import Image from "next/image";
import Link from "next/link";

import { FEATURED_CATEGORIES, categoryToSlug } from "@/lib/categoryMeta";

/** Homepage browse-by-craft grid; links straight into a filtered explore feed. */
export function FeaturedCategories({ limit = 6 }: { limit?: number }) {
  const categories = FEATURED_CATEGORIES.slice(0, limit);
  if (categories.length === 0) return null;

  return (
    <section id="categories" className="container-page py-14 sm:py-16">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <span className="badge badge-neutral">Browse by craft</span>
          <h2 className="heading mt-4 text-3xl text-foreground sm:text-4xl">
            Find your kind of handmade
          </h2>
          <p className="mt-3 max-w-xl text-base leading-7 text-secondary">
            From woven Agaseke baskets to Imigongo panels and hand-carved wood —
            explore by the craft that speaks to you.
          </p>
        </div>
        <Link href="/explore" className="btn btn-secondary">
          All categories
        </Link>
      </div>

      <div className="mt-10 grid grid-cols-2 gap-4 sm:grid-cols-3">
        {categories.map((category) => (
          <Link
            key={category.name}
            href={`/c/${categoryToSlug(category.name)}`}
            className="card-interactive group relative flex min-h-40 flex-col justify-end overflow-hidden p-5"
          >
            <Image
              src={category.image}
              alt=""
              fill
              sizes="(max-width: 640px) 50vw, 33vw"
              className="object-cover opacity-90 transition-transform duration-300 group-hover:scale-105"
            />
            <span className="absolute inset-0 bg-gradient-to-t from-black/55 via-black/10 to-transparent" />
            <span className="relative">
              <span className="heading block text-lg text-white">{category.name}</span>
              <span className="mt-1 line-clamp-2 block text-xs leading-5 text-white/85">
                {category.blurb}
              </span>
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}
