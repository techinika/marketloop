"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

import { useMe } from "@/lib/useMe";
import { ApiError } from "@/lib/api";
import { cn } from "@/lib/cn";
import {
  confirmPhoneOtp,
  fetchVerificationState,
  ID_DOCUMENT_LABELS,
  ID_DOCUMENT_TYPES,
  ID_IMAGE_TYPES,
  MAX_ID_IMAGE_BYTES,
  requestPhoneOtp,
  signIdDocumentUrl,
  submitIdDocument,
} from "@/lib/verifications";
import type { IdDocumentType, VerificationState } from "@/types";
import { useToast } from "@/components/ui/Toast";
import { EmptyState } from "@/components/ui/EmptyState";

const PHONE_RE = /^\+[1-9]\d{6,14}$/;

const STATUS_BADGE: Record<VerificationState["verificationStatus"], { label: string; cls: string }> = {
  unverified: { label: "Not verified", cls: "badge-neutral" },
  pending: { label: "Under review", cls: "badge-warning" },
  verified: { label: "Verified", cls: "badge-success" },
  rejected: { label: "Needs attention", cls: "badge-warning" },
};

function formatDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function VerificationPage() {
  const { firebaseUser: user } = useMe();
  const { toast } = useToast();

  const [state, setState] = useState<VerificationState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Phone OTP flow.
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [otpBusy, setOtpBusy] = useState(false);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [resendIn, setResendIn] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ID document flow.
  const [documentType, setDocumentType] = useState<IdDocumentType>("national_id");
  const [file, setFile] = useState<File | null>(null);
  const [idBusy, setIdBusy] = useState(false);
  const [idError, setIdError] = useState<string | null>(null);
  const [docUrlBusy, setDocUrlBusy] = useState(false);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    const run = async () => {
      setLoadError(null);
      try {
        const next = await fetchVerificationState();
        if (!cancelled) setState(next);
      } catch (err) {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : "Failed to load verification status");
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [user]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const startResendTimer = (seconds: number) => {
    setResendIn(seconds);
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setResendIn((prev) => {
        if (prev <= 1 && timerRef.current) clearInterval(timerRef.current);
        return Math.max(0, prev - 1);
      });
    }, 1000);
  };

  const handleSendCode = async () => {
    const trimmed = phone.trim();
    if (!PHONE_RE.test(trimmed)) {
      toast({ title: "Enter a valid phone number", description: "Use E.164 format, e.g. +250788123456.", variant: "error" });
      return;
    }
    setOtpBusy(true);
    try {
      const { resendInSeconds } = await requestPhoneOtp(trimmed);
      setPhone(trimmed);
      startResendTimer(resendInSeconds);
      toast({ title: "Code sent", description: `SMS delivered to ${trimmed}. It expires in 10 minutes.` });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to send the code";
      if (err instanceof ApiError && err.status === 429) {
        const body = err.body as { resendInSeconds?: number } | null;
        const resendInSeconds = body?.resendInSeconds;
        if (typeof resendInSeconds === "number") startResendTimer(resendInSeconds);
      }
      toast({ title: "Couldn't send code", description: message, variant: "error" });
    } finally {
      setOtpBusy(false);
    }
  };

  const handleConfirmCode = async () => {
    if (!/^\d{6}$/.test(code.trim())) {
      toast({ title: "Enter the 6-digit code", variant: "error" });
      return;
    }
    setConfirmBusy(true);
    try {
      await confirmPhoneOtp(phone.trim(), code.trim());
      setCode("");
      const next = await fetchVerificationState();
      setState(next);
      toast({ title: "Phone verified", description: "Your number now shows as verified." });
    } catch (err) {
      toast({ title: "Verification failed", description: err instanceof Error ? err.message : "Try again.", variant: "error" });
    } finally {
      setConfirmBusy(false);
    }
  };

  const handleFileChange = (next: File | null) => {
    setIdError(null);
    if (!next) {
      setFile(null);
      return;
    }
    if (!ID_IMAGE_TYPES.includes(next.type)) {
      setIdError("Only JPEG, PNG or WebP images are accepted.");
      setFile(null);
      return;
    }
    if (next.size > MAX_ID_IMAGE_BYTES) {
      setIdError("The image must be 5MB or smaller.");
      setFile(null);
      return;
    }
    setFile(next);
  };

  const handleSubmitId = async () => {
    if (!file) {
      setIdError("Choose a photo or scan of your ID document first.");
      return;
    }
    setIdBusy(true);
    setIdError(null);
    try {
      const result = await submitIdDocument(file, documentType);
      setFile(null);
      setState((prev) =>
        prev ? { ...prev, verificationStatus: result.verificationStatus, idDocumentType: documentType } : prev,
      );
      toast({ title: "Submitted for review", description: "An admin will review your ID shortly." });
    } catch (err) {
      setIdError(err instanceof Error ? err.message : "Upload failed. Please try again.");
    } finally {
      setIdBusy(false);
    }
  };

  const handleViewDocument = async () => {
    setDocUrlBusy(true);
    try {
      const { url } = await signIdDocumentUrl();
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (err) {
      toast({ title: "Couldn't open the document", description: err instanceof Error ? err.message : "Try again.", variant: "error" });
    } finally {
      setDocUrlBusy(false);
    }
  };

  if (!user) {
    return (
      <div className="container-page max-w-3xl py-10 sm:py-14">
        <EmptyState
          icon="inbox"
          title="Sign in to verify your identity"
          description="Verify your phone and ID to build trust with buyers and sellers."
        >
          <Link href="/" className="btn btn-primary">
            Sign in
          </Link>
        </EmptyState>
      </div>
    );
  }

  if (loadError && !state) {
    return (
      <div className="container-page max-w-3xl py-10 sm:py-14">
        <p className="text-sm text-danger">{loadError}</p>
      </div>
    );
  }

  const statusBadge = state ? STATUS_BADGE[state.verificationStatus] : null;
  const phoneVerified = Boolean(state?.phoneVerifiedAt);
  const pending = state?.verificationStatus === "pending";
  const verified = state?.verificationStatus === "verified";

  return (
    <div className="container-page max-w-3xl py-10 sm:py-14">
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">Verification</h1>
      <p className="mt-1 text-sm text-muted">
        Confirm your phone and identity so buyers can trust you at a glance.
      </p>

      <div className="mt-6 grid gap-6 sm:grid-cols-[1.2fr_1fr]">
        <div className="flex flex-col gap-6">
          <section className="card p-6">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-medium text-foreground">Phone number</p>
              {phoneVerified ? (
                <span className="badge badge-success">Verified</span>
              ) : (
                <span className="badge badge-neutral">Not verified</span>
              )}
            </div>

            {phoneVerified ? (
              <p className="mt-3 text-sm leading-6 text-secondary">
                Your number was confirmed{formatDate(state?.phoneVerifiedAt) ? ` on ${formatDate(state?.phoneVerifiedAt)}` : ""}.
                Sellers with a verified phone show a badge on their listings.
              </p>
            ) : (
              <>
                <div className="mt-4 grid grid-cols-[1fr_auto] gap-3">
                  <input
                    type="tel"
                    inputMode="tel"
                    placeholder="+250788123456"
                    value={phone}
                    onChange={(event) => setPhone(event.target.value)}
                    className="field w-full"
                  />
                  <button
                    type="button"
                    onClick={handleSendCode}
                    disabled={otpBusy || resendIn > 0}
                    className="btn btn-secondary"
                  >
                    {otpBusy ? "Sending..." : resendIn > 0 ? `Resend in ${resendIn}s` : "Send code"}
                  </button>
                </div>
                <div className="mt-3 grid grid-cols-[1fr_auto] gap-3">
                  <input
                    type="text"
                    inputMode="numeric"
                    placeholder="6-digit code"
                    value={code}
                    onChange={(event) => setCode(event.target.value)}
                    className="field w-full"
                  />
                  <button
                    type="button"
                    onClick={handleConfirmCode}
                    disabled={confirmBusy || code.trim().length !== 6}
                    className="btn btn-primary"
                  >
                    {confirmBusy ? "Checking..." : "Verify"}
                  </button>
                </div>
                <p className="mt-3 text-xs leading-5 text-muted">
                  We text a one-time code to your number. Enter it above to confirm ownership. The code expires in 10
                  minutes.
                </p>
              </>
            )}
          </section>

          <section className="card p-6">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-medium text-foreground">Identity document</p>
              {statusBadge && (
                <span className={cn("badge", statusBadge.cls)}>{statusBadge.label}</span>
              )}
            </div>

            {state?.verificationStatus === "rejected" && state.verificationNote && (
              <div className="mt-4 rounded-xl border border-border bg-danger-soft p-4 text-sm text-danger">
                <p className="font-medium">Your previous submission was rejected</p>
                <p className="mt-1 leading-6">{state.verificationNote}</p>
                <p className="mt-1 text-xs text-muted">You can resubmit with a clearer document below.</p>
              </div>
            )}

            {verified ? (
              <div className="mt-4 text-sm leading-6 text-secondary">
                <p>
                  Your identity document ({state?.idDocumentType ? ID_DOCUMENT_LABELS[state.idDocumentType] : "ID"}) was
                  approved. A verified badge now shows on your profile.
                </p>
              </div>
            ) : pending ? (
              <div className="mt-4 text-sm leading-6 text-secondary">
                <p>
                  Your document is being reviewed{formatDate(state.verificationSubmittedAt) ? ` (submitted ${formatDate(state.verificationSubmittedAt)})` : ""}.
                  This usually takes less than a day. You&apos;ll get a notification when it&apos;s decided.
                </p>
              </div>
            ) : (
              <>
                <div className="mt-4 grid grid-cols-2 gap-3">
                  <label className="flex flex-col gap-1.5">
                    <span className="text-xs font-medium text-muted">Document type</span>
                    <select
                      value={documentType}
                      onChange={(event) => setDocumentType(event.target.value as IdDocumentType)}
                      className="field w-full"
                    >
                      {ID_DOCUMENT_TYPES.map((type) => (
                        <option key={type} value={type}>
                          {ID_DOCUMENT_LABELS[type]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex flex-col gap-1.5">
                    <span className="text-xs font-medium text-muted">Image</span>
                    <input
                      type="file"
                      accept={ID_IMAGE_TYPES.join(",")}
                      onChange={(event) => handleFileChange(event.target.files?.[0] ?? null)}
                      className="field w-full cursor-pointer"
                    />
                  </label>
                </div>
                {idError && <p className="mt-3 text-sm text-danger">{idError}</p>}
                <button
                  type="button"
                  onClick={handleSubmitId}
                  disabled={idBusy || !file}
                  className="btn btn-primary mt-4"
                >
                  {idBusy ? "Uploading..." : file ? `Submit ${ID_DOCUMENT_LABELS[documentType].toLowerCase()}` : "Submit for review"}
                </button>
                <p className="mt-3 text-xs leading-5 text-muted">
                  A clear photo of your {ID_DOCUMENT_LABELS[documentType].toLowerCase()}, 5MB or smaller. Documents are
                  stored privately and only visible to you and the moderation team.
                </p>
              </>
            )}

            {state?.idDocumentType && !verified && !pending && (
              <button
                type="button"
                onClick={handleViewDocument}
                disabled={docUrlBusy}
                className="btn btn-secondary mt-4"
              >
                {docUrlBusy ? "Opening..." : "View submitted document"}
              </button>
            )}
          </section>
        </div>

        <aside className="card h-fit p-6">
          <p className="text-sm font-medium text-foreground">Why verify?</p>
          <ul className="mt-3 flex flex-col gap-3 text-sm leading-6 text-secondary">
            <li className="flex gap-2">
              <span className="mt-2 size-1.5 shrink-0 rounded-full bg-accent" aria-hidden="true" />
              Verified sellers show a badge, so buyers trust your listings.
            </li>
            <li className="flex gap-2">
              <span className="mt-2 size-1.5 shrink-0 rounded-full bg-accent" aria-hidden="true" />
              A confirmed phone helps recover accounts and process payouts.
            </li>
            <li className="flex gap-2">
              <span className="mt-2 size-1.5 shrink-0 rounded-full bg-accent" aria-hidden="true" />
              Verification is free and never required to buy or sell.
            </li>
          </ul>
        </aside>
      </div>
    </div>
  );
}
