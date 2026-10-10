# Handi — Architecture

Companion to `README.md` (which is the operational/getting-started guide). This
file documents how the system is put together and the engineering decisions that keep it running. Read this before touching cross-cutting concerns.

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
  everything lives in Firestore. Media in R2 (`IMAGES` binding → bucket
  `handi-assets`; presign uses `R2_BUCKET_NAME`, so the two must match), OTP
  codes in KV (`OTP_KV`), payments via Paypack/Pesapal HTTP APIs.

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
- `getDocWithTime` — like `getDoc` but also returns the document's `updateTime`
  so a later write can be race-checked against it (CAS precondition).
- `queryCollection` — `runQuery` with equality/range filters, one `orderBy`,
  `offset`, `limit`.
- `getManyDocs` — `documents:batchGet` (chunked at the 10-doc API limit).
  **Use this instead of a per-item `getDoc` loop**; list endpoints
  (`/bids/mine`, `/orders/mine`, `/orders/sales`, `/admin/orders`,
  `/products/:id/bids/all`) batch-read their referenced products/users instead
  of issuing N requests.
- `updateDocIf` — CAS patch: applies an update only when the document's current
  `updateTime` matches the caller's snapshot, otherwise the `:commit` returns a
  409. Used for wallet double-spend protection and bid/product transitions.
- `incrementField` — server-side numeric transform (`increment` field transform)
  so balance changes are applied atomically by Firestore, never read-modify-write.
- `commitWithCreate` — one `:commit` containing a CAS update + optional
  `increment` transforms + a document create. Used for the escrow release
  (order held→released + artisan `walletBalance` increment + wallet-transaction
  create applied in one request) and for `acceptBidAndReserve`.
- `commitWrites` — raw `:commit` writer; returns `false` when a CAS precondition
  fails (409), `true` on success. Exposes the full `.../documents` root URL for
  callers that need to reference server-created document ids.

### Concurrency & money movement

Firestore's REST API (like Firestore itself) has no multi-document
transactions, so every critical money move is done with **compare-and-set plus
server-side transforms in a single `:commit`** instead of read-modify-write:

- **Wallet withdraw** (`workers/src/lib/wallet.ts`): read the balance *and its
  `updateTime`* with `getDocWithTime`, validate sufficiency, then `updateDocIf`
  decrement via `incrementField`. A concurrent withdrawal loses the CAS and
  re-reads — no overdraft.
- **Escrow release** (`workers/src/lib/escrow.ts` `releaseToArtisan`): switches
  the order `held → released`, credits the artisan's `walletBalance` with an
  `increment`, and creates the `credit` transaction — one `:commit`. It returns
  `false` (no-op) when the order is no longer `held`, so concurrent
  double-confirms and admin force-releases credit the artisan exactly once
  (asserted by ordering test *E0*).
- **Bid accept** (`workers/src/lib/bids.ts` `acceptBidAndReserve`): CAS `bid: active → accepted` **and** `product: active → reserved` in one `:commit`; the
  artisan's accept and the buyer's withdraw race each other and exactly one
  branch wins. Re-accepts on an already-reserved product are idempotent.
- **Offer rows** (`workers/src/routes/product-bids.ts`): bids use a
  **deterministic document id `{productId}__{buyerId}`**, so two concurrent
  first-bids cannot create two rows — the loser of the create hits a 409 and
  revives/updates the existing row.

### Ordering ties

Firestore orders by a single field, so rows sharing the same value (e.g. two
chat messages written in the same millisecond) tie. `listMessages`
(`workers/src/lib/messages.ts`) breaks ties by document id for a deterministic
oldest-first thread. The in-memory test mocks mint zero-padded auto ids
(`auto-00000001`) so lexicographic id order equals insertion order and the
tie-break is reproducible in tests.

### Composite indexes

Firestore auto-indexes single fields but **equality + `orderBy`/range
combinations need composite indexes created in the Firebase console.** Queries
that require them (these must exist or the endpoints fail with a missing-index
error):

| Collection             | Fields                                                                                      |
| ---------------------- | ------------------------------------------------------------------------------------------- |
| `products`           | `status ASC, createdAt DESC` (feed — see README note)                                    |
| `products`           | `artisanId ASC, createdAt DESC` (`/products/mine`)                                      |
| `bids`               | `buyerId ASC, createdAt DESC` (`/bids/mine`)                                            |
| `bids`               | `productId ASC, status ASC` (accept path: withdraw other offers)                          |
| `orders`             | `buyerId ASC, createdAt DESC` (`/orders/mine`)                                          |
| `orders`             | `artisanId ASC, createdAt DESC` (`/orders/sales`)                                       |
| `orders`             | `escrowStatus ASC, createdAt DESC` (admin list with status filter)                        |
| `orders`             | `escrowStatus ASC, deliveryDeadline ASC` (**cron**: reminder + auto-refund queries) |
| `walletTransactions` | `userId ASC, createdAt DESC` (`/wallet`)                                                |
| `users`              | `verificationStatus ASC, createdAt ASC` (`/admin/verifications/pending`)                |

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

## Discovery, storefronts & demo data

- **Feed filtering** (`workers/src/routes/products.ts`): `GET /products` supports
  keyword `search` (against stored `titleKeywords`), `priceMin`/`priceMax`,
  `productType`, `tags`/`materials` (OR match, ≤10 each), `region` and `sortBy`
  (`newest`/`price_asc`/`price_desc`). The frontend keeps this filter state in
  `lib/exploreFilters.ts` (shared by the server page and the client feed).
