// Unit tests for the Pesapal client against a local mock API.
// Run with: npm run test:pesapal

import { createServer } from "node:http";

import { PesapalClient } from "../src/lib/pesapal";

const PORT = 8811;
const BASE_URL = `http://127.0.0.1:${PORT}`;

interface RecordedRequest {
  path: string;
  method: string;
  authorization: string | null;
  body: Record<string, unknown>;
}

const requests: RecordedRequest[] = [];
const registeredIpnIds: string[] = [];

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

async function main(): Promise<void> {
  let requestTokenCount = 0;

  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk as Buffer));
    req.on("end", () => {
      const bodyText = Buffer.concat(chunks).toString();
      const url = new URL(req.url ?? "/", BASE_URL);
      const body = bodyText ? (JSON.parse(bodyText) as Record<string, unknown>) : {};
      requests.push({
        path: url.pathname,
        method: req.method ?? "GET",
        authorization: req.headers.authorization ?? null,
        body,
      });

      res.setHeader("Content-Type", "application/json");

      if (req.method === "POST" && url.pathname === "/api/Auth/RequestToken") {
        requestTokenCount++;
        assert(body.consumer_key === "consumer-key", "sends consumer_key");
        assert(body.consumer_secret === "consumer-secret", "sends consumer_secret");
        res.end(JSON.stringify({ token: "Bearer pesapal-jwt-1", expiry_date: new Date(Date.now() + 3600_000).toISOString() }));
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/URLSetup/RegisterIPN") {
        assert(req.headers.authorization === "Bearer pesapal-jwt-1", "RegisterIPN uses bearer token");
        assert(body.ipn_notification_type === "GET", "RegisterIPN uses GET notification type");
        const ipnId = `ipn-${registeredIpnIds.length + 1}`;
        registeredIpnIds.push(ipnId);
        res.end(JSON.stringify({ ipn_id: ipnId, url: body.url, created_date: new Date().toISOString() }));
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/Transactions/SubmitOrderRequest") {
        assert(req.headers.authorization === "Bearer pesapal-jwt-1", "submitOrder uses bearer token");
        assert(body.currency === "USD", "submitOrder sends USD currency");
        assert(body.redirect_mode === "GET", "submitOrder redirect_mode GET");
        assert(body.notification_id === "ipn-1", "submitOrder sends registered notification_id");
        assert((body.billing_address as Record<string, unknown>).email_address === "buyer@example.com", "billing_address snake_case");
        res.end(
          JSON.stringify({
            order_tracking_id: "tracking-1",
            redirect_url: "https://pay.pesapal.com/payment/tracking-1",
            merchant_reference: body.id,
          }),
        );
        return;
      }
      if (req.method === "GET" && url.pathname === "/api/Transactions/GetTransactionStatus") {
        assert(url.searchParams.get("orderTrackingId") === "tracking-1", "status query uses orderTrackingId");
        res.end(
          JSON.stringify({
            status_code: 1,
            payment_status_description: "Completed",
            amount: body.amount ?? 150,
            confirmation_code: "conf-1",
          }),
        );
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/Refund/RefundRequest") {
        assert(req.headers.authorization === "Bearer pesapal-jwt-1", "refund uses bearer token");
        assert(body.confirmation_code === "conf-1", "refund sends confirmation_code");
        assert(body.amount === 150, "refund sends amount");
        res.end(JSON.stringify({ refund_id: "refund-1", refund_status: "INITIATED" }));
        return;
      }
      res.statusCode = 404;
      res.end(JSON.stringify({ error: "unknown route" }));
    });
  });

  await new Promise<void>((resolve) => server.listen(PORT, "127.0.0.1", resolve));

  try {
    const client = new PesapalClient({
      consumerKey: "consumer-key",
      consumerSecret: "consumer-secret",
      baseUrl: BASE_URL,
    });

    // 1. authenticate strips the "Bearer " prefix and caches the token
    const token = await client.authenticate();
    assert(token === "pesapal-jwt-1", "token stripped of Bearer prefix");

    // 2. registerIPN returns the ipn_id
    const ipnId = await client.registerIPN("https://api.example.com/webhooks/pesapal-ipn");
    assert(ipnId === "ipn-1", "registerIPN returns ipn_id");

    // 3. submitOrder uses the cached token (no re-auth) and returns tracking/redirect
    const order = await client.submitOrder({
      id: "order-1",
      amount: 150,
      description: "MarketLoop order-1",
      callbackUrl: "https://example.com/checkout/callback?orderId=order-1",
      notificationId: ipnId,
      billingAddress: { emailAddress: "buyer@example.com", firstName: "Alice", lastName: "M" },
    });
    assert(order.orderTrackingId === "tracking-1", "submitOrder returns order_tracking_id");
    assert(order.redirectUrl.includes("tracking-1"), "submitOrder returns redirect_url");
    assert(order.merchantReference === "order-1", "merchant_reference from response");
    assert(requestTokenCount === 1, "single auth for multiple calls");

    // 4. getTransactionStatus
    const status = await client.getTransactionStatus("tracking-1");
    assert((status as { status_code: number }).status_code === 1, "getTransactionStatus returns status_code");

    // 5. refundRequest
    const refund = await client.refundRequest({
      confirmationCode: "conf-1",
      amount: 150,
      username: "marketloop",
      remarks: "expired escrow",
    });
    assert((refund as { refund_id: string }).refund_id === "refund-1", "refundRequest returns refund_id");

    console.log("PESAPAL TESTS PASSED (auth, registerIPN, submitOrder, transaction status, refund request)");
  } finally {
    server.close();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
