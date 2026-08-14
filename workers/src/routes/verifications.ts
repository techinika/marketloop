import { Hono } from "hono";

import { firestoreFromEnv } from "../lib/firestore";
import { httpError } from "../lib/http";
import { presignUrl } from "../lib/r2-presign";
import { sendSms } from "../lib/sms";
import { authMiddleware } from "../middleware/auth";
import { collections, type IdDocumentType, type User } from "../models";
import type { AppEnv } from "../types";

export const verificationRoutes = new Hono<AppEnv>();

const OTP_LENGTH = 6;
const OTP_TTL_SECONDS = 10 * 60;
const OTP_RESEND_SECONDS = 60;
const OTP_MAX_ATTEMPTS = 5;

const ID_IMAGE_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};
const MAX_ID_IMAGE_BYTES = 5 * 1024 * 1024;
const PRESIGN_TTL_SECONDS = 15 * 60;

const ID_DOCUMENT_TYPES: IdDocumentType[] = ["national_id", "passport", "drivers_license"];

const PHONE_RE = /^\+[1-9]\d{6,14}$/;

interface OtpRecord {
  code: string;
  phone: string;
  expiresAt: number;
  attempts: number;
  lastSentAt: number;
}

function generateOtp(): string {
  const bytes = new Uint8Array(OTP_LENGTH);
  crypto.getRandomValues(bytes);
  let code = "";
  for (const byte of bytes) code += String(byte % 10);
  return code;
}

function otpKey(uid: string): string {
  return `otp:${uid}`;
}

function asPhone(value: unknown): string {
  if (typeof value !== "string" || !PHONE_RE.test(value.trim())) {
    throw new Error("phone must be a valid E.164 number, e.g. +250788123456");
  }
  return value.trim();
}

function asCode(value: unknown): string {
  if (typeof value !== "string" || !/^\d{6}$/.test(value.trim())) {
    throw new Error("code must be a 6-digit code");
  }
  return value.trim();
}

function asIdDocumentType(value: unknown): IdDocumentType {
  if (typeof value !== "string" || !(ID_DOCUMENT_TYPES as readonly string[]).includes(value)) {
    throw new Error("documentType must be national_id, passport or drivers_license");
  }
  return value as IdDocumentType;
}

function asImageUpload(value: unknown): { contentType: string; ext: string; size: number } {
  if (typeof value !== "object" || value === null) throw new Error("invalid body");
  const body = value as Record<string, unknown>;
  const contentType = body.contentType;
  const ext = typeof contentType === "string" ? ID_IMAGE_TYPES[contentType] : undefined;
  if (!ext || typeof contentType !== "string") {
    throw new Error(`Unsupported content type: ${String(contentType)}`);
  }
  const size = body.size;
  if (typeof size !== "number" || !Number.isFinite(size) || size <= 0 || size > MAX_ID_IMAGE_BYTES) {
    throw new Error(`File too large (max ${Math.round(MAX_ID_IMAGE_BYTES / 1024 / 1024)}MB)`);
  }
  return { contentType, ext, size };
}

/**
 * POST /verifications/phone/request
 * Sends a 6-digit OTP by SMS to the given phone number. Rate-limited to one
 * message per 60s per user; the code lives in KV for 10 minutes.
 */
verificationRoutes.post("/phone/request", authMiddleware, async (c) => {
  const user = c.get("user");
  const kv = c.env.OTP_KV;

  let phone: string;
  try {
    const body = await c.req.json().catch(() => ({}));
    phone = asPhone((body as Record<string, unknown>).phone);
  } catch (err) {
    return httpError(c, 400, err instanceof Error ? err.message : "Invalid body");
  }

  const now = Date.now();
  const existing = await kv.get<OtpRecord>(otpKey(user.uid), "json");
  if (existing && now < existing.lastSentAt + OTP_RESEND_SECONDS * 1000) {
    const resendInSeconds = Math.ceil(
      (existing.lastSentAt + OTP_RESEND_SECONDS * 1000 - now) / 1000,
    );
    return httpError(c, 429, "A code was just sent", { resendInSeconds });
  }

  const record: OtpRecord = {
    code: generateOtp(),
    phone,
    expiresAt: now + OTP_TTL_SECONDS * 1000,
    attempts: 0,
    lastSentAt: now,
  };
  await kv.put(otpKey(user.uid), JSON.stringify(record), {
    expirationTtl: OTP_TTL_SECONDS,
  });

  await sendSms({
    to: phone,
    text: `Your Marketloop verification code is ${record.code}. It expires in 10 minutes.`,
  });

  return c.json({ message: "Verification code sent", resendInSeconds: OTP_RESEND_SECONDS });
});

/**
 * POST /verifications/phone/confirm
 * Checks the OTP (max 5 tries) and, on success, marks the user's phone as
 * verified on their profile. The code is single-use and removed from KV.
 */
