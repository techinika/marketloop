// Verifies the Firebase ID-token verification chain end-to-end without a real
// Firebase project: it generates an RSA key, serves it as a local JWKS
// endpoint, mints RS256 JWTs with Firebase-shaped claims, then runs them
// through the real verify + Hono middleware + /me route code.
//
// Run with: npm run test:auth

import { createServer } from "node:http";

import { Hono } from "hono";

import { verifyFirebaseIdToken, type AuthUser } from "../src/lib/firebase-auth";
import { authMiddleware } from "../src/middleware/auth";

const PROJECT_ID = "marketloop-rw";
const JWKS_PORT = 8798;
const JWKS_URL = `http://127.0.0.1:${JWKS_PORT}/jwks`;
const KID = "test-kid-1";

const encoder = new TextEncoder();

function base64UrlEncode(input: string | Uint8Array): string {
  const bytes = typeof input === "string" ? encoder.encode(input) : input;
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

type TestKey = Parameters<typeof crypto.subtle.sign>[1];

async function mintToken(
  payload: Record<string, unknown>,
  key: TestKey,
): Promise<string> {
  const header = { alg: "RS256", kid: KID, typ: "JWT" };
  const unsigned = `${base64UrlEncode(JSON.stringify(header))}.${base64UrlEncode(
    JSON.stringify(payload),
  )}`;
  const signature = await crypto.subtle.sign(
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    key,
    encoder.encode(unsigned),
  );
  return `${unsigned}.${base64UrlEncode(new Uint8Array(signature))}`;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

const env = { FIREBASE_PROJECT_ID: PROJECT_ID, FIREBASE_JWKS_URL: JWKS_URL };

async function main(): Promise<void> {
  const { publicKey, privateKey } = (await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  )) as { publicKey: TestKey; privateKey: TestKey };

  const publicJwk = await crypto.subtle.exportKey("jwk", publicKey);
  const jwks = { keys: [{ ...publicJwk, kid: KID, alg: "RS256", use: "sig" }] };

  const server = createServer((req, res) => {
    if (req.url?.startsWith("/jwks")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(jwks));
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise<void>((resolve) => server.listen(JWKS_PORT, "127.0.0.1", resolve));

  try {
    const now = Math.floor(Date.now() / 1000);
    const claims = {
      aud: PROJECT_ID,
      iss: `https://securetoken.google.com/${PROJECT_ID}`,
      sub: "test-uid-123",
      name: "Test User",
      email: "test@example.com",
      picture: "https://example.com/p.png",
      auth_time: now - 60,
      iat: now - 60,
      exp: now + 3600,
    };

    const token = await mintToken(claims, privateKey);

    // 1. Direct verification.
    const user = await verifyFirebaseIdToken(token, env);
    assert(user.uid === "test-uid-123", "uid mismatch");
    assert(user.email === "test@example.com", "email mismatch");
    assert(user.name === "Test User", "name mismatch");
    assert(user.picture === "https://example.com/p.png", "picture mismatch");

    // 2. Through the Hono middleware + route.
    const testApp = new Hono<{ Bindings: typeof env; Variables: { user: AuthUser } }>();
    testApp.use("/me", authMiddleware);
    testApp.get("/me", (c) => c.json({ user: c.get("user") }));

    const okRes = await testApp.request("/me", { headers: { Authorization: `Bearer ${token}` } }, env);
    assert(okRes.status === 200, `expected 200, got ${okRes.status}`);
    const okBody = (await okRes.json()) as { user: AuthUser };
    assert(okBody.user.uid === "test-uid-123", "route did not attach user");

    // 3. Missing / malformed Authorization header.
    const noAuth = await testApp.request("/me", {}, env);
    assert(noAuth.status === 401, `expected 401 for missing token, got ${noAuth.status}`);

    // 4. Expired token.
    const expired = await mintToken({ ...claims, exp: now - 60 }, privateKey);
    const expiredRes = await testApp.request("/me", { headers: { Authorization: `Bearer ${expired}` } }, env);
    assert(expiredRes.status === 401, `expected 401 for expired token, got ${expiredRes.status}`);

    // 5. Wrong audience.
    const wrongAud = await mintToken({ ...claims, aud: "some-other-project" }, privateKey);
    const wrongAudRes = await testApp.request("/me", { headers: { Authorization: `Bearer ${wrongAud}` } }, env);
    assert(wrongAudRes.status === 401, `expected 401 for wrong audience, got ${wrongAudRes.status}`);

    // 6. Wrong issuer.
    const wrongIss = await mintToken({ ...claims, iss: "https://securetoken.google.com/evil" }, privateKey);
    const wrongIssRes = await testApp.request("/me", { headers: { Authorization: `Bearer ${wrongIss}` } }, env);
    assert(wrongIssRes.status === 401, `expected 401 for wrong issuer, got ${wrongIssRes.status}`);

    // 7. Tampered signature.
    const tampered = `${token.slice(0, -1)}${token.endsWith("a") ? "b" : "a"}`;
    const tamperedRes = await testApp.request("/me", { headers: { Authorization: `Bearer ${tampered}` } }, env);
    assert(tamperedRes.status === 401, `expected 401 for tampered token, got ${tamperedRes.status}`);

    console.log("AUTH TESTS PASSED (signature, issuer, audience, expiry, middleware, /me route)");
  } finally {
    server.close();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
