"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import { formatPrice } from "@/lib/api";
import { adminListUsers } from "@/lib/admin";
import type { AdminUserRow } from "@/types";
import { TableSkeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";

function formatDate(iso: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function AdminUsersPage() {
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await adminListUsers(debounced);
        if (!cancelled) setUsers(data.users);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load users");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [debounced]);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Users</h1>
          <p className="mt-1 text-sm text-muted">Registered buyers and sellers.</p>
        </div>
        <Link href="/admin" className="btn btn-secondary">
          Back to overview
        </Link>
      </div>

      <input
        type="search"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder="Search by name or email..."
        className="field mt-6 w-full max-w-sm"
      />

      {error ? (
        <p className="mt-8 text-sm text-danger">{error}</p>
      ) : loading ? (
        <div className="mt-6">
          <TableSkeleton rows={6} columns={6} />
        </div>
      ) : users.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            icon="users"
            title="No users found"
            description="Try a different search term or check back later."
          />
        </div>
      ) : (
        <div className="card mt-6 overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="border-b border-border text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-4 py-3 font-medium">User</th>
                <th className="px-4 py-3 font-medium">Wallet</th>
                <th className="px-4 py-3 font-medium">Products</th>
                <th className="px-4 py-3 font-medium">Orders</th>
                <th className="px-4 py-3 font-medium">Role</th>
                <th className="px-4 py-3 font-medium">Joined</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {users.map((row) => (
                <tr key={row.uid} className="transition-colors hover:bg-surface-muted">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      {row.photoUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={row.photoUrl}
                          alt={row.name}
                          className="size-9 rounded-full object-cover"
                          referrerPolicy="no-referrer"
                        />
                      ) : (
                        <span className="flex size-9 items-center justify-center rounded-full bg-accent-soft text-sm font-semibold text-accent-strong">
                          {row.name.charAt(0).toUpperCase()}
                        </span>
                      )}
                      <div>
                        <p className="font-medium text-foreground">{row.name}</p>
                        <p className="text-xs text-muted">{row.email}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 font-medium text-foreground">
                    {formatPrice(row.walletBalance, "RWF")}
                  </td>
                  <td className="px-4 py-3 text-muted">{row.productCount}</td>
                  <td className="px-4 py-3 text-muted">{row.orderCount}</td>
                  <td className="px-4 py-3">
                    {row.isAdmin ? (
                      <span className="badge badge-accent">Admin</span>
                    ) : (
                      <span className="text-muted">User</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted">{formatDate(row.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