- **Public storefronts** (`workers/src/routes/artisans.ts`): `GET /artisans`
  returns featured shops (queries `users` newest-first, keeps profiles that look
  like a shop, ranks by rating; default 8 / max 24); `GET /artisans/{uid}`
  returns the profile plus its active listings; `PATCH /artisans/me` lets an
  artisan edit their own storefront fields. Only public fields leave the API.
- **Crawlable discovery pages** (frontend): `/c/[category]` (one prerendered
  page per craft, `CollectionPage` + `BreadcrumbList` JSON-LD), `/artisan`
  (index) and `/artisan/[uid]` (`ProfilePage` JSON-LD). These give category and
  shop queries real canonical URLs — filtered `/explore?category=…` stays
  canonicalized to `/explore` so it never creates near-duplicate index pages.
- **Demo fallback** (`frontend/lib/dummyData.ts`): when the API is unreachable or
  a collection is empty, the homepage, `/explore` (unfiltered only), category and
  storefront pages render self-contained demo pieces (inline SVG `data:` URIs, no
  R2 object). Real data always wins; nothing is persisted.

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
(`firestoreMock`: `:runQuery`, `GET`, `PATCH`, `:batchGet`, and `:commit` with
CAS-precondition 409s, creates, and `increment` transforms), a mock JWKS, and
mock Paypack/Pesapal servers. A shared `nextTime()` bumps the mock clock so
concurrent-same-millisecond races are reproducible. **Each suite carries its own
copy of `firestoreMock`** — when you add a Firestore endpoint used by routes,
extend the mocks in every suite that exercises those routes.

Key race/idempotency coverage: three concurrent `releaseToArtisan` calls credit
once (orders *E0*); concurrent first-bids collapse to one row (bids);
concurrent bid-accepts yield exactly one success (bids); concurrent wallet
withdrawals can't overdraft (orders section G). The made-to-order passes
exercise the full production lifecycle — customization validation, deposit
pricing math, mark-ready for both plans, idempotent `pay-final` + final
webhook, cancellation accept/reject with the 25% artisan split, and the 3-day
forfeiture cron (backdated `productionStatusAt`, sections *H–H4*).

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
`processExpiredOrders` (`workers/src/lib/escrow.ts`). It warns both parties 24h
before a held order's delivery deadline, auto-refunds orders still held past it
(Paypack: immediate refund; Pesapal: refund request, finalized by their finance
team and confirmed via `/admin/orders/:id/mark-refunded`), and **cancels deposit
orders stuck in `awaiting_final_payment` for more than 3 days**
(`FINAL_PAYMENT_TIMEOUT_MS`): the artisan keeps the deposit, the buyer is
refunded the difference (no final payment was made, so there's nothing to claw
back) and the product returns to `active`.

## Made-to-order lifecycle

The two axes (escrow $ vs production state) run in parallel. `escrowStatus`
owns the money; `productionStatus` owns the work:

```
deposit plan:  create → buyer pays deposit (50% of total) → in_production
               → mark-ready → awaiting_final_payment → pay-final (3-day limit)
               → awaiting_delivery (5-day confirm window) → released/refunded

full plan:     create → buyer pays totalPaid up front → in_production
               → mark-ready → awaiting_delivery (5-day confirm window)
               → released/refunded
```

- **`POST /orders`** validates `productionTimeDays` is present on the product
  and the `customizationResponses` satisfy the product's `customizationOptions`
  (missing required / invalid choice → 400, max 30 responses). Extra reference
  image + request note are capped (`MAX_REFERENCE_URL` 500, `MAX_REQUEST_NOTE`
  2000). The price math is `agreedAmount + deliveryFee + (sum of answered options' priceAdjustment)`, split 50/50 for the deposit plan.
- **Deposit plan**: the webhook confirmation sets `depositPaid` and the order
  to `in_production` (no `deliveryDeadline` yet — there's no rush while the
  piece is being made). **Full plan**: the usual held + deadline path.
- **`mark-ready`** (artisan): deposit plan → `awaiting_final_payment`;
  full plan → `awaiting_delivery` + 5-day deadline. `pay-final` charges the
  remaining balance and is **idempotent while the charge is in-flight**
  (`finalPaymentReference`); the final webhook moves the order to
  `awaiting_delivery` and starts the confirm clock. Anything that fails the
  charge (webhook error / mismatch / reversed) clears `finalPaymentReference`
  so the buyer can retry.
- **Confirmations are gated on production**: `can-confirm` / `confirm-delivery`
  refuse while the piece isn't `awaiting_delivery` (returning the pending
  `productionStatus` / `finalPaymentPending` flags to the frontend).
- **Cancellation** (buyer, only during `in_production`, one request per order):
  the artisan responds `{ accept }`. On accept, escrow is split — the artisan
  keeps **25% of the order total**, the buyer is refunded the remainder against
  the actual debit (`deposit` was half → buyer walks with the other 25%;
  `full` → buyer gets 75% back), the product is relisted, and each side gets a
  `cancellation_*` notification. Reject resumes production.
- **Forfeiture**: no final payment within 3 days → `cancelled_forfeited`, the
  artisan keeps the deposit, product relisted (see Cron).
