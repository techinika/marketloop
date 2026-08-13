// Paypack (Rwanda mobile money) API client.
//
// Docs: https://docs.paypack.ph
//   POST /auth/agents/authorize            { client_id, client_secret } -> { access, refresh, expires }
//   GET  /auth/agents/refresh/{refresh}    -> { access, refresh, expires }
//   POST /transactions/cashin              { amount, number, environment } -> { id, ref, status, kind, ... }
//   POST /transactions/cashout             same shape as cashin
//   GET  /transactions/find/{ref}          -> transaction
//
// Webhook signature: `X-Paypack-Signature` is base64(HMAC-SHA256(rawBody, PAYPACK_WEBHOOK_SECRET)).

export interface PaypackTokens {
  access: string;
  refresh: string;
}

export interface PaypackClientOptions {
  clientId: string;
  clientSecret: string;
  baseUrl: string;
  environment?: "production" | "development";
  webhookSecret?: string;
}

export interface PaypackEnv {
  PAYPACK_CLIENT_ID: string;
  PAYPACK_CLIENT_SECRET: string;
  PAYPACK_BASE_URL?: string;
  PAYPACK_ENVIRONMENT?: string;
  PAYPACK_WEBHOOK_SECRET?: string;
}

export class PaypackError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "PaypackError";
  }
}

// Refresh the access token a little before its ~15 min lifetime expires.
const TOKEN_REFRESH_SKEW_MS = 60_000;
const DEFAULT_BASE_URL = "https://api.paypack.ph";

/** Builds a PaypackClient from Worker bindings. */
export function paypackFromEnv(env: PaypackEnv): PaypackClient {
  return new PaypackClient({
    clientId: env.PAYPACK_CLIENT_ID,
    clientSecret: env.PAYPACK_CLIENT_SECRET,
    baseUrl: env.PAYPACK_BASE_URL ?? DEFAULT_BASE_URL,
    environment: env.PAYPACK_ENVIRONMENT === "production" ? "production" : "development",
    webhookSecret: env.PAYPACK_WEBHOOK_SECRET,
  });
}

export class PaypackClient {
  private tokens: PaypackTokens | null = null;
  private tokenExpiresAt = 0;

  constructor(private readonly options: PaypackClientOptions) {}

