import { createMiddleware } from "hono/factory";

import {
  FirebaseTokenError,
  verifyFirebaseIdToken,
  type AuthUser,
} from "../lib/firebase-auth";
import { firestoreFromEnv, type WithId } from "../lib/firestore";
import { httpError } from "../lib/http";
import { collections, type User } from "../models";
import type { Env } from "../types";

export type AdminMiddlewareEnv = {
  Bindings: Env;
  Variables: { user: AuthUser; adminUser: WithId<User> };
};

/**
 * Admin gate: verifies the Firebase ID token (same rules as authMiddleware),
 * then checks that the Firestore user doc has `isAdmin === true`. Non-admins
 * and unknown users get 403. Attaches the full user record as
 * `c.get("adminUser")` for admin handlers.
 */
export const adminAuthMiddleware = createMiddleware<AdminMiddlewareEnv>(async (c, next) => {
  const header = c.req.header("Authorization");
  if (!header?.startsWith("Bearer ")) {
    return httpError(c, 401, "Missing or invalid Authorization header");
  }

  const token = header.slice("Bearer ".length).trim();
  let user: AuthUser;
  try {
    user = await verifyFirebaseIdToken(token, c.env);
  } catch (err) {
    if (err instanceof FirebaseTokenError) {
      return httpError(c, 401, "Unauthorized", { detail: err.message });
    }
    throw err;
  }

  const db = firestoreFromEnv(c.env);
  const profile = await db.getDoc<User>(`${collections.users}/${user.uid}`);
  if (!profile || profile.isAdmin !== true) {
    return httpError(c, 403, "Forbidden: admin access required");
  }

  c.set("user", user);
  c.set("adminUser", profile);
  await next();
});
