# MarketLoop

A peer-to-peer second-hand marketplace app. Buy and sell used goods directly between users.

## Monorepo structure

```
PROJ/
  frontend/   -> Next.js (App Router, TypeScript, Tailwind CSS)
  workers/    -> Cloudflare Workers (TypeScript, Hono)
```

| Folder      | Purpose                                                                 |
| ----------- | ----------------------------------------------------------------------- |
| `frontend/` | Web app: UI, Google login (Firebase client SDK), product listing, Explore feed, bidding/buying, checkout, orders, wallet, in-app notifications, user dashboard, admin panel |
| `workers/`  | API: auth, products, uploads/media, bids, orders (escrow + per-order chat), wallet, payment webhooks, notifications, phone/identity verification, admin, hourly refund cron. Talks to Firestore via its REST API |

## Getting started

Each folder is an independent project and must be started separately.

### Frontend

```bash
cd frontend
npm install
cp .env.example .env.local   # public web config, values pre-filled
npm run dev
```

Open http://localhost:3000.

### Workers

```bash
cd workers
npm install
cp .dev.vars.example .dev.vars   # fill in real values
npm run dev
```

This runs `wrangler dev` — the API is served at http://localhost:8787.
Health check: http://localhost:8787/health

#### Secrets & bindings

Secrets are **not** committed. Set them locally in `.dev.vars` (see `.dev.vars.example`)
or via `wrangler secret put <NAME>` for deployed environments:

- `FIREBASE_PROJECT_ID` (non-secret, lives in `[vars]`)
- `FIREBASE_CLIENT_EMAIL` — Firestore service account client email
- `FIREBASE_PRIVATE_KEY` — Firestore service account private key (PEM)
- `R2_ACCOUNT_ID` (non-secret) + `R2_BUCKET_NAME` (non-secret, lives in `[vars]`)
- `R2_ACCESS_KEY_ID` — R2 API token (Custom S3 API) for presigned uploads
- `R2_SECRET_ACCESS_KEY`
- `PAYPACK_CLIENT_ID` — Paypack (mobile money) API
- `PAYPACK_CLIENT_SECRET`
- `PAYPACK_WEBHOOK_SECRET` — shared secret used to verify `X-Paypack-Signature` on webhooks
- `PAYPACK_BASE_URL` / `PAYPACK_ENVIRONMENT` — optional overrides (`development` is the default environment sent on cashin/cashout)
- `PESAPAL_CONSUMER_KEY` — Pesapal (cards / mobile money) API
- `PESAPAL_CONSUMER_SECRET`
- `PESAPAL_BASE_URL` / `PESAPAL_IPN_ID` — optional overrides; the IPN is otherwise registered once and cached in Firestore
- `FRONTEND_URL` (non-secret, lives in `[vars]`) — origin used for Pesapal callback + IPN URLs (default `http://localhost:3000`)

R2 bucket binding: `IMAGES` (bucket `marketloop-images`) for product images/videos.

KV namespace binding: `OTP_KV` for phone-verification codes (create it in the
Cloudflare dashboard and paste its id into `wrangler.toml`).

> `GET /health` validates that the required secrets and bindings above are
> present and returns `500 { status: "degraded", problems }` listing anything
> missing (see `workers/src/lib/env.ts`). A healthy deployment returns
> `200 { status: "ok" }`.

Phone-verification SMS is a **stub**: `workers/src/lib/sms.ts` logs the message
to the console instead of sending it. Swap in a provider (Twilio / Africa's
Talking / Termii / Vonage) by editing `sendSms` — no caller changes.

### API routes

