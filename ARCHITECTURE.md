# MarketLoop — Architecture

Companion to `README.md` (which is the operational/getting-started guide). This
file documents how the system is put together and the engineering decisions that
keep it running. Read this before touching cross-cutting concerns.

## System overview

Two deployables in one monorepo:

```
                      ┌─────────────────────┐
                      │  Next.js frontend   │   Vercel / Node
                      │  (App Router, RSC)  │
                      └──────────┬──────────┘
                                 │ fetch (public + Bearer ID token)
                                 ▼
                      ┌─────────────────────┐
                      │  Hono on Workers    │   Cloudflare Workers
                      │  (stateless, REST)  │
                      └──┬──────┬──────┬────┘
                         │      │      │
              Firestore  │   R2  │   KV │   Paypack (MoMo) / Pesapal (cards)
              REST +     │  media│  OTP │   + Google JWKS (token verify)
              service    │  presign    │
              account JWT│             ▼
                         │      hourly cron → auto-refund expired escrow
                         ▼
```

- **Frontend** (`frontend/`): Next.js App Router, TypeScript, Tailwind v4,
  Firebase client SDK for Google sign-in. Public data (product feeds, detail,
  sitemap) is fetched server-side with `lib/publicApi.ts` so server components
  never pull the Firebase client into their bundle. Authenticated calls go
  through `lib/api.ts`, which attaches the Firebase ID token.
- **Workers** (`workers/`): a single Hono app. No persistent runtime state —
  everything lives in Firestore. Media in R2, OTP codes in KV, payments via
  Paypack/Pesapal HTTP APIs.

## Authentication

- Google sign-in happens in the browser (Firebase client SDK); the frontend
  sends the resulting ID token on every authenticated request.
- `workers/src/lib/firebase-auth.ts` verifies tokens by hand (Web Crypto, no
  Admin SDK): RS256 signature against Google's JWKS, issuer/audience/expiry.
  **JWKS responses are cached in-memory with a TTL** so cold-start + verify
  stays fast and we don't hammer Google's endpoint.
- `workers/src/middleware/auth.ts` attaches the verified user as
  `c.get("user")`; `middleware/admin.ts` additionally requires
  `isAdmin: true` on the Firestore profile for `/admin/*`.

## Firestore access

