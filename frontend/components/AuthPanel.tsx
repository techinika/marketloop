"use client";

import { useEffect, useMemo, useState } from "react";
import type { User } from "firebase/auth";

import { apiFetch } from "@/lib/api";
import {
  isFirebaseConfigured,
  observeAuthState,
  signInWithGoogle,
  signOutUser,
} from "@/lib/firebase";
import type { AuthUser } from "@/types";

export function AuthPanel() {
  const configured = useMemo(() => isFirebaseConfigured(), []);
  const [ready, setReady] = useState(!configured);
  const [user, setUser] = useState<User | null>(null);
  const [busy, setBusy] = useState(false);
  const [me, setMe] = useState<AuthUser | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!configured) return;
    return observeAuthState((nextUser) => {
      setUser(nextUser);
      setReady(true);
    });
  }, [configured]);

  const handleSignIn = async () => {
    setBusy(true);
    setError(null);
    try {
      const nextUser = await signInWithGoogle();
      setUser(nextUser);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed");
    } finally {
      setBusy(false);
    }
  };

  const handleSignOut = async () => {
    setBusy(true);
    setError(null);
    try {
      await signOutUser();
      setUser(null);
      setMe(null);
    } finally {
      setBusy(false);
    }
  };

  const handleVerifyMe = async () => {
    setBusy(true);
    setError(null);
    setMe(null);
    try {
      const res = await apiFetch<{ user: AuthUser }>("/auth/me");
      setMe(res.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setBusy(false);
    }
  };

  if (!configured) {
    return (
      <p className="text-sm text-muted">
        Firebase is not configured. Add NEXT_PUBLIC_FIREBASE_* variables to .env.local.
      </p>
    );
  }

  if (!ready) {
    return <p className="text-sm text-muted">Loading auth state...</p>;
  }

  return (
    <div className="card w-full p-8 text-left">
      {user ? (
        <>
          <div className="flex items-center gap-4">
            {user.photoURL ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={user.photoURL}
                alt=""
                className="size-12 rounded-full border border-border"
              />
            ) : (
              <div className="size-12 rounded-full bg-accent-soft" />
            )}
            <div>
              <p className="font-medium text-foreground">
                {user.displayName ?? "Signed in"}
              </p>
              <p className="text-sm text-muted">{user.email}</p>
            </div>
          </div>

          <div className="mt-6 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={handleVerifyMe}
              disabled={busy}
              className="btn btn-secondary"
            >
              Verify with GET /auth/me
            </button>
            <button
              type="button"
              onClick={handleSignOut}
              disabled={busy}
              className="btn btn-primary"
            >
              Sign out
            </button>
          </div>

          {me && (
            <pre className="mt-6 overflow-x-auto rounded-card bg-background p-4 text-xs leading-5 text-foreground">
              {JSON.stringify(me, null, 2)}
            </pre>
          )}
        </>
      ) : (
        <>
          <p className="text-sm text-muted">
            Sign in with Google to authenticate against the Workers API.
          </p>
          <button
            type="button"
            onClick={handleSignIn}
            disabled={busy}
            className="btn btn-primary mt-5 w-full"
          >
            {busy ? "Signing in..." : "Sign in with Google"}
          </button>
        </>
      )}

      {error && <p className="mt-4 text-sm text-danger">{error}</p>}
    </div>
  );
}
