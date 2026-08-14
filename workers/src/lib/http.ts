// Single, consistent error-response helper for every route.
//
// Every error response across the API uses the wire shape `{ error: string }`
// so the frontend `ApiError` parser (`frontend/lib/api.ts`) can rely on one
// format. Status codes carry the machine-readable classification; the message
// is human-readable and shown to users as-is.
//
// (Deliberately NOT `{ error: { code, message } }`: the flat string shape has
// been stable since Prompt 2, the frontend already parses it, and the status
// code already encodes the "code" dimension.)

import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

/**
 * Returns `{ error: message }` with the given status code.
 *
 * `extra` merges additional fields into the body (e.g. `resendInSeconds` on a
 * 429). The wire shape stays flat `{ error: string }` plus optional extras.
 */
export function httpError(
  c: Context,
  status: number,
  message: string,
  extra?: Record<string, unknown>,
): Response {
  return c.json({ error: message, ...extra }, status as ContentfulStatusCode);
}
