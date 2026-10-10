// Seeds a representative Handi marketplace into Firestore via the REST
// client: three artisan profiles plus five sample products (three made to
// order, two ready to ship). Run with: npm run seed
//
// NOTE — IMAGES: products reference the sample craft photos bundled in the
// frontend's `public/` folder (root-relative paths such as `/igiseke.jpeg`),
// which the frontend resolves directly. This keeps the seed self-contained —
// no R2 object or external host. A category without its own bundled photo
// falls back to any bundled photo (never a broken image). Real listings upload
// media to Cloudflare R2 and store the returned object key. The script is
// idempotent: it updates existing docs instead of failing on a second run.
//
// Reads credentials from .dev.vars (or environment variables):
//   FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY

import { readFileSync } from "node:fs";

import { FirestoreClient } from "../src/lib/firestore";
import {
  CATEGORIES,
  collections,
  type CustomizationOption,
  type Currency,
  type Product,
  type ProductType,
  type User,
} from "../src/models";

function loadDevVars(): Record<string, string> {
  try {
    const raw = readFileSync(".dev.vars", "utf8");
    const env: Record<string, string> = {};
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      let value = trimmed.slice(eq + 1).trim();
      if (value.startsWith('"') && value.endsWith('"')) {
        value = value.slice(1, -1);
      }
      env[trimmed.slice(0, eq).trim()] = value;
    }
    return env;
  } catch {
    return {};
  }
}

function keywordsFrom(title: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const word of title.toLowerCase().split(/\s+/)) {
    const clean = word.replace(/[^a-z0-9]/g, "");
    if (clean.length >= 2 && !seen.has(clean)) {
      seen.add(clean);
      out.push(clean);
    }
  }
  return out;
}

/** Warm-palette gradient pairs keyed by craft category (mirrors the frontend). */
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

/** Every bundled craft photo in the frontend's `public/` (see `frontend/public`). */
const ALL_PHOTOS: string[] = [
  "/igiseke.jpeg",
  "/igisabo.jpeg",
  "/igisabo-inkongoro.jpeg",
  "/igisabo-milk.jpeg",
  "/imigongo.jpeg",
  "/uducuma.webp",
];

/** Bundled craft photos in the frontend's `public/`, keyed by category. */
const CATEGORY_IMAGES: Record<string, string[]> = {
  "Agaseke Baskets": ["/igiseke.jpeg", "/igisabo.jpeg", "/igisabo-inkongoro.jpeg"],
  "Imigongo Art": ["/imigongo.jpeg"],
  "Wood Carving": ["/igisabo-inkongoro.jpeg"],
  "Jewelry & Beadwork": ["/uducuma.webp"],
  "Textiles & Batik": ["/igisabo-milk.jpeg"],
};