`workers/src/lib/firestore.ts` is a minimal hand-rolled REST client (the Admin
SDK can't run on Workers). It signs a service-account JWT with Web Crypto and
speaks to the Firestore REST API. Typed helpers:

- `getDoc` / `createDoc` / `updateDoc` — single-document reads/writes.
- `queryCollection` — `runQuery` with equality/range filters, one `orderBy`,
  `offset`, `limit`.
- `getManyDocs` — `documents:batchGet` (chunked at the 10-doc API limit).
  **Use this instead of a per-item `getDoc` loop**; list endpoints
  (`/bids/mine`, `/orders/mine`, `/orders/sales`, `/admin/orders`) batch-read
  their referenced products/users instead of issuing N requests.

### Composite indexes

Firestore auto-indexes single fields but **equality + `orderBy`/range
combinations need composite indexes created in the Firebase console.** Queries
that require them (these must exist or the endpoints fail with a missing-index
error):

| Collection | Fields |
| ---------- | ------ |
| `products` | `status ASC, createdAt DESC` (feed — see README note) |
| `products` | `sellerId ASC, createdAt DESC` (`/products/mine`) |
| `bids` | `buyerId ASC, createdAt DESC` (`/bids/mine`) |
| `bids` | `productId ASC, status ASC` (accept path: withdraw other offers) |
| `orders` | `buyerId ASC, createdAt DESC` (`/orders/mine`) |
| `orders` | `sellerId ASC, createdAt DESC` (`/orders/sales`) |
| `orders` | `escrowStatus ASC, createdAt DESC` (admin list with status filter) |
| `orders` | `escrowStatus ASC, deliveryDeadline ASC` (**cron**: reminder + auto-refund queries) |
| `walletTransactions` | `userId ASC, createdAt DESC` (`/wallet`) |
| `users` | `verificationStatus ASC, createdAt ASC` (`/admin/verifications/pending`) |

## Caching & performance

- `workers/src/lib/cache.ts`: best-effort TTL cache over the Workers Cache API
  (`caches.default`). **No-ops where `caches` is undefined** (Node-based tests,
  local dev), so tests always exercise the real Firestore path. Failures always
  fall through. Used for `GET /products` and `GET /products/:id` (30s TTL).
- N+1 reads are avoided with `getManyDocs` (above).
- List endpoints support opt-in pagination (`limit` + `before` cursor on
  `/wallet`, `/bids/mine`, `/admin/verifications/pending`) that is fully
  backward compatible — no params means the previous "return everything"
  behaviour.
- Frontend images render through `next/image` with remote patterns configured
  in `next.config.ts`; the sell form downscales/compresses photos client-side
  (`prepareImageFile`, ~1600px WebP) before presigned upload so phone photos
  stay under the 5MB cap.

## Error handling & validation

- Workers error contract is intentionally flat: `{ error: string }` (+ optional
  extras) via `workers/src/lib/http.ts` `httpError()`. Do not reshape it.
- Request validation is hand-rolled (no zod dependency) and consolidated in
  `workers/src/lib/validation.ts`: `asString`, `asBoolean`, `asNumber`,
  `asOneOf`, all throwing `BadRequestError` which routes map to 400s.
- `workers/src/lib/env.ts` validates required bindings/secrets on `/health`
  (cold path only) so a misconfigured deployment reports itself instead of
  failing on the first real request.

## Types — keep in sync

There is intentionally **no `shared/` package**. The domain types live in two
files that must stay identical:

- `workers/src/models.ts`
- `frontend/types/index.ts`

Both carry a "Keep in sync with the other" header. When a field or status
value changes, update both. The FE depends on the API's JSON; there is no code
generation between them.

## Testing & verification

Workers E2E suites (`workers/scripts/test-*.ts`) run the real Hono app via
`app.request(...)` against in-memory mocks: a mock Firestore REST server
(`firestoreMock`: `:runQuery`, `GET`, `PATCH`, `:batchGet`), a mock JWKS, and
mock Paypack/Pesapal servers. **Each suite carries its own copy of
`firestoreMock`** — when you add a Firestore endpoint used by routes, extend the
mocks in every suite that exercises those routes.

```bash
# Frontend: lint + production build
cd frontend && npm run lint && npm run build

# Workers: typecheck (src + scripts) + all 10 test suites
cd workers && npm run typecheck && npm test
```

## Phone & identity verification

Verification is informational — it never gates selling. It has three parts:

- **Phone OTP** (`workers/src/routes/verifications.ts`): a 6-digit code is
  stored in the `OTP_KV` KV namespace (10-min TTL, 60s resend limit, max 5
  tries, single-use) and "sent" via `workers/src/lib/sms.ts`, which is a
  **stub that logs to the console** — swap in a real provider by editing
  `sendSms`. Confirming marks `phoneVerifiedAt` on the user profile.
- **ID documents**: uploaded via presigned PUT into `id-documents/{uid}/` (R2).
  These keys are **not** served by the public `/media` route; users and admins
  view them through short-lived signed GET URLs.
- **Admin review** (`workers/src/routes/admin.ts`): `GET /admin/verifications/pending`
  (paginated) lists submissions; `approve`/`reject` set
  `verificationStatus = verified | rejected` (with an optional `reason`) and
  fire `verification_approved` / `verification_rejected` notifications.
  The `users (verificationStatus ASC, createdAt ASC)` composite index backs the
  pending list.

## Cron

Hourly `scheduled` handler (`workers/src/index.ts`, wrangler.toml) →
`processExpiredOrders` (`workers/src/lib/escrow.ts`): warns both parties 24h
before a held order's delivery deadline, then auto-refunds orders still held
past it (Paypack: immediate refund; Pesapal: refund request, finalized by their
finance team and confirmed via `/admin/orders/:id/mark-refunded`).