| Route                    | Auth   | Description |
| ------------------------ | ------ | ----------- |
| `GET /health`            | public | Health check; validates required secrets/bindings, reports `{ status: "degraded", problems }` (500) when any are missing |
| `GET /auth/me`           | user   | Current user from verified ID token; includes `isAdmin` (true only when the Firestore profile has `isAdmin: true`) |
| `POST /uploads/presign`  | user   | Returns presigned PUT URLs for direct R2 uploads (images ≤5MB each / max 6, video ≤50MB / max 1) |
| `GET /media/{key}`       | public | Serves an R2 object by key |
| `POST /products`         | user   | Creates a listing (status defaults to `active`) |
| `GET /products`          | public | Explore feed: newest first, `page`/`pageSize`, filters `category`, `currency`, `isBiddingEnabled` |
| `GET /products/{id}`     | public | Detail + seller public info (name/photo only — no email/phone) |
| `PATCH /products/{id}`   | seller | Edit listing fields or status (403 for non-sellers) |
| `GET /products/mine`     | seller | The seller's own listings (all statuses), expired reservations reverted |
| `POST /products/{id}/bids`      | user   | Create or update the caller's active offer (bidding-enabled products only; buyer cannot bid on own item; currency must match) |
| `GET /products/{id}/bids`       | public | Anonymous bid summary: `bidCount`, `highestBid`, `currency` (no bidder identities) |
| `GET /products/{id}/bids/mine`  | user   | The caller's own active offer on the product, or `null` |
| `GET /products/{id}/bids/all`   | seller | All active offers + bidder name/photo, highest first (403 for non-sellers) |
| `POST /products/{id}/reserve`   | user   | Direct buy on a non-bidding product: reserves it 15 min and returns `checkout` info (idempotent for the same buyer) |
| `GET /bids/mine`        | user   | All of the caller's offers across products, newest first, with product info (`limit` max 100 + `before` cursor, see `/wallet`) |
| `POST /bids/{bidId}/accept`   | seller | Accept an offer: it becomes `accepted`, others are withdrawn, product is reserved; returns `checkout` info |
| `POST /bids/{bidId}/withdraw` | buyer  | Withdraw the caller's own active offer |
| `POST /orders`              | buyer  | Starts payment for the caller's reservation. RWF: Paypack cashin to `phoneNumber`, returns the order; USD: Pesapal hosted page, returns `redirect_url`. `totalPaid = agreedAmount + deliveryFee`. Dedupes a pending order and reuses a failed one |
| `GET /orders/{id}`          | buyer/seller | Order detail + product/party summaries; used for frontend polling after payment |
| `GET /orders/{id}/messages` | buyer/seller | Order-thread chat messages (chronological) |
| `POST /orders/{id}/messages` | buyer/seller | Append a message to the order thread |
| `POST /orders/{id}/messages/read` | buyer/seller | Marks the caller's incoming messages as read |
| `GET /orders/{id}/can-confirm` | buyer/seller | Whether the caller can still confirm delivery (deadline not passed, status `held`) |
| `POST /orders/{id}/confirm-delivery` | buyer/seller | Records the caller's confirmation. When **both** confirm, escrow is released and the seller's wallet is credited |
| `GET /orders/mine`        | user   | All of the caller's purchases, newest first, with product summary (dashboard) |
| `GET /orders/sales`       | user   | All of the caller's sales, newest first, with product + buyer summary (dashboard) |
| `GET /wallet`               | user   | The caller's balance + transaction history (newest first). Pass `limit` (max 100) and `before` (a `createdAt` ISO cursor from a previous `nextPageToken`) to page backwards; omitted params return everything |
| `POST /wallet/withdraw`     | user   | RWF withdrawal via Paypack cashout to a MoMo number (debit-first; balance restored + transaction reclassified if the cashout fails) |
| `POST /verifications/phone/request` | user | Sends a 6-digit OTP by SMS to a phone number (60s resend limit, 10-min expiry; code lives in `OTP_KV`) |
| `POST /verifications/phone/confirm` | user | Checks the OTP (max 5 tries, single-use) and marks the phone verified on the profile |
| `POST /verifications/id/presign` | user | Presigned PUT URL for an ID-document image (≤5MB, jpg/png/webp), stored under `id-documents/{uid}/` (not publicly served) |
| `POST /verifications/id/request` | user | Submits the uploaded ID document for admin review (409 if already pending/verified) |
| `GET /verifications/me`       | user | The caller's verification state (phone, `verificationStatus`, document type, review note) |
| `POST /verifications/me/id/sign-url` | user | Signed GET URL for the caller's own ID document |
| `POST /webhooks/paypack`    | public (HMAC) | Paypack status webhook. Signature-verified (`X-Paypack-Signature`). Successful CASHIN → order `held` + product `sold`; failed → order `failed` + product `active` |
| `GET/POST /webhooks/pesapal-ipn` | public | Pesapal IPN. Polls the transaction by `orderTrackingId`; `status_code` 1 = held+sold, 2/3 = failed+active. Responds with Pesapal's expected IPN JSON |
| `GET /notifications`       | user   | The caller's in-app notifications, newest first (`page`/`pageSize`) |
| `POST /notifications/{id}/read` | user   | Marks one of the caller's notifications as read (403 if it isn't theirs) |
| `POST /notifications/read-all` | user   | Marks all of the caller's notifications as read |
| `GET /admin/orders`        | admin  | All escrow orders, filterable by `status`; needs-attention orders pinned first (see below) |
| `GET /admin/orders/{id}`   | admin  | Order + product + buyer + seller + linked wallet transactions |
| `POST /admin/orders/{id}/mark-refunded` | admin | Confirms a provider refund on a `refund_requested` order (409 otherwise). Idempotent refund transaction; reactivates the sold product; writes `adminNote`/`adminUid`/`adminActionAt` audit fields |
| `POST /admin/orders/{id}/force-release` | admin | Releases escrow to the seller without both-party confirmation (`held` only; non-empty `adminNote` required) |
| `GET /admin/users`         | admin  | Paginated user list with wallet balance, isAdmin flag, product/order counts; `search` by name/email |
| `GET /admin/stats`         | admin  | Active listings, pending/held orders, refund-attention count, GMV this month (RWF + USD) |
| `GET /admin/verifications/pending` | admin | Identity submissions awaiting review, oldest first (`limit` max 100 + `before` cursor) |
| `POST /admin/verifications/{uid}/approve` | admin | Marks a pending submission `verified` (409 otherwise) and notifies the user |
| `POST /admin/verifications/{uid}/reject` | admin | Rejects a pending submission with a required `reason` and notifies the user |

