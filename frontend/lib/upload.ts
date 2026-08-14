import { apiFetch } from "@/lib/api";

const EXTENSION_TO_CONTENT_TYPE: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  mp4: "video/mp4",
  mov: "video/quicktime",
};

/** Resolves a file to a known content type (falls back to the browser's). */
export function contentTypeForFile(file: File): string {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  return EXTENSION_TO_CONTENT_TYPE[ext] ?? file.type;
}

export interface PresignUpload {
  key: string;
  contentType: string;
  size: number;
  url: string;
  expiresInSeconds: number;
  expiresAt: string;
}

/** Requests presigned PUT URLs for a batch of files. */
export async function presignUploads(
  files: File[],
): Promise<PresignUpload[]> {
  const res = await apiFetch<{ uploads: PresignUpload[] }>("/uploads/presign", {
    method: "POST",
    body: JSON.stringify({
      files: files.map((file) => ({
        name: file.name,
        contentType: contentTypeForFile(file),
        size: file.size,
      })),
    }),
  });
  return res.uploads;
}

/** Uploads a file directly to R2 via its presigned PUT URL. */
export async function uploadToPresignedUrl(
  upload: PresignUpload,
  file: File,
): Promise<void> {
  const res = await fetch(upload.url, {
    method: "PUT",
    headers: { "Content-Type": upload.contentType },
    body: file,
  });
  if (!res.ok) {
    throw new Error(`Upload failed (${res.status})`);
  }
}

const MAX_IMAGE_DIMENSION = 1600;
const IMAGE_QUALITY = 0.85;

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not read image"));
    };
    img.src = url;
  });
}

function supportsWebpEncode(): boolean {
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  return canvas.toDataURL("image/webp").indexOf("data:image/webp") === 0;
}

/**
 * Downsizes and re-encodes an image before upload: the longest side is capped
 * at MAX_IMAGE_DIMENSION and the result is written as WebP (falling back to
 * JPEG where encoding WebP is unsupported). Images that already fit under the
 * cap are returned untouched to avoid lossy round-trips. Returns the original
 * file if the image can't be decoded — callers validate sizes separately.
 */
export async function prepareImageFile(file: File): Promise<File> {
  if (!file.type.startsWith("image/")) return file;

  let img: HTMLImageElement;
  try {
    img = await loadImage(file);
  } catch {
    return file;
  }

  const longestSide = Math.max(img.naturalWidth, img.naturalHeight);
  const scale = Math.min(1, MAX_IMAGE_DIMENSION / longestSide);
  if (scale === 1) return file;

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) return file;
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  const type = supportsWebpEncode() ? "image/webp" : "image/jpeg";
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, type, IMAGE_QUALITY),
  );
  if (!blob) return file;

  const ext = type === "image/webp" ? "webp" : "jpg";
  const base = file.name.replace(/\.[^/.]+$/, "") || "image";
  return new File([blob], `${base}.${ext}`, { type });
}
