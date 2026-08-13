import { Hono } from "hono";

import { presignUrl } from "../lib/r2-presign";
import { authMiddleware } from "../middleware/auth";
import type { AppEnv } from "../types";

export const uploadRoutes = new Hono<AppEnv>();

const IMAGE_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};
const VIDEO_TYPES: Record<string, string> = {
  "video/mp4": "mp4",
  "video/quicktime": "mov",
};

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_VIDEO_BYTES = 50 * 1024 * 1024;
const MAX_IMAGES = 6;
const MAX_VIDEOS = 1;
const PRESIGN_TTL_SECONDS = 15 * 60;

interface PresignFileInput {
  name?: string;
  contentType: string;
  size: number;
}

interface PresignFileResult {
  key: string;
  contentType: string;
  size: number;
  url: string;
  expiresInSeconds: number;
  expiresAt: string;
}

uploadRoutes.use("/presign", authMiddleware);

/**
 * POST /uploads/presign
 * Returns presigned PUT URLs so the client can upload files directly to R2.
 * Each file is validated (allowed mime type, max size, per-category limits)
 * and the declared Content-Type is signed into the URL, forcing the uploader
 * to send exactly what they declared.
 */
uploadRoutes.post("/presign", async (c) => {
  const user = c.get("user");
  const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME } = c.env;
  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET_NAME) {
    return c.json({ error: "R2 uploads are not configured" }, 503);
  }

  let body: { files?: PresignFileInput[] };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const files = body.files;
  if (!Array.isArray(files) || files.length === 0) {
    return c.json({ error: "files must be a non-empty array" }, 400);
  }
  if (files.length > MAX_IMAGES + MAX_VIDEOS) {
    return c.json({ error: `too many files (max ${MAX_IMAGES + MAX_VIDEOS})` }, 400);
  }

  const uploads: PresignFileResult[] = [];
  let imageCount = 0;
  let videoCount = 0;

  for (const file of files) {
    const imageExt = IMAGE_TYPES[file.contentType];
    const videoExt = VIDEO_TYPES[file.contentType];
    const kind = imageExt ? "image" : videoExt ? "video" : null;
    if (!kind) {
      return c.json(
        { error: `Unsupported content type: ${file.contentType}` },
        400,
      );
    }

    if (kind === "image") imageCount += 1;
    else videoCount += 1;
    if (imageCount > MAX_IMAGES || videoCount > MAX_VIDEOS) {
      return c.json(
        { error: `max ${MAX_IMAGES} images and ${MAX_VIDEOS} video allowed` },
        400,
      );
    }

    if (!Number.isFinite(file.size) || file.size <= 0) {
      return c.json({ error: "Invalid file size" }, 400);
    }
    const maxBytes = kind === "image" ? MAX_IMAGE_BYTES : MAX_VIDEO_BYTES;
    if (file.size > maxBytes) {
      return c.json(
        { error: `File too large (max ${Math.round(maxBytes / 1024 / 1024)}MB)` },
        400,
      );
    }

    const uuid = crypto.randomUUID();
    const key = `uploads/${user.uid}/${uuid}.${imageExt ?? videoExt}`;
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
        contentType: file.contentType,
        expiresInSeconds: PRESIGN_TTL_SECONDS,
      },
    );

    uploads.push({
      key,
      contentType: file.contentType,
      size: file.size,
      url: presigned.url,
      expiresInSeconds: presigned.expiresInSeconds,
      expiresAt: presigned.expiresAt,
    });
  }

  return c.json({ uploads });
});
