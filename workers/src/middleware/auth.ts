import { createMiddleware } from "hono/factory";

import {
  FirebaseTokenError,
  verifyFirebaseIdToken,
  type AuthUser,
  type TokenVerifyEnv,
} from "../lib/firebase-auth";
import {
  firestoreFromEnv,
  type FirestoreEnv,
  type FirestoreClient,
} from "../lib/firestore";
import { httpError } from "../lib/http";
import { collections, type User } from "../models";

export type AuthMiddlewareEnv = {
  Bindings: TokenVerifyEnv & Partial<FirestoreEnv>;
  Variables: { user: AuthUser };
};

/**
 * Hono middleware that verifies the `Authorization: Bearer <idToken>` header
 * and attaches the decoded user to the request context as `c.get("user")`.
 *
 * On the user's first authenticated request it lazily creates their
 * `users/{uid}` profile doc from the token claims — nothing else in the app
 * writes user docs for new signups, so without this public product pages
 * would show the seller as "Unknown". The sync is best-effort: a Firestore
 * failure never fails the request.
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

    if (c.env.FIREBASE_PRIVATE_KEY) {
      const db = firestoreFromEnv(c.env as FirestoreEnv);
      await ensureUserProfile(db, user);
    }

    await next();
  } catch (err) {
    if (err instanceof FirebaseTokenError) {
      return httpError(c, 401, "Unauthorized", { detail: err.message });
    }
    throw err;
  }
});

/**
 * Best-effort sync of the Firebase Auth profile into the `users/{uid}` doc.
 * Only creates the doc when it is missing; never overwrites an existing one.
 */
export async function ensureUserProfile(
  db: FirestoreClient,
  user: AuthUser,
): Promise<void> {
  try {
    const profile = await db.getDoc<User>(`${collections.users}/${user.uid}`);
    if (profile) return;
    const now = new Date().toISOString();
    await db.createDoc<User>(collections.users, user.uid, {
      uid: user.uid,
      name: user.name ?? "User",
      email: user.email ?? "",
      photoUrl: user.picture ?? null,
      phone: null,
      walletBalance: 0,
      createdAt: now,
      updatedAt: now,
      rating: null,
    });
  } catch (err) {
    console.warn(`ensureUserProfile: skipping profile sync for ${user.uid}:`, err);
  }
}
