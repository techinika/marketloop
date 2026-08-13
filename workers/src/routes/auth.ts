import { Hono } from "hono";

import { firestoreFromEnv } from "../lib/firestore";
import { authMiddleware } from "../middleware/auth";
import { collections, type User } from "../models";
import type { AppEnv } from "../types";

export const authRoutes = new Hono<AppEnv>();

authRoutes.get("/", (c) =>
  c.json({ module: "auth", message: "Auth endpoints coming soon" }),
);

authRoutes.use("/me", authMiddleware);
authRoutes.get("/me", async (c) => {
  const user = c.get("user");
  const db = firestoreFromEnv(c.env);
  const profile = await db.getDoc<User>(`${collections.users}/${user.uid}`);
  return c.json({
    user: { ...user, isAdmin: profile?.isAdmin === true },
  });
});