A "needs attention" order (`GET /admin/orders`) is one that is `refund_requested` in USD
(awaiting manual provider refund) or `held` within 24h of its delivery deadline without
both confirmations — these are sorted to the top of the list.

**Cron trigger** (hourly, `wrangler.toml`): `processExpiredOrders` first warns both
parties when a `held` order is within 24h of its 5-day `deliveryDeadline` and isn't
double-confirmed (in-app notification). It then finds orders still `held` past the
deadline without both confirmations and refunds the buyer. Paypack refunds push money
back immediately (`refunded`); Pesapal only accepts a refund *request*
(`refund_requested` — finalized by their finance team, then confirmed by an admin via
mark-refunded). Products are reverted to `active` and their reservation cleared.

> Note: several queries need **composite indexes** in a real Firestore project
> (e.g. `GET /products` uses `status ASC, createdAt DESC`). The full required
> list — including the cron's `orders (escrowStatus ASC, deliveryDeadline ASC)`
> — is in [ARCHITECTURE.md](ARCHITECTURE.md) → Composite indexes. Create them in
> the Firebase console or the affected endpoints fail with a missing-index error.

## Pages

| Route            | Description |
| ---------------- | ----------- |
| `/`              | Homepage + auth demo (`AuthPanel`) |
| `/explore`       | Public Explore feed: grid of listings, category/currency/bidding filters, Load more |
| `/sell/new`      | Seller listing form: drag-drop photo upload (reorder/remove), optional video, price (RWF/USD), delivery options |
| `/product/[id]`  | Listing detail: gallery, price, badges, description, delivery info, seller card; bid panel (make/update/withdraw offers) or Buy now (reserve) |
| `/my-bids`       | Buyer dashboard: all offers with status, withdraw active ones, checkout when accepted |
| `/sell/my-listings` | Seller dashboard: own listings with status badges, manage offers per bidding listing |
| `/sell/my-listings/[id]/bids` | Seller's offers for one listing, sorted highest first, Accept |
| `/checkout/[productId]` | Real checkout for a reserved item: RWF shows a mobile-money number field (Paypack sends a payment request to that phone; the page polls until payment confirms) · USD redirects to the Pesapal hosted page |
| `/checkout/callback`    | Pesapal redirect landing page: polls the order until payment settles, then links to the order page |
| `/orders/[id]`          | Order status in plain language (held in escrow / released / refunded / etc.), delivery-confirm buttons for both parties, and a 5-day countdown |
| `/account/verification` | Identity verification: verify a phone number via OTP, then upload an ID document (national ID / passport / driving licence) for admin review — status badge + rejection reason |
| `/wallet`               | Luma-style wallet: available balance, activity (sales/withdrawals/refunds), RWF withdrawal to mobile money |
| `/dashboard`            | User dashboard: sales + purchases with escrow status, quick links to bids/wallet (see header account menu) |
| `/admin`                | Admin overview: active listings, pending/held orders, refund attention, GMV this month (RWF + USD) |
| `/admin/orders`         | All escrow orders (needs-attention pinned first), filter by status, link to detail |
| `/admin/orders/[id]`    | Order detail + parties + wallet transactions; Mark refunded / Force release actions (audited) |
| `/admin/users`          | Searchable user list with wallet, role, product/order counts |

