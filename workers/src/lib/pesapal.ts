// Pesapal (Kenya/east-Africa cards + mobile money) API client.
//
// Pesapal's public docs (https://developer.pesapal.com) are occasionally
// inconsistent about exact field names, so this client logs raw request
// failures verbosely to make auth/request issues easy to diagnose against a
// live account. The shapes below follow the V3 API as of 2026:
//
//   POST /api/Auth/RequestToken                          { consumer_key, consumer_secret } -> { token: "Bearer <jwt>", expiry_date, error }
//   POST /api/URLSetup/RegisterIPN                       { url, ipn_notification_type }    -> { ipn_id, url, created_date }
//   POST /api/Transactions/SubmitOrderRequest            { id, currency, amount, description, callback_url, notification_id, billing_address, redirect_mode } -> { order_tracking_id, redirect_url, merchant_reference, error }
//   GET  /api/Transactions/GetTransactionStatus?orderTrackingId=... -> { status_code, payment_status_description, amount, confirmation_code, ... }
//   POST /api/Refund/RefundRequest                       { confirmation_code, amount, username, remarks } -> { refund_id, refund_status, ... }

export interface BillingAddress {
  emailAddress?: string;
  phoneNumber?: string;
  countryCode?: string;
  firstName?: string;
  middleName?: string;
  lastName?: string;
  line1?: string;
  line2?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  zipCode?: string;
}

export interface PesapalClientOptions {
  consumerKey: string;
  consumerSecret: string;
  baseUrl: string;
}

export interface PesapalEnv {
  PESAPAL_CONSUMER_KEY: string;
  PESAPAL_CONSUMER_SECRET: string;
  PESAPAL_BASE_URL?: string;
}

export class PesapalError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "PesapalError";
  }
}

const DEFAULT_BASE_URL = "https://pay.pesapal.com/v3";

/** Builds a PesapalClient from Worker bindings. */
export function pesapalFromEnv(env: PesapalEnv): PesapalClient {
  return new PesapalClient({
    consumerKey: env.PESAPAL_CONSUMER_KEY,
    consumerSecret: env.PESAPAL_CONSUMER_SECRET,
    baseUrl: env.PESAPAL_BASE_URL ?? DEFAULT_BASE_URL,
  });
}

export class PesapalClient {
  private token: string | null = null;
  private tokenExpiresAt = 0;

  constructor(private readonly options: PesapalClientOptions) {}

