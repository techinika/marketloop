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
