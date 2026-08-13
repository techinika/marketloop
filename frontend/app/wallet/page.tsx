"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { User as FirebaseUser } from "firebase/auth";

import { formatPrice } from "@/lib/api";
import { observeAuthState } from "@/lib/firebase";
import { fetchWallet, withdrawWallet } from "@/lib/wallet";
import type { WalletResponse } from "@/types";
import { cn } from "@/lib/cn";
import { useToast } from "@/components/ui/Toast";
import { EmptyState } from "@/components/ui/EmptyState";

const PHONE_RE = /^\+?\d{9,15}$/;

const TYPE_BADGE: Record<string, { label: string; cls: string }> = {
  credit: { label: "Sale", cls: "badge-success" },
  debit: { label: "Withdrawal", cls: "badge-neutral" },
  refund: { label: "Refund", cls: "badge-warning" },
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function WalletPage() {
  const { toast } = useToast();
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [data, setData] = useState<WalletResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    return observeAuthState((nextUser) => setUser(nextUser));
  }, []);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!user) {
        setData(null);
        return;
      }
      setError(null);
      try {
        const wallet = await fetchWallet();
        if (!cancelled) setData(wallet);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load your wallet");
        setData(null);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [user]);

  const primaryCurrency = data?.transactions[0]?.currency ?? "RWF";
  const hasMixedCurrencies =
    !!data && data.transactions.some((tx) => tx.currency !== data.transactions[0]!.currency);

  const handleWithdraw = async () => {
    const parsed = Number(amount);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setError("Enter a valid amount");
      return;
    }
    if (!PHONE_RE.test(phone.trim())) {
      setError("Enter a valid MTN MoMo / Airtel number, e.g. 0788123456");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await withdrawWallet(parsed, phone.trim());
      setData((prev) =>
        prev
          ? {
              walletBalance: result.walletBalance,
              transactions: [
                {
                  id: crypto.randomUUID(),
                  userId: user?.uid ?? "",
                  orderId: null,
                  type: "debit" as const,
                  amount: parsed,
                  currency: "RWF",
                  createdAt: new Date().toISOString(),
                },
                ...prev.transactions,
              ],
            }
          : prev,
      );
      setAmount("");
      setPhone("");
      toast({
        title: "Withdrawal initiated",
        description: `${formatPrice(parsed, "RWF")} is on its way to ${phone.trim()}.`,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Withdrawal failed; your balance was restored");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="container-page max-w-3xl py-10 sm:py-14">
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">Wallet</h1>

      {!user ? (
        <div className="mt-8">
          <EmptyState
            icon="inbox"
            title="Sign in to see your earnings"
            description="Your wallet shows escrow payouts and withdrawals once you're signed in."
          >
            <Link href="/" className="btn btn-primary">
              Sign in
            </Link>
          </EmptyState>
        </div>
      ) : data === null && !error ? (
        <div className="mt-8 grid gap-6 sm:grid-cols-[1.2fr_1fr]">
          <div className="skeleton h-64 w-full rounded-card" />
          <div className="skeleton h-64 w-full rounded-card" />
        </div>
      ) : error && !data ? (
        <p className="mt-8 text-sm text-danger">{error}</p>
      ) : data ? (
        <div className="mt-6 grid gap-6 sm:grid-cols-[1.2fr_1fr]">
          <div className="card p-6">
            <p className="text-sm text-muted">Available balance</p>
            <p className="mt-2 text-4xl font-semibold tracking-tight text-foreground">
              {formatPrice(data.walletBalance, primaryCurrency)}
            </p>
            {hasMixedCurrencies && (
              <p className="mt-2 text-xs text-muted">
                Balance includes a mix of RWF and USD earnings. Withdrawals currently support RWF.
              </p>
            )}

            <div className="mt-6 rounded-xl border border-border bg-background p-4">
              <p className="text-sm font-medium text-foreground">Withdraw</p>
              {primaryCurrency === "USD" && data.walletBalance > 0 ? (
                <p className="mt-2 text-xs leading-5 text-muted">
                  USD withdrawals aren&apos;t self-serve yet. Email{" "}
                  <span className="font-medium text-accent-strong">support@marketloop.rw</span> and our team will
                  process it.
                </p>
              ) : (
                <>
                  <div className="mt-3 grid grid-cols-2 gap-3">
                    <input
                      type="number"
                      min="1"
                      placeholder="Amount (RWF)"
                      value={amount}
                      onChange={(event) => setAmount(event.target.value)}
                      className="field w-full"
                    />
                    <input
                      type="tel"
                      inputMode="numeric"
                      placeholder="MoMo number"
                      value={phone}
                      onChange={(event) => setPhone(event.target.value)}
                      className="field w-full"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={handleWithdraw}
                    disabled={busy}
                    className="btn btn-primary mt-4 w-full"
                  >
                    {busy ? "Withdrawing..." : "Withdraw to mobile money"}
                  </button>
                </>
              )}
            </div>

            {error && <p className="mt-3 text-sm text-danger">{error}</p>}
          </div>

          <div className="card p-6">
            <p className="text-sm font-medium text-foreground">Activity</p>
            {data.transactions.length === 0 ? (
              <p className="mt-4 text-sm text-muted">No activity yet. Your sales will appear here.</p>
            ) : (
              <ul className="mt-4 flex flex-col divide-y divide-border">
                {data.transactions.map((tx) => {
                  const meta = TYPE_BADGE[tx.type] ?? { label: tx.type, cls: "badge-neutral" };
                  return (
                    <li
                      key={tx.createdAt + tx.type + tx.amount}
                      className="flex items-center justify-between gap-3 py-3"
                    >
                      <div className="min-w-0">
                        <span className={cn("badge", meta.cls)}>{meta.label}</span>
                        <p className="mt-1 text-xs text-muted">{formatDate(tx.createdAt)}</p>
                      </div>
                      <span
                        className={cn(
                          "text-sm font-semibold",
                          tx.type === "credit" ? "text-success" : "text-foreground",
                        )}
                      >
                        {tx.type === "debit" ? "-" : "+"}
                        {formatPrice(tx.amount, tx.currency)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
