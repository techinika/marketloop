"use client";

import { useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";

import { useMe } from "@/lib/useMe";

/** Redirects non-admins (and signed-out users) to /explore. */
export function AdminGuard({ children }: { children: ReactNode }) {
  const { me, loading } = useMe();
  const router = useRouter();

  useEffect(() => {
    if (!loading && me?.isAdmin !== true) {
      router.replace("/explore");
    }
  }, [loading, me, router]);

  if (loading) {
    return (
      <div className="flex flex-col items-center gap-4 py-24">
        <div className="skeleton h-6 w-48 rounded-lg" />
        <p className="text-sm text-muted">Checking access...</p>
      </div>
    );
  }

  if (me?.isAdmin !== true) return null;

  return <>{children}</>;
}
