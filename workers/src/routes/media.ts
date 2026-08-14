import { Hono } from "hono";

import { httpError } from "../lib/http";
import type { AppEnv } from "../types";

export const mediaRoutes = new Hono<AppEnv>();

/**
 * GET /media/*key
 * Serves an R2 object by key (used to display product images/videos without
 * needing a public bucket or a custom domain). Keys are uuid-based, so this
 * is public-by-design: any key in the bucket is retrievable.
 */
mediaRoutes.get("/:key{.*}", async (c) => {
  const key = c.req.param("key");
  if (!key) return httpError(c, 400, "Missing key");

  const object = await c.env.IMAGES.get(key);
  if (!object) return httpError(c, 404, "Not found");

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("Cache-Control", "public, max-age=31536000, immutable");

  return new Response(object.body, { headers });
});
