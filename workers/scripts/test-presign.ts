// Verifies the SigV4 presigner:
//   1. Against AWS's published Signature Version 4 test vector (get-vanilla,
//      the AKIDEXAMPLE / wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY case).
//   2. R2 presigned URL shape, determinism, expiry clamping, content-type
//      header signing.
//
// Run with: npm run test:presign

import { presignUrl, signV4, type SignV4Params } from "../src/lib/r2-presign";

const VECTOR_ACCESS_KEY = "AKIDEXAMPLE";
const VECTOR_SECRET_KEY = "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY";
const VECTOR_SIGNATURE = "5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31";
const NOW = new Date("2015-08-30T12:36:00Z");

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

async function main(): Promise<void> {
  // 1. AWS SigV4 test vector.
  const vector: SignV4Params = {
    accessKeyId: VECTOR_ACCESS_KEY,
    secretAccessKey: VECTOR_SECRET_KEY,
    region: "us-east-1",
    service: "service",
    method: "GET",
    path: "/",
    query: {},
    headers: {
      host: "example.amazonaws.com",
      "x-amz-date": "20150830T123600Z",
    },
    signedHeaders: ["host", "x-amz-date"],
    payloadHash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    amzDate: "20150830T123600Z",
    dateStamp: "20150830",
  };
  const signature = await signV4(vector);
  assert(
    signature === VECTOR_SIGNATURE,
    `AWS test vector signature mismatch: got ${signature}, expected ${VECTOR_SIGNATURE}`,
  );

  // 2. R2 presigned PUT URL shape + determinism.
  const creds = {
    accountId: "test-account",
    accessKeyId: VECTOR_ACCESS_KEY,
    secretAccessKey: VECTOR_SECRET_KEY,
  };
  const opts = {
    method: "PUT" as const,
    bucket: "marketloop-images",
    key: "products/abc-123/photo.jpg",
    contentType: "image/jpeg",
    expiresInSeconds: 600,
    now: NOW,
  };
  const put = await presignUrl(creds, opts);
  assert(put.method === "PUT", "expected PUT method");
  assert(put.expiresInSeconds === 600, `expected 600s, got ${put.expiresInSeconds}`);
  assert(put.expiresAt === "2015-08-30T12:46:00.000Z", `expiresAt wrong: ${put.expiresAt}`);

  const url = new URL(put.url);
  assert(url.host === "test-account.r2.cloudflarestorage.com", `host wrong: ${url.host}`);
  assert(url.pathname === "/marketloop-images/products/abc-123/photo.jpg", `path wrong: ${url.pathname}`);
  assert(url.searchParams.get("X-Amz-Algorithm") === "AWS4-HMAC-SHA256", "algorithm missing");
  assert(
    url.searchParams.get("X-Amz-Credential") === "AKIDEXAMPLE/20150830/auto/s3/aws4_request",
    `credential wrong: ${url.searchParams.get("X-Amz-Credential")}`,
  );
  assert(url.searchParams.get("X-Amz-Date") === "20150830T123600Z", "date missing");
  assert(url.searchParams.get("X-Amz-Expires") === "600", "expires missing");
  assert(
    url.searchParams.get("X-Amz-SignedHeaders") === "content-type;host",
    `signed headers wrong: ${url.searchParams.get("X-Amz-SignedHeaders")}`,
  );
  const sig = url.searchParams.get("X-Amz-Signature") ?? "";
  assert(/^[0-9a-f]{64}$/.test(sig), "signature is not 64 hex chars");

  const again = await presignUrl(creds, opts);
  assert(again.url === put.url, "presigned URL must be deterministic for identical inputs");

  // 3. Expiry clamping (S3 max 7 days, min 1 second).
  const maxed = await presignUrl(creds, {
    method: "GET",
    bucket: "b",
    key: "k",
    expiresInSeconds: 999_999,
    now: NOW,
  });
  assert(maxed.expiresInSeconds === 604_800, `expected clamp to 604800, got ${maxed.expiresInSeconds}`);

  const floored = await presignUrl(creds, {
    method: "GET",
    bucket: "b",
    key: "k",
    expiresInSeconds: 0,
    now: NOW,
  });
  assert(floored.expiresInSeconds === 1, `expected clamp to 1, got ${floored.expiresInSeconds}`);

  // 4. Default lifetime is 15 minutes when unset.
  const defaulted = await presignUrl(creds, { method: "GET", bucket: "b", key: "k", now: NOW });
  assert(defaulted.expiresInSeconds === 900, `expected default 900, got ${defaulted.expiresInSeconds}`);
  assert(defaulted.expiresAt === "2015-08-30T12:51:00.000Z", "default expiresAt wrong");

  console.log(
    "PRESIGN TESTS PASSED (AWS SigV4 test vector, R2 presigned URL shape, determinism, expiry clamping)",
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
