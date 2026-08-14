"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import { adminApproveVerification, adminListPendingVerifications, adminRejectVerification } from "@/lib/admin";
import { ID_DOCUMENT_LABELS } from "@/lib/verifications";
import type { AdminVerificationRow } from "@/types";
import { useToast } from "@/components/ui/Toast";
import { TableSkeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function AdminVerificationsPage() {
  const { toast } = useToast();
  const [rows, setRows] = useState<AdminVerificationRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [busyUid, setBusyUid] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await adminListPendingVerifications();
        if (!cancelled) setRows(data.verifications);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load verifications");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleApprove = async (uid: string) => {
    setBusyUid(uid);
    try {
      await adminApproveVerification(uid);
      setRows((prev) => prev.filter((row) => row.uid !== uid));
      toast({ title: "Approved", description: "The user now shows as verified." });
    } catch (err) {
      toast({ title: "Approval failed", description: err instanceof Error ? err.message : "Try again.", variant: "error" });
    } finally {
      setBusyUid(null);
    }
  };

  const handleReject = async (uid: string) => {
    if (!rejectReason.trim()) return;
    setBusyUid(uid);
    try {
      await adminRejectVerification(uid, rejectReason.trim());
      setRows((prev) => prev.filter((row) => row.uid !== uid));
      setRejecting(null);
      setRejectReason("");
      toast({ title: "Rejected", description: "The user was notified with your reason." });
    } catch (err) {
      toast({ title: "Rejection failed", description: err instanceof Error ? err.message : "Try again.", variant: "error" });
    } finally {
      setBusyUid(null);
    }
  };

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Verifications</h1>
          <p className="mt-1 text-sm text-muted">Identity documents awaiting review.</p>
        </div>
        <Link href="/admin" className="btn btn-secondary">
          Back to overview
        </Link>
      </div>

      {error ? (
        <p className="mt-8 text-sm text-danger">{error}</p>
      ) : loading ? (
        <div className="mt-6">
          <TableSkeleton rows={4} columns={5} />
        </div>
      ) : rows.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            icon="users"
            title="Nothing to review"
            description="When users submit identity documents, they'll appear here."
          />
        </div>
      ) : (
        <div className="card mt-6 overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="border-b border-border text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-4 py-3 font-medium">User</th>
                <th className="px-4 py-3 font-medium">Phone</th>
                <th className="px-4 py-3 font-medium">Document</th>
                <th className="px-4 py-3 font-medium">Submitted</th>
                <th className="px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((row) => (
                <tr key={row.uid} className="align-top transition-colors hover:bg-surface-muted">
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
                  <td className="px-4 py-3">
                    <p className="text-muted">{row.phone ?? "—"}</p>
                    {row.phoneVerified && <span className="badge badge-success mt-1">Phone verified</span>}
                  </td>
                  <td className="px-4 py-3">
                    {row.documentUrl ? (
                      <a
                        href={row.documentUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-accent-strong underline"
                      >
                        {row.idDocumentType ? ID_DOCUMENT_LABELS[row.idDocumentType] : "Document"}
                      </a>
                    ) : (
                      <span className="text-muted">
                        {row.idDocumentType ? ID_DOCUMENT_LABELS[row.idDocumentType] : "—"}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted">{formatDate(row.verificationSubmittedAt)}</td>
                  <td className="px-4 py-3">
                    {rejecting === row.uid ? (
                      <div className="flex flex-col items-start gap-2">
                        <textarea
                          value={rejectReason}
                          onChange={(event) => setRejectReason(event.target.value)}
                          placeholder="Reason shown to the user..."
                          rows={2}
                          className="field w-full min-w-56"
                          autoFocus
                        />
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => handleReject(row.uid)}
                            disabled={busyUid === row.uid || !rejectReason.trim()}
                            className="btn btn-danger"
                          >
                            {busyUid === row.uid ? "Rejecting..." : "Confirm reject"}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setRejecting(null);
                              setRejectReason("");
                            }}
                            disabled={busyUid === row.uid}
                            className="btn btn-secondary"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => handleApprove(row.uid)}
                          disabled={busyUid === row.uid}
                          className="btn btn-primary"
                        >
                          {busyUid === row.uid ? "..." : "Approve"}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setRejecting(row.uid);
                            setRejectReason("");
                          }}
                          disabled={busyUid === row.uid}
                          className="btn btn-secondary"
                        >
                          Reject
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