verificationRoutes.post("/phone/confirm", authMiddleware, async (c) => {
  const user = c.get("user");
  const kv = c.env.OTP_KV;

  let phone: string;
  let code: string;
  try {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    phone = asPhone(body.phone);
    code = asCode(body.code);
  } catch (err) {
    return httpError(c, 400, err instanceof Error ? err.message : "Invalid body");
  }

  const record = await kv.get<OtpRecord>(otpKey(user.uid), "json");
  if (!record || record.phone !== phone || Date.now() > record.expiresAt) {
    return httpError(c, 400, "Code expired — request a new one");
  }

  const attempts = record.attempts + 1;
  if (attempts > OTP_MAX_ATTEMPTS) {
    await kv.delete(otpKey(user.uid));
    return httpError(c, 400, "Too many attempts — request a new code");
  }

  if (record.code !== code) {
    await kv.put(otpKey(user.uid), JSON.stringify({ ...record, attempts }), {
      expirationTtl: Math.max(1, Math.ceil((record.expiresAt - Date.now()) / 1000)),
    });
    const attemptsLeft = OTP_MAX_ATTEMPTS - attempts;
    return httpError(c, 400, `Incorrect code — ${attemptsLeft} ${attemptsLeft === 1 ? "attempt" : "attempts"} left`, {
      attemptsLeft,
    });
  }

  await kv.delete(otpKey(user.uid));

  const db = firestoreFromEnv(c.env);
  const now = new Date().toISOString();
  const updated = await db.updateDoc<User>(`${collections.users}/${user.uid}`, {
    phone,
    phoneVerifiedAt: now,
    updatedAt: now,
  });

  return c.json({
    message: "Phone number verified",
    phoneVerifiedAt: updated.phoneVerifiedAt,
  });
});

/**
 * POST /verifications/id/presign
 * Presigned PUT for an ID-document image, stored under `id-documents/{uid}/`
 * (not served by the public /media route — admin review uses signed URLs).
 */
verificationRoutes.post("/id/presign", authMiddleware, async (c) => {
  const user = c.get("user");
  const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME } = c.env;
  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET_NAME) {
    return httpError(c, 503, "R2 uploads are not configured");
  }

  let upload: { contentType: string; ext: string; size: number };
  try {
    const body = await c.req.json().catch(() => ({}));
    upload = asImageUpload(body);
  } catch (err) {
    return httpError(c, 400, err instanceof Error ? err.message : "Invalid body");
  }

  const key = `id-documents/${user.uid}/${crypto.randomUUID()}.${upload.ext}`;
  const presigned = await presignUrl(
    {
      accountId: R2_ACCOUNT_ID,
      accessKeyId: R2_ACCESS_KEY_ID,
      secretAccessKey: R2_SECRET_ACCESS_KEY,
    },
    {
      method: "PUT",
      bucket: R2_BUCKET_NAME,
      key,
      contentType: upload.contentType,
      expiresInSeconds: PRESIGN_TTL_SECONDS,
    },
  );

  return c.json({
    key,
    contentType: upload.contentType,
    size: upload.size,
    url: presigned.url,
    expiresInSeconds: presigned.expiresInSeconds,
    expiresAt: presigned.expiresAt,
  });
});

/**
 * POST /verifications/id/request
 * Submits an uploaded ID document for admin review. The uploaded key must live
 * under the caller's own `id-documents/{uid}/` prefix.
 */
verificationRoutes.post("/id/request", authMiddleware, async (c) => {
  const user = c.get("user");
  const db = firestoreFromEnv(c.env);

  let documentType: IdDocumentType;
  let key: string;
  try {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    documentType = asIdDocumentType(body.documentType);
    key = typeof body.key === "string" ? body.key : "";
  } catch (err) {
    return httpError(c, 400, err instanceof Error ? err.message : "Invalid body");
  }
  if (!key.startsWith(`id-documents/${user.uid}/`)) {
    return httpError(c, 400, "document key must be under your own id-documents folder");
  }

  const profile = await db.getDoc<User>(`${collections.users}/${user.uid}`);
  if (profile?.verificationStatus === "pending") {
    return httpError(c, 409, "Your submission is already under review");
  }
  if (profile?.verificationStatus === "verified") {
    return httpError(c, 409, "You are already verified");
  }

  const now = new Date().toISOString();
  const updated = await db.updateDoc<User>(`${collections.users}/${user.uid}`, {
    idDocumentType: documentType,
    idDocumentKey: key,
    verificationStatus: "pending",
    verificationSubmittedAt: now,
    verificationNote: null,
    updatedAt: now,
  });

  return c.json({
    verificationStatus: updated.verificationStatus,
    verificationSubmittedAt: updated.verificationSubmittedAt,
  });
});

/** GET /verifications/me — the caller's verification state. */
verificationRoutes.get("/me", authMiddleware, async (c) => {
  const user = c.get("user");
  const db = firestoreFromEnv(c.env);
  const profile = await db.getDoc<User>(`${collections.users}/${user.uid}`);
  return c.json({
    phoneVerifiedAt: profile?.phoneVerifiedAt ?? null,
    verificationStatus: profile?.verificationStatus ?? "unverified",
    idDocumentType: profile?.idDocumentType ?? null,
    verificationSubmittedAt: profile?.verificationSubmittedAt ?? null,
    verificationNote: profile?.verificationNote ?? null,
  });
});

/** POST /verifications/me/id/sign-url — signed GET for the user's own ID doc. */
verificationRoutes.post("/me/id/sign-url", authMiddleware, async (c) => {
  const user = c.get("user");
  const db = firestoreFromEnv(c.env);
  const profile = await db.getDoc<User>(`${collections.users}/${user.uid}`);
  const key = profile?.idDocumentKey;
  if (!key) return httpError(c, 404, "No ID document uploaded");

  const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME } = c.env;
  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET_NAME) {
    return httpError(c, 503, "R2 is not configured");
  }

  const presigned = await presignUrl(
    {
      accountId: R2_ACCOUNT_ID,
      accessKeyId: R2_ACCESS_KEY_ID,
      secretAccessKey: R2_SECRET_ACCESS_KEY,
    },
    { method: "GET", bucket: R2_BUCKET_NAME, key, expiresInSeconds: PRESIGN_TTL_SECONDS },
  );
  return c.json({
    url: presigned.url,
    expiresInSeconds: presigned.expiresInSeconds,
    expiresAt: presigned.expiresAt,
  });
});
