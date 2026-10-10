// Demo fallback data — used ONLY when the database returns nothing (empty
// collection or the API is unreachable at render time). Real data always wins.
//
// Photos live in `public/` and are referenced by root-relative path (e.g.
// `/igiseke.jpeg`), which `mediaUrl()` passes through untouched. Categories
// without a photo fall back to a self-contained SVG `data:` placeholder so the
// demo never shows a broken image. Real listings upload media to Cloudflare R2
// (see /uploads/presign + GET /media/*) and store the returned object key.

import type { ArtisanStorefront, Currency, Product } from "@/types";

/** Bundled craft photos in `public/`, keyed by category (see `public/`). */
const CATEGORY_IMAGES: Record<string, string[]> = {
  "Agaseke Baskets": ["/igiseke.jpeg", "/igisabo.jpeg", "/igisabo-inkongoro.jpeg"],
  "Imigongo Art": ["/imigongo.jpeg"],
  "Wood Carving": ["/igisabo-inkongoro.jpeg"],
  "Jewelry & Beadwork": ["/uducuma.webp"],
  "Textiles & Batik": ["/igisabo-milk.jpeg"],
};

/** Warm-palette gradient pairs keyed by craft category. */
const CATEGORY_TONES: Record<string, [string, string]> = {
  "Agaseke Baskets": ["#e8c79b", "#b8862b"],
  "Imigongo Art": ["#2b2320", "#6b5f57"],
  "Wood Carving": ["#c9a06a", "#7a4a24"],
  "Jewelry & Beadwork": ["#d98c6a", "#c1622d"],
  "Textiles & Batik": ["#7f9a67", "#4f6039"],
  Pottery: ["#c98f6b", "#8a5638"],
  Paintings: ["#c1622d", "#a5511f"],
  Sculpture: ["#857a6c", "#4a423b"],
  "Other Handmade": ["#b8a48c", "#6b5f57"],
};

/**
 * A small, self-contained SVG placeholder for a craft piece: warm gradient,
 * the abstract Handi motif, and the piece/category label.
 */