Admin area is gated: only users with `isAdmin: true` on their Firestore profile see the
**Admin** link and pass the `/admin` guard; others are redirected to `/explore`. The
header bell shows unread notifications (badge, 30s + focus polling), marks items read on
click, and deep-links to the related order or product.

## Authentication flow

1. User clicks **Sign in with Google** on the frontend (Firebase client SDK, popup).
2. On success the frontend gets the Firebase **ID token** and attaches it to every
   request to the Workers API: `Authorization: Bearer <idToken>` (`frontend/lib/api.ts`).
3. The worker verifies the token manually (`workers/src/lib/firebase-auth.ts`): it fetches
   Google's public JWKS, validates the RS256 signature, issuer, audience (the Firebase
   project id) and expiry with the Web Crypto API — no Admin SDK, no Node crypto.
4. Verified users are attached to the request context as `c.get("user")`
   (`workers/src/middleware/auth.ts`).

Test it: sign in on the homepage, then press **Verify with GET /auth/me**
→ `GET /auth/me` (protected) returns `{ user: { uid, email, name, picture } }`.

## Firestore data model

Collections (see `workers/src/models.ts` and `frontend/types/index.ts`):

| Collection            | Document id | Key fields |
| --------------------- | ----------- | ---------- |
| `users`               | `{uid}`     | uid, name, email, photoUrl, phone, phoneVerifiedAt?, walletBalance, isAdmin?, rating, avgRating?, ratingCount?, verificationStatus (unverified/pending/verified/rejected), idDocumentType?, idDocumentKey?, verificationSubmittedAt?, verificationReviewedAt?, verificationNote?, createdAt, updatedAt? |
| `products`            | `{productId}` | sellerId, title, description, category, priceAmount, priceCurrency (USD/RWF), isNegotiable, isBiddingEnabled, conditionNote, images[], videoUrl, deliveryFee, deliveryFeePayer, status, reservedBy, reservedUntil, createdAt, updatedAt |
| `bids`                | `{bidId}`   | productId, buyerId, amount, currency, status (active/withdrawn/accepted), createdAt, updatedAt |
| `orders`              | `{orderId}` | productId, sellerId, buyerId, agreedAmount, currency, deliveryFee, deliveryFeePayer, totalPaid (= agreedAmount + deliveryFee, always charged to the buyer), paymentProvider (paypack/pesapal), paymentReference, buyerPhoneNumber, escrowStatus (pending_payment/held/released/refunded/refund_requested/failed), buyerConfirmedDelivery, sellerConfirmedDelivery, deliveryDeadline, buyerFeedback?, sellerFeedback? (rating 1-5 + comment), hasDispute?, disputeReason?, createdAt, updatedAt, adminAction/adminNote/adminUid/adminActionAt? (set by manual admin actions) |
| `messages`            | `{messageId}` | orderId, senderId, senderRole (buyer/seller), text, isRead, createdAt — per-order chat thread |
| `walletTransactions`  | `{txId}`    | userId, orderId, type (credit/debit/refund), amount, currency, createdAt |
| `notifications`       | `{notificationId}` | userId, type (bid_placed/bid_accepted/bid_not_selected/payment_held/escrow_released/order_refunded/delivery_deadline/verification_approved/verification_rejected), title, message, relatedOrderId, relatedProductId, isRead, createdAt |
| `platform`            | `pesapal-ipn` | notificationId, url, createdAt — cached Pesapal IPN registration |