  /** POST /api/Auth/RequestToken with { consumer_key, consumer_secret }. */
  async authenticate(): Promise<string> {
    const res = await fetch(`${this.options.baseUrl}/api/Auth/RequestToken`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        consumer_key: this.options.consumerKey,
        consumer_secret: this.options.consumerSecret,
      }),
    });
    const text = await res.text();
    if (!res.ok) {
      console.error(`Pesapal auth HTTP ${res.status}: ${text}`);
      throw new PesapalError(res.status, `Pesapal RequestToken failed (${res.status}): ${text}`);
    }
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(text);
    } catch {
      console.error(`Pesapal auth returned non-JSON: ${text}`);
      throw new PesapalError(0, `Pesapal RequestToken returned non-JSON: ${text}`);
    }
    // Docs return { token: "Bearer <jwt>", expiry_date, error }. Strip the "Bearer " prefix.
    const rawToken = body.token;
    if (typeof rawToken !== "string" || !rawToken) {
      console.error(`Pesapal auth response missing token: ${text}`);
      throw new PesapalError(0, `Pesapal RequestToken missing token: ${text}`);
    }
    const token = rawToken.replace(/^Bearer\s+/i, "");
    const expiry = typeof body.expiry_date === "string" ? new Date(body.expiry_date).getTime() : 0;
    this.token = token;
    this.tokenExpiresAt = Number.isFinite(expiry) && expiry > 0 ? expiry - 60_000 : Date.now() + 55 * 60_000;
    return token;
  }

  private async bearerToken(): Promise<string> {
    if (this.token && Date.now() < this.tokenExpiresAt) return this.token;
    return this.authenticate();
  }

  private async apiJson(path: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${await this.bearerToken()}`);
    if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    const res = await fetch(`${this.options.baseUrl}${path}`, { ...init, headers });
    const text = await res.text();
    if (!res.ok) {
      console.error(`Pesapal ${path} HTTP ${res.status}: ${text}`);
      throw new PesapalError(res.status, `Pesapal ${path} failed (${res.status}): ${text}`);
    }
    if (!text) return {};
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(text);
    } catch {
      console.error(`Pesapal ${path} returned non-JSON: ${text}`);
      throw new PesapalError(0, `Pesapal ${path} returned non-JSON: ${text}`);
    }
    return body;
  }

  /** POST /api/URLSetup/RegisterIPN — registers (once) the IPN callback URL. */
  async registerIPN(url: string): Promise<string> {
    const body = await this.apiJson("/api/URLSetup/RegisterIPN", {
      method: "POST",
      body: JSON.stringify({ url, ipn_notification_type: "GET" }),
    });
    const ipnId = body.ipn_id ?? body.ipnId ?? body.notification_id;
    if (typeof ipnId !== "string" || !ipnId) {
      console.error(`Pesapal RegisterIPN response missing ipn_id: ${JSON.stringify(body)}`);
      throw new PesapalError(0, "Pesapal RegisterIPN missing ipn_id");
    }
    return ipnId;
  }

  /** POST /api/Transactions/SubmitOrderRequest — creates a hosted payment page. */
  async submitOrder(input: {
    id: string;
    amount: number;
    description: string;
    callbackUrl: string;
    notificationId: string;
    billingAddress: BillingAddress;
  }): Promise<{ orderTrackingId: string; redirectUrl: string; merchantReference: string }> {
    const { id, amount, description, callbackUrl, notificationId, billingAddress } = input;
    const body = await this.apiJson("/api/Transactions/SubmitOrderRequest", {
      method: "POST",
      body: JSON.stringify({
        id,
        currency: "USD",
        amount,
        description,
        callback_url: callbackUrl,
        notification_id: notificationId,
        billing_address: {
          email_address: billingAddress.emailAddress ?? "",
          phone_number: billingAddress.phoneNumber ?? "",
          country_code: billingAddress.countryCode ?? "",
          first_name: billingAddress.firstName ?? "",
          middle_name: billingAddress.middleName ?? "",
          last_name: billingAddress.lastName ?? "",
          line_1: billingAddress.line1 ?? "",
          line_2: billingAddress.line2 ?? "",
          city: billingAddress.city ?? "",
          state: billingAddress.state ?? "",
          postal_code: billingAddress.postalCode ?? "",
          zip_code: billingAddress.zipCode ?? "",
        },
        redirect_mode: "GET",
        cancellation_url: input.callbackUrl,
      }),
    });
    const orderTrackingId = body.order_tracking_id ?? body.orderTrackingId;
    const redirectUrl = body.redirect_url ?? body.redirectUrl;
    const rawMerchantReference = body.merchant_reference ?? body.merchantReference;
    const merchantReference =
      typeof rawMerchantReference === "string" && rawMerchantReference ? rawMerchantReference : id;
    if (typeof orderTrackingId !== "string" || !orderTrackingId || typeof redirectUrl !== "string" || !redirectUrl) {
      console.error(`Pesapal SubmitOrderRequest response missing fields: ${JSON.stringify(body)}`);
      throw new PesapalError(0, `Pesapal SubmitOrderRequest missing order_tracking_id/redirect_url`);
    }
    return { orderTrackingId, redirectUrl, merchantReference };
  }

  /** GET /api/Transactions/GetTransactionStatus — poll for payment status. */
  async getTransactionStatus(orderTrackingId: string): Promise<Record<string, unknown>> {
    return this.apiJson(`/api/Transactions/GetTransactionStatus?orderTrackingId=${encodeURIComponent(orderTrackingId)}`);
  }

  /** POST /api/Refund/RefundRequest — requests an approval-tracked refund (finalized by Pesapal finance). */
  async refundRequest(input: {
    confirmationCode: string;
    amount: number;
    username: string;
    remarks: string;
  }): Promise<Record<string, unknown>> {
    return this.apiJson("/api/Refund/RefundRequest", {
      method: "POST",
      body: JSON.stringify({
        confirmation_code: input.confirmationCode,
        amount: input.amount,
        username: input.username,
        remarks: input.remarks,
      }),
    });
  }
}
