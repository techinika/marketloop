import { CATEGORIES } from "@/types";
import { craftPlaceholder } from "@/lib/dummyData";

export interface CategoryMeta {
  name: string;
  blurb: string;
  /** Self-contained placeholder image (no upload needed for the browse tiles). */
  image: string;
}

const BLURBS: Record<string, string> = {
  "Agaseke Baskets":
    "Coiled sisal and sweet-grass baskets woven in the classic peace pattern.",
  "Imigongo Art":
    "Raised geometric panels painted with natural earth pigments.",
  "Wood Carving":
    "Hand-carved bowls, nameplates and figures from local hardwood.",
  "Jewelry & Beadwork":
    "Ketange glass-bead necklaces, bracelets and woven adornments.",
  "Textiles & Batik":
    "Wax-resist batik and hand-dyed cotton hangings and wraps.",
  Pottery: "Wheel-thrown and hand-built clay vessels in earth glazes.",
  Paintings: "Canvas and board work by Rwandan painters, old and new.",
  Sculpture: "Carved and modelled three-dimensional pieces.",
  "Other Handmade": "Baskets, toys, furniture and everything else made by hand.",
};

/** Ordered featured categories for the homepage browse grid. */
export const FEATURED_CATEGORIES: CategoryMeta[] = CATEGORIES.map((name) => ({
  name,
  blurb: BLURBS[name] ?? "Handmade pieces from Rwandan artisans.",
  image: craftPlaceholder(name, name),
}));

/** URL slug for a category name (e.g. "Jewelry & Beadwork" -> "jewelry-and-beadwork"). */
export function categoryToSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Resolves a `/c/[category]` slug back to its canonical category name. */
export function slugToCategory(slug: string): string | undefined {
  return CATEGORIES.find((name) => categoryToSlug(name) === slug);
}

/** Category metadata (name, blurb, placeholder image) for a slug, if known. */
export function categoryMetaBySlug(slug: string): CategoryMeta | undefined {
  return FEATURED_CATEGORIES.find((c) => categoryToSlug(c.name) === slug);
}