  /** POST /auth/agents/authorize with { client_id, client_secret }. */
  async authenticate(): Promise<PaypackTokens> {
    const res = await fetch(`${this.options.baseUrl}/auth/agents/authorize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: this.options.clientId,
        client_secret: this.options.clientSecret,
      }),
    });
    const text = await res.text();
    if (!res.ok) {
      throw new PaypackError(res.status, `Paypack authorize failed (${res.status}): ${text}`);
    }
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(text);
    } catch {
      throw new PaypackError(0, `Paypack authorize returned non-JSON: ${text}`);
    }
    const access = body.access;
    const refresh = body.refresh;
    if (typeof access !== "string" || typeof refresh !== "string") {
      throw new PaypackError(0, `Paypack authorize response missing access/refresh: ${text}`);
    }
    this.cacheTokens({ access, refresh }, body.expires);
    return { access, refresh };
  }

  /** GET /auth/agents/refresh/{refresh_token} — called before the token expires. */
  async refresh(refreshToken: string): Promise<PaypackTokens> {
    const res = await fetch(
      `${this.options.baseUrl}/auth/agents/refresh/${encodeURIComponent(refreshToken)}`,
      { method: "GET" },
    );
    const text = await res.text();
    if (!res.ok) {
      throw new PaypackError(res.status, `Paypack refresh failed (${res.status}): ${text}`);
    }
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(text);
    } catch {
      throw new PaypackError(0, `Paypack refresh returned non-JSON: ${text}`);
    }
    const access = body.access;
    const refresh = body.refresh;
    if (typeof access !== "string" || typeof refresh !== "string") {
      throw new PaypackError(0, `Paypack refresh response missing access/refresh: ${text}`);
    }
    this.cacheTokens({ access, refresh }, body.expires);
    return { access, refresh };
  }

  private cacheTokens(tokens: PaypackTokens, expiresSeconds: unknown): void {
    const ttl =
      typeof expiresSeconds === "number" && expiresSeconds > 0 ? expiresSeconds * 1000 : 14 * 60_000;
    this.tokens = tokens;
    this.tokenExpiresAt = Date.now() + ttl - TOKEN_REFRESH_SKEW_MS;
  }

  private async accessToken(): Promise<string> {
    if (this.tokens && Date.now() < this.tokenExpiresAt) return this.tokens.access;
    if (this.tokens?.refresh) {
      try {
        await this.refresh(this.tokens.refresh);
        return this.tokens.access;
      } catch (err) {
        console.error("Paypack token refresh failed; re-authenticating.", err);
      }
    }
    const tokens = await this.authenticate();
    return tokens.access;
  }

  private async apiJson(path: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
    const headers = new Headers(init.headers);
    if (!headers.has("Authorization")) {
      headers.set("Authorization", `Bearer ${await this.accessToken()}`);
    }
    if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    const res = await fetch(`${this.options.baseUrl}${path}`, { ...init, headers });
    const text = await res.text();
    if (!res.ok) {
      throw new PaypackError(res.status, `Paypack ${path} failed (${res.status}): ${text}`);
    }
    if (!text) return {};
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(text);
    } catch {
      throw new PaypackError(0, `Paypack ${path} returned non-JSON: ${text}`);
    }
    return body;
  }

  private async transaction(
    path: "/transactions/cashin" | "/transactions/cashout",
    amount: number,
    phoneNumber: string,
    idempotencyKey: string,
  ): Promise<{ ref: string; status: string }> {
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new PaypackError(0, `Invalid amount for ${path}: ${amount}`);
    }
    const body = await this.apiJson(path, {
      method: "POST",
      headers: { "Idempotency-Key": idempotencyKey },
      body: JSON.stringify({
        amount,
        number: phoneNumber,
        environment: this.options.environment ?? "development",
      }),
    });
    if (typeof body.ref !== "string") {
      throw new PaypackError(0, `Paypack ${path} response missing ref: ${JSON.stringify(body)}`);
    }
    return { ref: body.ref, status: typeof body.status === "string" ? body.status : "PENDING" };
  }

  /** POST /transactions/cashin — collect money from a buyer's MoMo number. */
  async cashin(amount: number, phoneNumber: string, idempotencyKey: string): Promise<{ ref: string; status: string }> {
    return this.transaction("/transactions/cashin", amount, phoneNumber, idempotencyKey);
  }

  /** POST /transactions/cashout — pay money to a MoMo number (withdrawals/refunds). */
  async cashout(amount: number, phoneNumber: string, idempotencyKey: string): Promise<{ ref: string; status: string }> {
    return this.transaction("/transactions/cashout", amount, phoneNumber, idempotencyKey);
  }

  /** GET /transactions/find/{ref} — poll/verify a transaction's status. */
  async findTransaction(ref: string): Promise<Record<string, unknown>> {
    return this.apiJson(`/transactions/find/${encodeURIComponent(ref)}`);
  }

  /**
   * Verifies a Paypack webhook signature: base64(HMAC-SHA256(rawBody, webhookSecret))
   * compared against the `X-Paypack-Signature` header. Uses Web Crypto (Workers-safe).
   */
  async verifyWebhookSignature(rawBody: string, signatureHeader: string | null): Promise<boolean> {
    const secret = this.options.webhookSecret;
    if (!signatureHeader || !secret) return false;
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
    const expected = btoa(String.fromCharCode(...new Uint8Array(signature)));
    if (expected.length !== signatureHeader.length) return false;
    let diff = 0;
    for (let i = 0; i < expected.length; i++) {
      diff |= expected.charCodeAt(i) ^ signatureHeader.charCodeAt(i);
    }
    return diff === 0;
  }
}