**Escrow money flow** (see `workers/src/lib/escrow.ts`): the buyer always pays
`totalPaid = agreedAmount + deliveryFee`. At release, the seller's settlement depends on
`deliveryFeePayer`: `buyer` → seller receives the full `agreedAmount`; `seller` → the
seller absorbs the courier and receives `agreedAmount - deliveryFee`.

The Workers API talks to Firestore via its REST API (`workers/src/lib/firestore.ts`),
authenticating with a manually-signed service-account JWT. Typed helpers:
`getDoc`, `createDoc`, `updateDoc`, `queryCollection`, `getManyDocs`
(batch `documents:batchGet`, chunked at 10 — use it instead of per-item read
loops in list endpoints).

## Seeding sample data

Requires a Firestore service account (client email + private key) in `workers/.dev.vars`:

```bash
cd workers
npm run seed
```

Creates one sample user (`seed-user-001`) and one sample product
(`seed-product-001`), then reads them back and queries active products.

## Tests (no real Firebase needed)

```bash
cd workers
npm test
```

- `npm run test:auth` — mints RS256 JWTs with Firebase-shaped claims and runs them
  through the real verifier + middleware + `/me` route against a local mock JWKS
  (covers valid, expired, wrong-audience, wrong-issuer, tampered, missing-token).
- `npm run test:firestore` — exercises `createDoc` / `getDoc` / `updateDoc` /
  `queryCollection` (incl. `offset` pagination) against an in-memory mock of the
  Firestore REST API.
- `npm run test:presign` — SigV4 presigner against AWS's published test vector,
  plus R2 presigned URL shape, determinism and expiry clamping.
- `npm run test:products` — full Hono app against mock JWKS + mock Firestore:
  auth on create/presign, validation, public feed + filters, detail with seller
  info, seller-only PATCH, `removed` hiding, presign batch/limits, media serving.
- `npm run test:bids` — full Hono app against mock JWKS + mock Firestore:
  place/update/withdraw offers (incl. self-bid, currency and non-bidding
  rejections), anonymous public summary, seller's sorted bid view + accept →
  product reserved + others withdrawn, direct-buy reserve (incl. idempotency
  and 15-min expiry reversion), `/products/mine`, `/bids/mine`.
- `npm run test:paypack` — Paypack client against a local mock API: authorize +
  token cache/refresh, cashin/cashout with `Idempotency-Key`, find, and
  HMAC-SHA256 webhook signature verification.
- `npm run test:pesapal` — Pesapal client against a local mock API: auth,
  RegisterIPN, SubmitOrderRequest (redirect/tracking id), transaction status,
  refund request.
- `npm run test:orders` — full Hono app against mock JWKS + mock Firestore +
  mock Paypack/Pesapal servers: order creation (RWF cashin idempotency, USD
  redirect + IPN registration caching), signature/access guards, webhook +
  IPN state transitions, delivery-confirm release for both `deliveryFeePayer`
  variants, scheduled auto-refund (Paypack `refunded` vs Pesapal
  `refund_requested`), provider-down 502 + retry reuse, and wallet
  withdrawals incl. balance-restore on cashout failure.
- `npm run test:admin` — full Hono app against mock JWKS + mock Firestore +
  mock Paypack/Pesapal: `isAdmin` gate + `/auth/me` flag, notification
  triggers (bid placed/accepted/not-selected, payment held, escrow release,
  refund, 24h deadline warning) + read/read-all/ownership semantics, admin
  orders list (needs-attention ordering, status filter) + detail, mark-refunded
  (idempotent, audited, product reactivation), force-release (note required,
  wallet credit), users list + search, stats, and the `/orders/mine` +
  `/orders/sales` dashboard endpoints.
