import { apiFetch } from "@/lib/api";
import type { WalletResponse } from "@/types";

/** GET /wallet — the caller's balance + transaction history (newest first). */
export async function fetchWallet(): Promise<WalletResponse> {
  return apiFetch<WalletResponse>("/wallet");
}

/**
 * POST /wallet/withdraw — RWF withdrawals via Paypack cashout to the caller's
 * MoMo number. USD withdrawals are not self-serve yet.
 */
export async function withdrawWallet(
  amount: number,
  phoneNumber: string,
): Promise<{ transaction: { id: string; type: string; amount: number; currency: string }; walletBalance: number }> {
  return apiFetch<{ transaction: { id: string; type: string; amount: number; currency: string }; walletBalance: number }>(
    "/wallet/withdraw",
    { method: "POST", body: JSON.stringify({ amount, phoneNumber }) },
  );
}
