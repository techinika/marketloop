// Firebase ID token verification for the Workers runtime.
//
// The Admin SDK cannot run on Workers, so this verifies Firebase ID tokens
// manually: it fetches Google's public JWKS, then validates the RS256
// signature, issuer, audience and expiry using the Web Crypto API.

const DEFAULT_JWKS_URL =
  "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";

const JWKS_TTL_MS = 3_600_000;

const encoder = new TextEncoder();

export interface AuthUser {
  uid: string;
  email: string | null;
  name: string | null;
  picture: string | null;
}

export interface TokenVerifyEnv {
  FIREBASE_PROJECT_ID: string;
  FIREBASE_JWKS_URL?: string;
}

interface JwtHeader {
  alg: string;
  kid?: string;
  typ?: string;
}

interface FirebaseClaims {
  aud: string;
  iss: string;
  exp: number;
  iat: number;
  auth_time: number;
  sub: string;
  email?: string;
  name?: string;
  picture?: string;
}

export class FirebaseTokenError extends Error {}

/** Structural RSA public key shape (avoids relying on DOM JsonWebKey naming
 * differences between the Workers and Node type environments). */
interface RsaPublicJwk {
  kid?: string;
  alg?: string;
  use?: string;
  kty?: string;
  n?: string;
  e?: string;
}

let jwksCache: { keys: RsaPublicJwk[]; fetchedAt: number } | null = null;

function base64UrlToBytes(input: string): Uint8Array {
  const base64 = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function fetchJwks(jwksUrl: string): Promise<RsaPublicJwk[]> {
  if (jwksCache && Date.now() - jwksCache.fetchedAt < JWKS_TTL_MS) {
    return jwksCache.keys;
  }
  const res = await fetch(jwksUrl);
  if (!res.ok) {
    throw new FirebaseTokenError(`Failed to fetch JWKS: ${res.status}`);
  }
  const data = (await res.json()) as { keys: RsaPublicJwk[] };
  jwksCache = { keys: data.keys, fetchedAt: Date.now() };
  return data.keys;
}

/**
 * Verifies a Firebase ID token and returns the decoded user info.
 * Throws `FirebaseTokenError` on any verification failure.
 */
export async function verifyFirebaseIdToken(
  token: string,
  env: TokenVerifyEnv,
): Promise<AuthUser> {
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new FirebaseTokenError("Malformed token");
  }
  const [headerB64, payloadB64, signatureB64] = parts as [string, string, string];

  let header: JwtHeader;
  let payload: Partial<FirebaseClaims>;
  try {
    header = JSON.parse(new TextDecoder().decode(base64UrlToBytes(headerB64))) as JwtHeader;
    payload = JSON.parse(new TextDecoder().decode(base64UrlToBytes(payloadB64))) as Partial<FirebaseClaims>;
  } catch {
    throw new FirebaseTokenError("Invalid token encoding");
  }

  if (header.alg !== "RS256") {
    throw new FirebaseTokenError("Unexpected algorithm");
  }

  const projectId = env.FIREBASE_PROJECT_ID;
  if (payload.aud !== projectId) {
    throw new FirebaseTokenError("Invalid audience");
  }
  if (payload.iss !== `https://securetoken.google.com/${projectId}`) {
    throw new FirebaseTokenError("Invalid issuer");
  }
  if (!payload.sub) {
    throw new FirebaseTokenError("Missing subject");
  }

  const now = Math.floor(Date.now() / 1000);
  if (!payload.exp || payload.exp < now) {
    throw new FirebaseTokenError("Token expired");
  }
  if (payload.iat && payload.iat > now + 60) {
    throw new FirebaseTokenError("Token issued in the future");
  }

  const keys = await fetchJwks(env.FIREBASE_JWKS_URL ?? DEFAULT_JWKS_URL);
  const jwk = keys.find((k) => k.kid === header.kid) ?? keys[0];
  if (!jwk) {
    throw new FirebaseTokenError("No signing key found");
  }

  const cryptoKey = await crypto.subtle.importKey(
    "jwk",
    jwk as Extract<Parameters<typeof crypto.subtle.importKey>[1], { kty?: string }>,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  ).catch(() => {
    throw new FirebaseTokenError("Invalid signing key");
  });

  const valid = await crypto.subtle.verify(
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    cryptoKey,
    base64UrlToBytes(signatureB64),
    encoder.encode(`${headerB64}.${payloadB64}`),
  );
  if (!valid) {
    throw new FirebaseTokenError("Invalid signature");
  }

  return {
    uid: payload.sub,
    email: payload.email ?? null,
    name: payload.name ?? null,
    picture: payload.picture ?? null,
  };
}
