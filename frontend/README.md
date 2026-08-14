# MarketLoop — frontend

The web app for the MarketLoop peer-to-peer marketplace (see the repo-root
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
(override via `NEXT_PUBLIC_API_URL`; see `lib/env.ts`).

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
and is safe to import from server components. `lib/api.ts` re-exports those and
adds `apiFetch`, which attaches the Firebase ID token
(`Authorization: Bearer <idToken>`) and is client-only (it imports the Firebase
client).

## SEO & images

- `app/sitemap.ts` + `app/robots.ts` are generated from `lib/env.ts` (`siteUrl`).
- `app/layout.tsx` sets `metadataBase`; each route exports `generateMetadata`
  with canonical + OpenGraph tags; the product detail page emits Product
  JSON-LD.
- Images render through `next/image` (remote patterns for the API's `/media`
  origin are configured in `next.config.ts`).
- Loading/error boundaries exist per route (`loading.tsx` / `error.tsx`,
  `not-found.tsx`, `global-error.tsx`).
