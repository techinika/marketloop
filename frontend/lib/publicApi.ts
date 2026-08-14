import { apiBaseUrl } from "@/lib/env";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    /** Parsed error body (JSON object, or the raw text when it isn't JSON). */
    public readonly body: unknown = null,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** Parses a non-OK API response body into a human-readable message. */
export function parseErrorMessage(body: string): { message: string; parsed: unknown } {
  try {
    const parsed: unknown = JSON.parse(body);
    if (parsed && typeof parsed === "object") {
      const { error } = parsed as { error?: unknown };
      if (typeof error === "string" && error.length > 0) {
        return { message: error, parsed };
      }
    }
    return { message: body, parsed };
  } catch {
    return { message: body, parsed: body };
  }
}

/**
 * Public (unauthenticated) fetch against the Workers API.
 *
 * Lives in its own module (not `lib/api.ts`) so server components, sitemaps
 * and metadata functions can call it WITHOUT pulling the Firebase client into
 * the server bundle. `lib/api.ts` re-exports this for client components.
 */
export async function publicFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${apiBaseUrl}${path}`, init);
  if (!res.ok) {
    const text = await res.text();
    const { message, parsed } = parseErrorMessage(text);
    throw new ApiError(res.status, message, parsed);
  }
  return (await res.json()) as T;
}

/** Worker-relative media URL for an R2 object key (see GET /media/*). */
export function mediaUrl(key: string): string {
  return `${apiBaseUrl}/media/${key}`;
}

/** Formats a price per currency, e.g. "RWF 45,000" or "$120". */
export function formatPrice(amount: number, currency: string): string {
  if (currency === "USD") {
    return `$${amount.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
  }
  return `RWF ${Math.round(amount).toLocaleString("en-US")}`;
}
