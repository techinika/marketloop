// R2 presigned URL generation via AWS Signature Version 4.
//
// The AWS SDK cannot run on Workers, so this implements the SigV4 presigning
// algorithm directly with the Web Crypto API (HMAC-SHA256). Targets the R2
// S3-compatible endpoint:
//   https://{accountId}.r2.cloudflarestorage.com/{bucket}/{key}
//
// Signed headers default to `host` only (plus `content-type` when provided),
// so uploads must send exactly the declared Content-Type — which lets us
// enforce the allowed mime types at the R2 boundary.

const encoder = new TextEncoder();

export interface R2S3Credentials {
  /** Cloudflare account ID. */
  accountId: string;
  /** R2 API token access key ID. */
  accessKeyId: string;
  /** R2 API token secret access key. */
  secretAccessKey: string;
}

export interface PresignOptions {
  method: "GET" | "PUT";
  bucket: string;
  key: string;
  /** Declared Content-Type, included in the signed headers when set. */
  contentType?: string;
  /** URL lifetime in seconds (default 900; S3 max is 604800 = 7 days). */
  expiresInSeconds?: number;
  /** Clock override (used in tests). */
  now?: Date;
}

export interface PresignedUrl {
  url: string;
  method: "GET" | "PUT";
  expiresInSeconds: number;
  /** ISO timestamp when the URL expires. */
  expiresAt: string;
}

const DEFAULT_REGION = "auto";
const SERVICE = "s3";
const MAX_EXPIRES_SECONDS = 7 * 24 * 60 * 60;
const DEFAULT_EXPIRES_SECONDS = 15 * 60;

export interface SignV4Params {
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  service: string;
  method: string;
  /** URI path, already percent-encoded, without the query string. */
  path: string;
  /** Raw query parameters (sorted + encoded when canonicalized). */
  query: Record<string, string>;
  /** Headers to include in the canonical request (lowercase keys). */
  headers: Record<string, string>;
  /** Ordered list of header names that are signed. */
  signedHeaders: string[];
  /** Hex-encoded SHA-256 of the payload (or "UNSIGNED-PAYLOAD"). */
  payloadHash: string;
  /** Timestamp in 20150830T123600Z format. */
  amzDate: string;
  /** Date stamp in 20150830 format. */
  dateStamp: string;
}

async function hmac(key: Uint8Array | string, message: string): Promise<Uint8Array> {
  const keyBytes = typeof key === "string" ? encoder.encode(key) : key;
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(message));
  return new Uint8Array(signature);
}

function toHex(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) out += byte.toString(16).padStart(2, "0");
  return out;
}

async function sha256Hex(input: string): Promise<string> {
  return toHex(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(input))));
}

/** RFC 3986 URI component encoding (encodeURIComponent plus the `!'()*` set). */
export function uriEncode(input: string, encodeSlash = true): string {
  let out = encodeURIComponent(input);
  if (!encodeSlash) out = out.replace(/%2F/gi, "/");
  return out.replace(/[!'()*]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`);
}

async function canonicalRequest(p: SignV4Params): Promise<string> {
  const canonicalQuery = Object.keys(p.query)
    .sort()
    .map((key) => `${uriEncode(key)}=${uriEncode(p.query[key]!)}`)
    .join("&");

  const signedHeaderNames = p.signedHeaders.map((h) => h.toLowerCase()).sort();
  const canonicalHeaders = signedHeaderNames
    .map((name) => `${name}:${p.headers[name]!.trim().replace(/\s+/g, " ")}`)
    .join("\n");

  return [
    p.method.toUpperCase(),
    p.path,
    canonicalQuery,
    `${canonicalHeaders}\n`,
    signedHeaderNames.join(";"),
    p.payloadHash,
  ].join("\n");
}

async function stringToSign(p: SignV4Params, canonical: string): Promise<string> {
  const scope = `${p.dateStamp}/${p.region}/${p.service}/aws4_request`;
  const canonicalHash = await sha256Hex(canonical);
  return ["AWS4-HMAC-SHA256", p.amzDate, scope, canonicalHash].join("\n");
}

async function signingKey(
  secretAccessKey: string,
  dateStamp: string,
  region: string,
  service: string,
): Promise<Uint8Array> {
  const kDate = await hmac(`AWS4${secretAccessKey}`, dateStamp);
  const kRegion = await hmac(kDate, region);
  const kService = await hmac(kRegion, service);
  return hmac(kService, "aws4_request");
}

/** Computes the SigV4 signature for a request. */
export async function signV4(p: SignV4Params): Promise<string> {
  const canonical = await canonicalRequest(p);
  const sts = await stringToSign(p, canonical);
  const key = await signingKey(p.secretAccessKey, p.dateStamp, p.region, p.service);
  return toHex(await hmac(key, sts));
}

/**
 * Generates a presigned GET or PUT URL for an object in an R2 bucket.
 * Uses the `UNSIGNED-PAYLOAD` convention for presigned URLs (no body hash
 * required from the uploader).
 */
export async function presignUrl(
  creds: R2S3Credentials,
  opts: PresignOptions,
): Promise<PresignedUrl> {
  const now = opts.now ?? new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const expiresInSeconds = Math.min(
    Math.max(1, Math.floor(opts.expiresInSeconds ?? DEFAULT_EXPIRES_SECONDS)),
    MAX_EXPIRES_SECONDS,
  );

  const host = `${creds.accountId}.r2.cloudflarestorage.com`;
  const path = `/${opts.bucket}/${opts.key
    .split("/")
    .map((segment) => uriEncode(segment))
    .join("/")}`;

  const headers: Record<string, string> = { host };
  if (opts.contentType) headers["content-type"] = opts.contentType;
  const signedHeaders = Object.keys(headers).sort();

  const query: Record<string, string> = {
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${creds.accessKeyId}/${dateStamp}/${DEFAULT_REGION}/s3/aws4_request`,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": String(expiresInSeconds),
    "X-Amz-SignedHeaders": signedHeaders.join(";"),
  };

  const signature = await signV4({
    accessKeyId: creds.accessKeyId,
    secretAccessKey: creds.secretAccessKey,
    region: DEFAULT_REGION,
    service: SERVICE,
    method: opts.method,
    path,
    query,
    headers,
    signedHeaders,
    payloadHash: "UNSIGNED-PAYLOAD",
    amzDate,
    dateStamp,
  });

  const canonicalQuery = Object.keys(query)
    .sort()
    .map((key) => `${uriEncode(key)}=${uriEncode(query[key]!)}`)
    .join("&");

  return {
    url: `https://${host}${path}?${canonicalQuery}&X-Amz-Signature=${signature}`,
    method: opts.method,
    expiresInSeconds,
    expiresAt: new Date(now.getTime() + expiresInSeconds * 1000).toISOString(),
  };
}
