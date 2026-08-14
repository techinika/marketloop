import { getIdToken } from "@/lib/firebase";
import { apiBaseUrl } from "@/lib/env";

/**
 * Client-side API layer. `apiFetch` attaches the Firebase ID token.
 *
 * Public endpoints + shared helpers (publicFetch, mediaUrl, formatPrice,
 * ApiError) live in `lib/publicApi.ts` so server components can use them
 * without importing the Firebase client. Re-exported here for convenience.
 */
export {
  ApiError,
  publicFetch,
  mediaUrl,
  formatPrice,
} from "@/lib/publicApi";
import { ApiError, parseErrorMessage } from "@/lib/publicApi";

/**
 * Authenticated fetch against the Workers API.
 * Attaches the Firebase ID token as `Authorization: Bearer <idToken>`.
 */
export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await getIdToken();
  if (!token) {
    throw new ApiError(401, "Not signed in");
  }

  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  headers.set("Content-Type", "application/json");

  const res = await fetch(`${apiBaseUrl}${path}`, { ...init, headers });
  if (!res.ok) {
    const text = await res.text();
    const { message, parsed } = parseErrorMessage(text);
    throw new ApiError(res.status, message, parsed);
  }
  return (await res.json()) as T;
}