export function craftPlaceholder(category: string, label: string): string {
  const [from, to] = CATEGORY_TONES[category] ??
    CATEGORY_TONES["Other Handmade"] ?? ["#b8a48c", "#6b5f57"];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="640" viewBox="0 0 800 640" role="img" aria-label="${label}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${from}"/>
      <stop offset="1" stop-color="${to}"/>
    </linearGradient>
    <pattern id="m" width="64" height="64" patternUnits="userSpaceOnUse">
      <g fill="none" stroke="#fffdfa" stroke-opacity="0.14" stroke-width="1">
        <path d="M0 8h64M0 40h64"/>
        <path d="M8 0v64M40 0v64"/>
        <path d="M20 32a12 12 0 1 1 12-12 12 12 0 0 1-12 12 8 8 0 1 1 8-8"/>
      </g>
    </pattern>
  </defs>
  <rect width="800" height="640" fill="url(#g)"/>
  <rect width="800" height="640" fill="url(#m)"/>
  <text x="400" y="600" text-anchor="middle" font-family="Georgia, serif" font-size="26" fill="#fffdfa" fill-opacity="0.92">${label}</text>
</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/** Bundled photos for a category, or a single SVG placeholder when none exist. */
function imagesForCategory(category: string, label: string): string[] {
  const photos = CATEGORY_IMAGES[category];
  return photos && photos.length > 0 ? photos : [craftPlaceholder(category, label)];
}

const now = new Date("2026-01-01T00:00:00.000Z").toISOString();

interface ProductSeed {
  id: string;
  artisanId: string;
  title: string;
  short: string;
  category: string;
  price: number;
  currency: Currency;
  productType: "made_to_order" | "ready_to_ship";
  quantityAvailable?: number;
  tags: string[];
  materials: string[];
  region: string;
  productionTimeDays: number;
  isCustomizable: boolean;
}

const PRODUCT_SEEDS: ProductSeed[] = [
  {
    id: "demo-agaseke-basket",
    artisanId: "demo-artisan-aline",
    title: "Hand-Woven Agaseke Peace Basket",
    short: "Traditional coiled sisal & sweet-grass basket in the classic peace pattern.",
    category: "Agaseke Baskets",
    price: 35000,
    currency: "RWF",
    productType: "made_to_order",
    tags: ["traditional", "home decor", "gift", "woven"],
    materials: ["sisal", "sweet grass", "natural dye"],
    region: "Kigali",
    productionTimeDays: 7,
    isCustomizable: true,
  },
  {
    id: "demo-imigongo-panel",
    artisanId: "demo-artisan-jean",
    title: "Imigongo Geometric Panel — Spiral Pattern",
    short: "Raised geometric art from Eastern Rwanda, painted with natural pigments.",
    category: "Imigongo Art",
    price: 60000,
    currency: "RWF",
    productType: "made_to_order",
    tags: ["traditional", "wall art", "geometric"],
    materials: ["cow dung", "natural pigment", "wood panel"],
    region: "Nyarubuye, Kirehe",
    productionTimeDays: 10,
    isCustomizable: true,
  },
  {
    id: "demo-wooden-nameplate",
    artisanId: "demo-artisan-clarisse",
    title: "Custom Hand-Carved Wooden Nameplate",
    short: "A solid hardwood nameplate, carved entirely by hand and oiled to finish.",
    category: "Wood Carving",
    price: 25000,
    currency: "RWF",
    productType: "made_to_order",
    tags: ["personalized", "gift", "engraved"],
    materials: ["mahogany", "natural wood oil"],
    region: "Huye",
    productionTimeDays: 5,
    isCustomizable: true,
  },
  {
    id: "demo-ketange-necklace",
    artisanId: "demo-artisan-clarisse",
    title: "Vibrant Ketange Beaded Necklace — Multicolor",
    short: "A multi-strand necklace assembled bead by bead from traditional Ketange glass.",
    category: "Jewelry & Beadwork",
    price: 12000,
    currency: "RWF",
    productType: "ready_to_ship",
    quantityAvailable: 8,
    tags: ["jewelry", "colorful", "gift"],
    materials: ["glass beads", "cotton thread"],
    region: "Kigali",
    productionTimeDays: 0,
    isCustomizable: false,
  },
  {
    id: "demo-batik-hanging",
    artisanId: "demo-artisan-aline",
    title: "Hand-Painted Batik Wall Hanging — Market Scene",
    short: "Wax-resist batik depicting a lively Rwandan market, ready to hang.",
    category: "Textiles & Batik",
    price: 20000,
    currency: "RWF",
    productType: "ready_to_ship",
    quantityAvailable: 4,
    tags: ["wall art", "colorful", "textile"],
    materials: ["cotton fabric", "natural wax", "fabric dye"],
    region: "Kigali",
    productionTimeDays: 0,
    isCustomizable: false,
  },
  {
    id: "demo-pottery-vase",
    artisanId: "demo-artisan-jean",
    title: "Hand-Thrown Clay Vase — Earth Glaze",
    short: "A wheel-thrown stoneware vase finished in a warm earth glaze.",
    category: "Pottery",
    price: 18000,
    currency: "RWF",
    productType: "ready_to_ship",
    quantityAvailable: 6,
    tags: ["pottery", "home decor", "vase"],
    materials: ["local clay", "earth glaze"],
    region: "Musanze",
    productionTimeDays: 0,
    isCustomizable: false,
  },
];

function toProduct(seed: ProductSeed, index: number): Product {
  return {
    id: seed.id,
    artisanId: seed.artisanId,
    title: seed.title,
    description: `<p>${seed.short}</p>`,
    category: seed.category,
    titleKeywords: Array.from(
      new Set(seed.title.toLowerCase().split(/\s+/).map((w) => w.replace(/[^a-z0-9]/g, ""))),
    ).filter((w) => w.length >= 2),
    priceAmount: seed.price,
    priceCurrency: seed.currency,
    isNegotiable: true,
    isBiddingEnabled: false,
    conditionNote: `Made by hand in ${seed.region}.`,
    images: imagesForCategory(seed.category, seed.title),
    videoUrl: null,
    deliveryFee: 2500,
    deliveryFeePayer: "buyer",
    productType: seed.productType,
    tags: seed.tags,
    materials: seed.materials,
    region: seed.region,
    acceptingOrders: seed.productType === "made_to_order",
    maxConcurrentOrders: seed.productType === "made_to_order" ? 3 : null,
    currentOpenOrders: 0,
    manuallyPaused: false,
    quantityAvailable: seed.quantityAvailable ?? 0,
    productionTimeDays: seed.productionTimeDays,
    isCustomizable: seed.isCustomizable,
    customizationOptions: [],
    allowsReferenceUpload: false,
    status: "active",
    reservedBy: null,
    reservedUntil: null,
    createdAt: new Date(Date.parse(now) - index * 86_400_000).toISOString(),
    updatedAt: now,
  };
}

export const DUMMY_PRODUCTS: Product[] = PRODUCT_SEEDS.map(toProduct);

export const DUMMY_ARTISANS: ArtisanStorefront[] = [
  {
    uid: "demo-artisan-aline",
    name: "Aline Mukamana",
    photoUrl: null,
    storeName: "Nyamirambo Weavers",
    storeBio:
      "Third-generation weaver from Kigali, working in sisal and sweet grass. Every basket is coiled by hand in her courtyard studio.",
    storeRegion: "Kigali",
    specialties: ["Agaseke Baskets", "Textiles & Batik"],
    avgRating: 4.9,
    ratingCount: 42,
    isVerifiedSeller: true,
    joinedAt: "2025-03-14T09:00:00.000Z",
  },
  {
    uid: "demo-artisan-jean",
    name: "Jean Bosco Uwimana",
    photoUrl: null,
    storeName: "Eastern Imigongo Studio",
    storeBio:
      "Imigongo artist from Nyarubuye, Kirehe, continuing the region's signature raised-paint geometric tradition with natural pigments.",
    storeRegion: "Nyarubuye, Kirehe",
    specialties: ["Imigongo Art", "Pottery"],
    avgRating: 4.8,
    ratingCount: 27,
    isVerifiedSeller: true,
    joinedAt: "2025-05-02T09:00:00.000Z",
  },
  {
    uid: "demo-artisan-clarisse",
    name: "Clarisse Ingabire",
    photoUrl: null,
    storeName: "Huye Woodcraft Studio",
    storeBio:
      "Woodcarver and beadworker in Huye. Her nameplates are carved entirely by hand, and her Ketange necklaces are assembled bead by bead.",
    storeRegion: "Huye",
    specialties: ["Wood Carving", "Jewelry & Beadwork"],
    avgRating: 5.0,
    ratingCount: 19,
    isVerifiedSeller: true,
    joinedAt: "2025-06-21T09:00:00.000Z",
  },
];

const ARTISAN_BY_ID = new Map(DUMMY_ARTISANS.map((a) => [a.uid, a]));

/** Returns the demo storefront for a uid, or null when it isn't a demo artisan. */
export function dummyArtisan(uid: string): ArtisanStorefront | null {
  return ARTISAN_BY_ID.get(uid) ?? null;
}

/** Demo listings for a storefront uid (empty when not a demo artisan). */
export function dummyProductsByArtisan(uid: string): Product[] {
  return DUMMY_PRODUCTS.filter((p) => p.artisanId === uid);
}

/** Demo listings in a given category (empty when the category has no demo pieces). */
export function dummyProductsByCategory(category: string): Product[] {
  return DUMMY_PRODUCTS.filter((p) => p.category === category);
}

/** `real` when it has data, otherwise the demo fallback. */
export function withDummyProducts<T>(real: T[] | null | undefined, dummy: T[]): T[] {
  return real && real.length > 0 ? real : dummy;
}
