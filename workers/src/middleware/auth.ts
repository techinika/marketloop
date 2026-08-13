import { createMiddleware } from "hono/factory";

import {
  FirebaseTokenError,
  verifyFirebaseIdToken,
  type AuthUser,
  type TokenVerifyEnv,
} from "../lib/firebase-auth";

export type AuthMiddlewareEnv = {
  Bindings: TokenVerifyEnv;
  Variables: { user: AuthUser };
};

/**
 * Hono middleware that verifies the `Authorization: Bearer <idToken>` header
 * and attaches the decoded user to the request context as `c.get("user")`.
 */
export const authMiddleware = createMiddleware<AuthMiddlewareEnv>(async (c, next) => {
  const header = c.req.header("Authorization");
  if (!header?.startsWith("Bearer ")) {
    return c.json({ error: "Missing or invalid Authorization header" }, 401);
  }

  const token = header.slice("Bearer ".length).trim();
  try {
    const user = await verifyFirebaseIdToken(token, c.env);
    c.set("user", user);
    await next();
  } catch (err) {
    if (err instanceof FirebaseTokenError) {
      return c.json({ error: "Unauthorized", detail: err.message }, 401);
    }
    throw err;
  }
});
