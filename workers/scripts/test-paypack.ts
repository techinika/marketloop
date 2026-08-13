// Unit tests for the Paypack client against a local mock API.
// Run with: npm run test:paypack

import { createServer } from "node:http";

import { PaypackClient } from "../src/lib/paypack";

const PORT = 8810;
const BASE_URL = `http://127.0.0.1:${PORT}`;

interface RecordedRequest {
  path: string;
  method: string;
  authorization: string | null;
  idempotencyKey: string | null;
  body: Record<string, unknown>;
}

const requests: RecordedRequest[] = [];
const transactions = new Map<string, Record<string, unknown>>();

const encoder = new TextEncoder();

function base64UrlEncode(input: string | Uint8Array): string {
  const bytes = typeof input === "string" ? encoder.encode(input) : input;
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmacBase64(body: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

async function main(): Promise<void> {
  let authorizeCount = 0;
  let refreshCount = 0;

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
        idempotencyKey: (req.headers["idempotency-key"] as string | undefined) ?? null,
        body,
      });

      res.setHeader("Content-Type", "application/json");

      if (req.method === "POST" && url.pathname === "/auth/agents/authorize") {
        authorizeCount++;
        res.end(JSON.stringify({ access: "access-1", refresh: "refresh-1", expires: 900 }));
        return;
      }
      if (req.method === "GET" && url.pathname.startsWith("/auth/agents/refresh/")) {
        refreshCount++;
        res.end(JSON.stringify({ access: "access-2", refresh: "refresh-2", expires: 900 }));
        return;
      }
      if (req.method === "POST" && (url.pathname === "/transactions/cashin" || url.pathname === "/transactions/cashout")) {
        const kind = url.pathname === "/transactions/cashin" ? "CASHIN" : "CASHOUT";
        const idem = (req.headers["idempotency-key"] as string) ?? "none";
        const tx = {
          id: `tx-${idem}`,
          ref: `${kind.toLowerCase()}-${idem}`,
          amount: body.amount,
          number: body.number,
          environment: body.environment,
          status: "PENDING",
          kind,
        };
        transactions.set(tx.ref, tx);
        res.end(JSON.stringify(tx));
        return;
      }
      if (req.method === "GET" && url.pathname.startsWith("/transactions/find/")) {
        const ref = decodeURIComponent(url.pathname.replace("/transactions/find/", ""));
        const tx = transactions.get(ref);
        if (!tx) {
          res.statusCode = 404;
          res.end(JSON.stringify({ error: "not found" }));
          return;
        }
        res.end(JSON.stringify(tx));
        return;
      }
      res.statusCode = 404;
      res.end(JSON.stringify({ error: "unknown route" }));
    });
  });

  await new Promise<void>((resolve) => server.listen(PORT, "127.0.0.1", resolve));

  try {
    const client = new PaypackClient({
      clientId: "client-id",
      clientSecret: "client-secret",
      baseUrl: BASE_URL,
      environment: "development",
      webhookSecret: "webhook-secret",
    });

    // 1. authenticate + token reuse
    const tokens = await client.authenticate();
    assert(tokens.access === "access-1" && tokens.refresh === "refresh-1", "authenticate tokens");
    assert(authorizeCount === 1, "authorize should be called once");

    // 2. cashin with idempotency key; reuses the cached token (no new authorize)
    const cashin = await client.cashin(50000, "0788123456", "order-1");
    assert(cashin.ref === "cashin-order-1", "cashin ref derived from idempotency key");
    assert(authorizeCount === 1, "cashin should reuse the cached token");
    const cashinReq = requests.find((r) => r.path === "/transactions/cashin");
    assert(cashinReq?.authorization === "Bearer access-1", "cashin uses Bearer access token");
    assert(cashinReq?.idempotencyKey === "order-1", "cashin sends Idempotency-Key");
    assert(cashinReq?.body.environment === "development", "cashin sends environment");

    // 3. cashout
    const cashout = await client.cashout(20000, "0788123456", "withdraw-user-tx1");
    assert(cashout.ref === "cashout-withdraw-user-tx1", "cashout ref");

    // 4. findTransaction
    const found = await client.findTransaction("cashin-order-1");
    assert((found as { status: string }).status === "PENDING", "findTransaction returns tx");

    // 5. refresh path (as if the token expired)
    const refreshed = await client.refresh("refresh-1");
    assert(refreshed.access === "access-2", "refresh returns new access token");
    assert(refreshCount === 1, "refresh called once");

    // 6. webhook signature verification
    const rawBody = JSON.stringify({ ref: "cashin-order-1", status: "successful", kind: "CASHIN" });
    const goodSig = await hmacBase64(rawBody, "webhook-secret");
    const badSig = await hmacBase64(rawBody, "wrong-secret");
    assert(await client.verifyWebhookSignature(rawBody, goodSig), "valid signature accepted");
    assert(!(await client.verifyWebhookSignature(rawBody, badSig)), "wrong signature rejected");
    assert(!(await client.verifyWebhookSignature(rawBody, null)), "missing signature rejected");

    console.log("PAYPACK TESTS PASSED (authorize, token cache + refresh, cashin/cashout idempotency, find, HMAC webhook signature)");
  } finally {
    server.close();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
