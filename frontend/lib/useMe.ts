"use client";

import { useEffect, useState } from "react";
import type { User as FirebaseUser } from "firebase/auth";

import { apiFetch } from "@/lib/api";
import { observeAuthState } from "@/lib/firebase";
import type { AuthUser } from "@/types";

/**
 * Tracks the signed-in Firebase user and the backend profile from
 * GET /auth/me (which includes the `isAdmin` flag). Used by the admin guard
 * and the notification bell.
 */
export function useMe() {
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  const [me, setMe] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    return observeAuthState((nextUser) => setFirebaseUser(nextUser));
  }, []);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!firebaseUser) {
        setMe(null);
        setLoading(false);
        return;
      }
      try {
        const res = await apiFetch<{ user: AuthUser }>("/auth/me");
        if (!cancelled) setMe(res.user);
      } catch {
        if (!cancelled) setMe(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [firebaseUser]);

  return { firebaseUser, me, loading };
}