/** Stable non-negative hash so a category always maps to the same photo. */
function hashString(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** Deterministically picks `count` distinct bundled photos for a seed string. */
function pickPhotos(seed: string, count: number): string[] {
  const pool = ALL_PHOTOS;
  if (pool.length === 0) return [];
  const start = hashString(seed) % pool.length;
  const take = Math.min(count, pool.length);
  return Array.from({ length: take }, (_, i) => pool[(start + i) % pool.length] as string);
}

/**
 * Bundled photos for a category. Categories without their own photo fall back
 * to any uploaded photo (never a placeholder) per product brief.
 */
function imagesForCategory(category: string): string[] {
  const photos = CATEGORY_IMAGES[category];
  if (photos && photos.length > 0) return photos;
  const picked = pickPhotos(category, 2);
  return picked.length > 0 ? picked : [placeholderPhoto(category)];
}

/**
 * Last-resort demo placeholder as a self-contained SVG data URI, used only if
 * no bundled photos exist at all. Real listings upload their media to
 * Cloudflare R2 and store the returned object key instead.
 */
function placeholderPhoto(category: string): string {
  // TODO(demo): replace with a real media key uploaded to R2
  // (products/{id}/...) before launch.
  const [from, to] = CATEGORY_TONES[category] ??
    CATEGORY_TONES["Other Handmade"] ?? ["#b8a48c", "#6b5f57"];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="640" viewBox="0 0 800 640" role="img" aria-label="${category}">
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
  <text x="400" y="600" text-anchor="middle" font-family="Georgia, serif" font-size="26" fill="#fffdfa" fill-opacity="0.92">${category}</text>
</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function choice(id: string, label: string, choices: string[], required = true): CustomizationOption {
  return { id, type: "choice", label, required, priceAdjustment: 0, choices };
}

function assertCategory(category: string): void {
  if (!(CATEGORIES as readonly string[]).includes(category)) {
    throw new Error(`Unknown category: ${category}`);
  }
}

interface SeedListing {
  id: string;
  artisanId: string;
  productType: ProductType;
  title: string;
  description: string;
  category: string;
  tags: string[];
  materials: string[];
  region: string | null;
  priceAmount: number;
  priceCurrency: Currency;
  productionTimeDays: number;
  isCustomizable: boolean;
  customizationOptions: CustomizationOption[];
  allowsReferenceUpload: boolean;
  maxConcurrentOrders: number | null;
  quantityAvailable: number;
  deliveryFee: number;
}

// ---------------------------------------------------------------------------
// Demo listings — prices are illustrative; adjust to real market rates.
// ---------------------------------------------------------------------------
const LISTINGS: SeedListing[] = [
  {
    id: "seed-handi-basket",
    productType: "made_to_order",
    artisanId: "seed-artisan-001",
    title: "Hand-Woven Agaseke Peace Basket",
    description:
      "A traditional Agaseke basket, hand-coiled using sisal and sweet grass in the pattern passed down through generations of Rwandan weavers. Each basket is woven to order — choose your size and color banding, or request a custom pattern.",
    category: "Agaseke Baskets",
    tags: ["traditional", "home decor", "gift", "woven"],
    materials: ["sisal", "sweet grass", "natural dye"],
    region: "Kigali",
    priceAmount: 35000,
    priceCurrency: "RWF",
    productionTimeDays: 7,
    isCustomizable: true,
    customizationOptions: [
      choice("opt-size", "Size", ["Small (15cm)", "Medium (25cm)", "Large (35cm)"]),
      choice("opt-color", "Color pattern", [
        "Classic black & tan",
        "Red & black bands",
        "Multicolor traditional",
        "Custom (describe below)",
      ]),
    ],
    allowsReferenceUpload: true,
    maxConcurrentOrders: 3,
    quantityAvailable: 0,
    deliveryFee: 3000,
  },
  {
    id: "seed-handi-imigongo",
    productType: "made_to_order",
    artisanId: "seed-artisan-002",
    title: "Imigongo Geometric Panel — Spiral Pattern",
    description:
      "Traditional Imigongo art from Eastern Rwanda, made using natural cow dung, sand, and ash, hand-shaped into raised geometric spirals and finished with natural black, white, and ochre pigments. A striking, textured statement piece for any wall.",
    category: "Imigongo Art",
    tags: ["traditional", "wall art", "geometric", "statement piece"],
    materials: ["cow dung", "natural pigment", "wood panel"],
    region: "Nyarubuye, Kirehe",
    priceAmount: 60000,
    priceCurrency: "RWF",
    productionTimeDays: 10,
    isCustomizable: true,
    customizationOptions: [
      choice("opt-size", "Panel size", ["30x30cm", "50x50cm", "70x70cm"]),
      choice("opt-palette", "Color palette", [
        "Classic black & white",
        "Ochre & black",
        "Custom (describe below)",
      ]),
    ],
    allowsReferenceUpload: true,
    maxConcurrentOrders: 2,
    quantityAvailable: 0,
    deliveryFee: 5000,
  },
  {
    id: "seed-handi-nameplate",
    productType: "made_to_order",
    artisanId: "seed-artisan-003",
    title: "Custom Hand-Carved Wooden Nameplate",
    description:
      "A solid hardwood nameplate, hand-carved and finished with natural oil. Perfect for a home entrance, office desk, or as a personalized gift. Every letter is carved by hand — no machine engraving.",
    category: "Wood Carving",
    tags: ["personalized", "gift", "home decor", "engraved"],
    materials: ["mahogany", "natural wood oil"],
    region: "Huye",
    priceAmount: 25000,
    priceCurrency: "RWF",
    productionTimeDays: 5,
    isCustomizable: true,
    customizationOptions: [
      { id: "opt-text", type: "text", label: "Name or text to engrave", required: true, priceAdjustment: 0 },
      choice("opt-finish", "Wood finish", ["Natural light", "Dark walnut stain"]),
    ],
    allowsReferenceUpload: false,
    maxConcurrentOrders: null,
    quantityAvailable: 0,
    deliveryFee: 2500,
  },
  {
    id: "seed-handi-ketange",
    productType: "ready_to_ship",
    artisanId: "seed-artisan-003",
    title: "Vibrant Ketange Beaded Necklace — Multicolor",
    description:
      "A handcrafted multi-strand beaded necklace using traditional Ketange glass beads. Ready to ship — this piece is already made and in stock, no wait required.",
    category: "Jewelry & Beadwork",
    tags: ["jewelry", "colorful", "gift", "ready to wear"],
    materials: ["glass beads", "cotton thread"],
    region: "Kigali",
    priceAmount: 12000,
    priceCurrency: "RWF",
    productionTimeDays: 0,
    isCustomizable: true,
    customizationOptions: [
      choice("opt-colorway", "Color combination", ["As shown", "Red & blue", "Green & gold"], false),
    ],
    allowsReferenceUpload: false,
    maxConcurrentOrders: null,
    quantityAvailable: 8,
    deliveryFee: 1500,
  },
  {
    id: "seed-handi-batik",
    productType: "ready_to_ship",
    artisanId: "seed-artisan-001",
    title: "Hand-Painted Batik Wall Hanging — Market Scene",
    description:
      "A vibrant batik textile piece, hand-dyed and wax-resist painted depicting a Rwandan market scene. Ready-made and in stock — ships within 2-3 days of order.",
    category: "Textiles & Batik",
    tags: ["wall art", "colorful", "textile", "home decor"],
    materials: ["cotton fabric", "natural wax", "fabric dye"],
    region: "Kigali",
    priceAmount: 20000,
    priceCurrency: "RWF",
    productionTimeDays: 0,
    isCustomizable: false,
    customizationOptions: [],
    allowsReferenceUpload: false,
    maxConcurrentOrders: null,
    quantityAvailable: 4,
    deliveryFee: 2000,
  },
];

interface SeedArtisan {
  uid: string;
  name: string;
  email: string;
  storeName: string;
  storeBio: string;
  storeRegion: string;
  specialties: string[];
}

// ---------------------------------------------------------------------------
// Demo artisans — marked verified so storefronts show the badge; real users
// go through the normal verification flow.
// ---------------------------------------------------------------------------
const ARTISANS: SeedArtisan[] = [
  {
    uid: "seed-artisan-001",
    name: "Aline Mukamana",
    email: "nyamirambo.weavers@example.com",
    storeName: "Nyamirambo Weavers",
    storeBio:
      "Third-generation weaver from Kigali, working in sisal and sweet grass. Every basket is coiled by hand in her courtyard studio.",
    storeRegion: "Kigali",
    specialties: ["Agaseke Baskets", "Textiles & Batik"],
  },
  {
    uid: "seed-artisan-002",
    name: "Jean Bosco Uwimana",
    email: "imigongo.studio@example.com",
    storeName: "Eastern Imigongo Studio",
    storeBio:
      "Imigongo artist from Nyarubuye, Kirehe, continuing the region's signature raised-paint geometric tradition with natural pigments.",
    storeRegion: "Nyarubuye, Kirehe",
    specialties: ["Imigongo Art"],
  },
  {
    uid: "seed-artisan-003",
    name: "Clarisse Ingabire",
    email: "huye.woodcraft@example.com",
    storeName: "Huye Woodcraft Studio",
    storeBio:
      "Woodcarver and beadworker in Huye. Her nameplates are carved entirely by hand, and her Ketange necklaces are assembled bead by bead.",
    storeRegion: "Huye",
    specialties: ["Wood Carving", "Jewelry & Beadwork"],
  },
];

async function main(): Promise<void> {
  const vars = { ...loadDevVars(), ...process.env };

  const projectId = vars.FIREBASE_PROJECT_ID;
  const clientEmail = vars.FIREBASE_CLIENT_EMAIL;
  const privateKey = vars.FIREBASE_PRIVATE_KEY;

  if (!projectId || !clientEmail || !privateKey) {
    console.error("Missing Firestore credentials.");
    console.error(
      "Set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY in .dev.vars (see .dev.vars.example) or as environment variables.",
    );
    process.exit(1);
  }

  const db = new FirestoreClient({ projectId, clientEmail, privateKey });
  const now = new Date().toISOString();
  console.log(`Using Firestore project: ${projectId}`);

  console.log("Upserting artisan users ...");
  for (const a of ARTISANS) {
    const existing = await db.getDoc<User>(`${collections.users}/${a.uid}`);
    const user: User = {
      uid: a.uid,
      name: a.name,
      email: a.email,
      photoUrl: null,
      phone: null,
      walletBalance: 0,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      rating: null,
      storeName: a.storeName,
      storeBio: a.storeBio,
      storeRegion: a.storeRegion,
      specialties: a.specialties,
      verificationStatus: "verified", // demo only — real users go through the normal flow
    };
    if (existing) {
      await db.updateDoc<User>(`${collections.users}/${a.uid}`, user);
    } else {
      await db.createDoc<User>(collections.users, a.uid, user);
    }
    console.log(`  ${a.uid} | ${a.storeName} (${a.name})`);
  }

  console.log("Upserting sample products ...");
  for (const listing of LISTINGS) {
    assertCategory(listing.category);
    const productId = listing.id;
    const existing = await db.getDoc<Product>(`${collections.products}/${productId}`);
    const product: Product = {
      artisanId: listing.artisanId,
      title: listing.title,
      description: listing.description,
      category: listing.category,
      titleKeywords: keywordsFrom(listing.title),
      priceAmount: listing.priceAmount,
      priceCurrency: listing.priceCurrency,
      isNegotiable: true,
      isBiddingEnabled: false,
      conditionNote: `Made by hand in ${listing.region ?? "Rwanda"}.`,
      images: imagesForCategory(listing.category),
      videoUrl: null,
      deliveryFee: listing.deliveryFee,
      deliveryFeePayer: "buyer",
      productType: listing.productType,
      tags: listing.tags,
      materials: listing.materials,
      region: listing.region,
      acceptingOrders: listing.productType === "made_to_order",
      maxConcurrentOrders: listing.maxConcurrentOrders,
      currentOpenOrders: 0,
      manuallyPaused: false,
      quantityAvailable: listing.quantityAvailable,
      productionTimeDays: listing.productionTimeDays,
      isCustomizable: listing.isCustomizable,
      customizationOptions: listing.customizationOptions,
      allowsReferenceUpload: listing.allowsReferenceUpload,
      status: "active",
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    if (existing) {
      await db.updateDoc<Product>(`${collections.products}/${productId}`, product);
    } else {
      await db.createDoc<Product>(collections.products, productId, product);
    }
    console.log(`  ${productId} | ${listing.title} | ${listing.priceAmount} ${listing.priceCurrency} [${listing.productType}]`);
  }

  console.log("Querying active products ...");
  const active = await db.queryCollection<Product>(collections.products, {
    filters: [{ field: "status", op: "==", value: "active" }],
    orderBy: { field: "createdAt", direction: "DESCENDING" },
    limit: 20,
  });
  console.log(`  found ${active.length} active product(s):`);
  for (const p of active) {
    console.log(`    - ${p.id} | ${p.title} | ${p.priceAmount} ${p.priceCurrency}`);
  }

  console.log("Seed complete.");
}

main().catch((err) => {
  console.error("Seed failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});