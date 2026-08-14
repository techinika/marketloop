// Seeds one sample user and one sample product into Firestore via the REST
// client. Run with: npm run seed
//
// Reads credentials from .dev.vars (or environment variables):
//   FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY

import { readFileSync } from "node:fs";

import { FirestoreClient } from "../src/lib/firestore";
import { collections, type Product, type User } from "../src/models";

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

  const uid = "seed-user-001";
  const user: User = {
    uid,
    name: "Seed Seller",
    email: "seller@example.com",
    photoUrl: null,
    phone: null,
    walletBalance: 0,
    createdAt: now,
    rating: null,
  };

  const productId = "seed-product-001";
  const product: Product = {
    sellerId: uid,
    title: "Sample Second-hand Laptop",
    description: "A gently used laptop for testing the marketplace.",
    category: "Electronics",
    titleKeywords: ["sample", "second", "hand", "laptop"],
    priceAmount: 250000,
    priceCurrency: "RWF",
    isNegotiable: true,
    isBiddingEnabled: false,
    conditionNote: "used 8 months",
    images: ["https://r2.example.dev/seed/product-001/1.jpg"],
    videoUrl: null,
    deliveryFee: 2000,
    deliveryFeePayer: "buyer",
    status: "active",
    createdAt: now,
    updatedAt: now,
  };

  console.log(`Using Firestore project: ${projectId}`);

  console.log("Creating sample user ...");
  const createdUser = await db.createDoc<User>(collections.users, uid, user);
  console.log(`  user: ${createdUser.id} (${createdUser.name}, ${createdUser.email})`);

  console.log("Creating sample product ...");
  const createdProduct = await db.createDoc<Product>(collections.products, productId, product);
  console.log(`  product: ${createdProduct.id} (${createdProduct.title})`);

  console.log("Reading back ...");
  const readUser = await db.getDoc<User>(`${collections.users}/${uid}`);
  const readProduct = await db.getDoc<Product>(`${collections.products}/${productId}`);
  if (!readUser || !readProduct) {
    throw new Error("Read-back failed: documents not found");
  }
  console.log(`  user: email=${readUser.email}, walletBalance=${readUser.walletBalance}`);
  console.log(`  product: ${readProduct.title}, status=${readProduct.status}`);

  console.log("Querying active products ...");
  const active = await db.queryCollection<Product>(collections.products, {
    filters: [{ field: "status", op: "==", value: "active" }],
    orderBy: { field: "createdAt", direction: "DESCENDING" },
    limit: 5,
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
