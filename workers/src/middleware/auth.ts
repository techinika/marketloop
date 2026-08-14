import { createMiddleware } from "hono/factory";

import {
  FirebaseTokenError,
  verifyFirebaseIdToken,
  type AuthUser,
  type TokenVerifyEnv,
} from "../lib/firebase-auth";
import { httpError } from "../lib/http";

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
    return httpError(c, 401, "Missing or invalid Authorization header");
  }

  const token = header.slice("Bearer ".length).trim();
  try {
    const user = await verifyFirebaseIdToken(token, c.env);
    c.set("user", user);
    await next();
  } catch (err) {
    if (err instanceof FirebaseTokenError) {
      return httpError(c, 401, "Unauthorized", { detail: err.message });
    }
    throw err;
  }
});
