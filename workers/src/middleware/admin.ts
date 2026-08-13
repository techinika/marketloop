import { createMiddleware } from "hono/factory";

import {
  FirebaseTokenError,
  verifyFirebaseIdToken,
  type AuthUser,
} from "../lib/firebase-auth";
import { firestoreFromEnv, type WithId } from "../lib/firestore";
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
    return c.json({ error: "Missing or invalid Authorization header" }, 401);
  }

  const token = header.slice("Bearer ".length).trim();
  let user: AuthUser;
  try {
    user = await verifyFirebaseIdToken(token, c.env);
  } catch (err) {
    if (err instanceof FirebaseTokenError) {
      return c.json({ error: "Unauthorized", detail: err.message }, 401);
    }
    throw err;
  }

  const db = firestoreFromEnv(c.env);
  const profile = await db.getDoc<User>(`${collections.users}/${user.uid}`);
  if (!profile || profile.isAdmin !== true) {
    return c.json({ error: "Forbidden: admin access required" }, 403);
  }

  c.set("user", user);
  c.set("adminUser", profile);
  await next();
});