- `npm run test:verifications` — full Hono app against mock JWKS + mock
  Firestore + mock KV: OTP request (rate limit) / confirm (single-use, max
  attempts, wrong-code) + phone verified on profile, ID presign (type/size
  validation, key prefix) + submit (conflict guards), `/verifications/me`,
  admin pending list (with pagination) + approve/reject (conflict guards +
  notifications).

## Current status

- [x] Monorepo folder structure (`frontend` + `workers`)
- [x] Next.js frontend with Tailwind theme, Geist font, homepage
- [x] Cloudflare Workers API skeleton with Hono, `/health`, placeholder route modules
- [x] Firestore REST client with Web Crypto JWT auth (no Node crypto)
- [x] Google Sign-In (frontend) + ID-token verification middleware + `GET /auth/me` (workers)
- [x] Firestore data model types + typed helpers + seed script + verification tests
- [x] R2 media: SigV4 presigned uploads (`POST /uploads/presign`), public serving (`GET /media/*`)
- [x] Product listings: create (`POST /products`), edit (`PATCH /products/:id`), seller-only
- [x] Explore feed: `GET /products` with category/currency/bidding filters + pagination
- [x] Sell form (`/sell/new`) with drag-drop photo upload + R2 presigned upload flow
- [x] Product detail page (`/product/[id]`) with gallery, seller info, bid panel + Buy now
- [x] Bidding: offers (place/update/withdraw), anonymous public summary, seller accept → reserve
- [x] Direct-buy reservation (15-min hold) + real checkout (`/checkout/[productId]`)
- [x] Buyer dashboard (`/my-bids`) + seller dashboards (`/sell/my-listings`, `/sell/my-listings/[id]/bids`)
- [x] Orders & payments: Paypack cashin (RWF) + Pesapal hosted page (USD), order dedupe/retry reuse
- [x] Webhooks: Paypack signature-verified cashin/cashout webhook + Pesapal IPN, both reconcile orders
- [x] Escrow: payment confirmed → `held` (5-day deadline), both parties confirm delivery → release + wallet credit
- [x] Seller wallet: balance + transaction history, RWF withdrawal via Paypack cashout
- [x] Auto-refund cron (hourly): Paypack refunds immediately, Pesapal submits a refund request
- [x] In-app notifications: bell + unread badge (30s/focus polling), mark-read, event triggers across bidding/payment/escrow/refunds + 24h delivery-deadline warnings
- [x] User dashboard (`/dashboard`): sales + purchases with escrow status
- [x] Admin panel: isAdmin-gated overview/stats, order oversight (needs-attention pinned), mark-refunded + force-release (audited), user search
- [x] Phone + identity verification: OTP by SMS (KV-backed) + ID-document upload → admin review → verified badge (informational, never gates selling)
- [x] Per-order buyer/seller chat (`messages` collection)
- [x] SEO: sitemap + robots, per-route metadata/canonical/OpenGraph, product JSON-LD, `not-found`/`error`/`global-error`/loading boundaries, semantic headings, `next/image`
- [x] Performance: `getManyDocs` batch reads (kills N+1 in list endpoints), 30s TTL caching on feed + detail, opt-in `limit`/`before` pagination, client-side image downscaling to WebP before upload
- [x] Config validation: `/health` reports missing secrets/bindings as `degraded`; hand-rolled validators + flat `{ error }` contract
- [x] `ARCHITECTURE.md` documenting decisions + the required Firestore composite indexes
- [x] Backend + frontend tests/lint/build green (workers 10 suites, frontend lint + build)
- [ ] Disputes UI (hold disputed orders for manual review) — future scope
- [ ] Real SMS provider wired into `workers/src/lib/sms.ts` (currently logs to console)
- [ ] Real Paypack/Pesapal credentials + production webhook secrets required for end-to-end payments
