# ALLSHA — frontend

The web app for the ALLSHA peer-to-peer marketplace (see the repo-root
`README.md` for the full project). Built with Next.js 16 (App Router), React 19,
TypeScript and Tailwind CSS v4. Talks to the Cloudflare Workers API in
`../workers`.

## Getting started

```bash
npm install
cp .env.example .env.local   # public web config, values pre-filled
npm run dev
```

Open http://localhost:3000. The Workers API is expected at `http://localhost:8787`
(override via `NEXT_PUBLIC_API_BASE_URL`; see `lib/env.ts`).

## Scripts

| Script          | Purpose                                    |
| --------------- | ------------------------------------------ |
| `npm run dev`   | Development server (Turbopack)             |
| `npm run build` | Production build (type-checks first)       |
| `npm run start` | Serve the production build                 |
| `npm run lint`  | ESLint (flat config)                       |

## How it's organized

- `app/` — App Router routes. Public pages (home, explore, product detail) are
  server components that fetch with `lib/publicApi.ts`; authenticated pages
  (dashboard, wallet, my-bids, sell, checkout, orders, admin) are gated by
  route-level `layout.tsx` files and fetch with `lib/api.ts`.
- `lib/` — API clients, environment config (`lib/env.ts`), shared filter state
  (`lib/exploreFilters.ts`), Firebase auth glue, and the client-side image
  downscaler (`lib/upload.ts` → `prepareImageFile`, caps photos at ~1600px and
  re-encodes to WebP before presigned upload).
- `components/` — shared UI (`ui/`), the authenticated header/menu, product /
  bid / order components, and the seller forms.
- `types/index.ts` — domain types. **Keep in sync with `../workers/src/models.ts`**
  (both carry a matching header comment; there is deliberately no shared package).

## Fetch split (server vs client)

`lib/publicApi.ts` exports `publicFetch`, `ApiError`, `mediaUrl`, `formatPrice`
and is safe to import from server components. It also exports `withTimeout`
(`AbortSignal.timeout` + caller-signal merge) and `REQUEST_TIMEOUT_MS` (30s),
which both `publicFetch` and `apiFetch` apply to every request so nothing hangs
forever on a dead API. `lib/api.ts` re-exports those and adds `apiFetch`, which
attaches the Firebase ID token (`Authorization: Bearer <idToken>`) and is
client-only (it imports the Firebase client).

## SEO & images

- `app/sitemap.ts` + `app/robots.ts` are generated from `lib/env.ts` (`siteUrl`);
  the sitemap paginates the product feed (100/page, stops on `hasMore: false`).
- `app/layout.tsx` sets `metadataBase` and emits site-level `openGraph`
  (+ image) and `twitter` (summary_large_image) tags; generated brand cards
  live in `app/opengraph-image.tsx` and `app/twitter-image.tsx`. Each route
  exports `generateMetadata` with canonical + OpenGraph tags; the product page
  sets product-specific tags + Product JSON-LD; the homepage adds WebSite
  JSON-LD.
- Images render through `next/image`; `next.config.ts` builds remote patterns
  from `NEXT_PUBLIC_API_BASE_URL` (media origin, localhost dev fallback) plus
  Google avatar hosts — no `**` wildcards.
- Loading/error boundaries exist per route (`loading.tsx` / `error.tsx`,
  `not-found.tsx`, `global-error.tsx`). Error pages never render raw
  `error.message`; they show generic copy plus an optional request `digest`.
