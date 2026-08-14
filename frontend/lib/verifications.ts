import { apiFetch } from "@/lib/api";
import { contentTypeForFile, uploadToPresignedUrl } from "@/lib/upload";
import type { IdDocumentType, VerificationState } from "@/types";

export const ID_DOCUMENT_TYPES: IdDocumentType[] = [
  "national_id",
  "passport",
  "drivers_license",
];

export const ID_DOCUMENT_LABELS: Record<IdDocumentType, string> = {
  national_id: "National ID",
  passport: "Passport",
  drivers_license: "Driver's license",
};

export const ID_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
export const MAX_ID_IMAGE_BYTES = 5 * 1024 * 1024;

/** GET /verifications/me — the caller's phone + ID verification state. */
export async function fetchVerificationState(): Promise<VerificationState> {
  return apiFetch<VerificationState>("/verifications/me");
}

/** POST /verifications/phone/request — sends an SMS OTP to the given phone. */
export async function requestPhoneOtp(phone: string): Promise<{ resendInSeconds: number }> {
  return apiFetch<{ resendInSeconds: number }>("/verifications/phone/request", {
    method: "POST",
    body: JSON.stringify({ phone }),
  });
}

/** POST /verifications/phone/confirm — checks the code and verifies the phone. */
export async function confirmPhoneOtp(
  phone: string,
  code: string,
): Promise<{ message: string; phoneVerifiedAt: string }> {
  return apiFetch<{ message: string; phoneVerifiedAt: string }>("/verifications/phone/confirm", {
    method: "POST",
    body: JSON.stringify({ phone, code }),
  });
}

/**
 * Uploads an ID document: asks the backend for a presigned PUT, uploads the
 * file straight to R2, then submits the key for review. Returns the new state.
 */
export async function submitIdDocument(
  file: File,
  documentType: IdDocumentType,
): Promise<{ verificationStatus: VerificationState["verificationStatus"] }> {
  const contentType = contentTypeForFile(file);
  const res = await apiFetch<{
    key: string;
    contentType: string;
    size: number;
    url: string;
  }>("/verifications/id/presign", {
    method: "POST",
    body: JSON.stringify({ contentType, size: file.size }),
  });

  await uploadToPresignedUrl(
    { ...res, expiresInSeconds: 0, expiresAt: "" },
    file,
  );

  return apiFetch<{ verificationStatus: VerificationState["verificationStatus"] }>(
    "/verifications/id/request",
    {
      method: "POST",
      body: JSON.stringify({ documentType, key: res.key }),
    },
  );
}

/** POST /verifications/me/id/sign-url — signed GET for the user's own ID doc. */
export async function signIdDocumentUrl(): Promise<{ url: string }> {
  return apiFetch<{ url: string }>("/verifications/me/id/sign-url", {
    method: "POST",
    body: JSON.stringify({}),
  });
}
