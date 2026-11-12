# Decisions log

One line per decision where the brief was silent or a default was superseded.

- **S3 stand-in:** MinIO's public Docker images were withdrawn (Docker Hub repo gone, quay.io requires auth), so local dev uses `rustfs/rustfs` (S3-compatible, presigned URLs + CORS). Production targets AWS S3 as specified; the storage settings carry `endpoint`/`forcePathStyle` so any S3-compatible target works.
- **Backend is Django 6 + Django REST Framework** (user decision, supersedes the Fastify/Prisma line in the brief): GeoDjango for PostGIS, Celery (Redis broker) for the worker queues, Django Channels for realtime, drf-spectacular for OpenAPI. `apps/worker` is a thin entrypoint that runs Celery from the `apps/api` codebase.
- **PostGIS via GeoDjango** `PointField`/`PolygonField` (geography=True) with GiST indexes; distance queries use `Distance` annotations.
- **Search:** Postgres full-text (`SearchVectorField` + GIN) + `pg_trgm` trigram similarity via `django.contrib.postgres`. Meilisearch/Typesense deferred — catalog size does not justify another service.
- **Typography:** Fraunces (display serif) + Manrope (UI sans), both OFL via Google Fonts.
- **Icons:** Lucide (1.5px stroke) in both apps (`lucide-react`, `lucide-react-native`).
- **Beem OTP:** two modes. `beem_sms` (default) generates the code server-side, hashes it with argon2id and sends it through `POST https://apisms.beem.africa/v1/send`; `beem_otp` uses `POST https://apiotp.beem.africa/v1/request` `{ appId, msisdn }` / `POST …/v1/verify` `{ pinId, pin }` (code 117 = valid). Both use Basic auth (API key:secret).
- **Payments:** cash on delivery first; mobile money through Beem Checkout (`GET https://checkout.beem.africa/v1/checkout`, callback POST verified by `beem-secure-token`). Card provider abstraction kept, no provider wired.
- **Tokens:** access JWT (HS256 via PyJWT, secret stored encrypted in settings and generated on first boot) 15 min; refresh tokens are random 256-bit, stored as SHA-256, rotated on every use, bound to a `deviceId`.
- **Admin sessions** are opaque server-side tokens in an httpOnly cookie (CSRF: SameSite=Lax + `X-Requested-With` header check), so revocation is instant; passwords use Django`s Argon2PasswordHasher (argon2id).
- **Money:** integer minor units + ISO code; TZS exponent 0. Tax is inclusive by default (configurable).
- **Account linking:** Google sign-in with an email matching a phone user does **not** auto-merge (email is not authoritative for phone users). Linking happens explicitly from the profile; the merge keeps the older account, moves orders/wishlists/places, and records an audit entry.
- **Next.js 16:** `proxy.ts` (not middleware) guards admin routes; Turbopack default; React Compiler on.
- **Expo SDK 58 / RN 0.88**, New Architecture, `expo-video` + `expo-audio` (expo-av not used).
- **Image pipeline in Python:** `pyvips` (libvips) for AVIF/WebP/JPEG renditions, `blurhash-python` + an in-repo ThumbHash encoder; ffmpeg/ffprobe via subprocess for video/audio.
- **Realtime protocol:** Django Channels WebSocket at `/realtime/` with JSON events `{type, ...}` mirroring the earlier Socket.IO rooms (`order:<id>`, `rider:<userId>`, `dispatch`, `thread:<id>`); the mobile app uses the native WebSocket API.
- **Server-side validation of settings groups** uses pydantic models (Python is the source of truth); `packages/shared` keeps the Zod mirror for admin forms and the public config type.
- **Mobile app is Flutter** (user decision, supersedes Expo/React Native in the brief): Dart 3, Riverpod, go_router, google_maps_flutter, geolocator, cached_network_image + thumbhash placeholders, flutter_secure_storage, google_sign_in. Design tokens are generated from `packages/design-tokens` into Dart (`apps/mobile/lib/design/tokens.g.dart`); the A loader is a CustomPainter driven by the same `packages/brand` geometry/phases.
- **Admin tables use TanStack Table v8** (v9's API changed substantially; v8 is stable and well understood).
- **Admin images render `<picture>` with AVIF/WebP/JPEG `srcset`s + ThumbHash**, not `next/image`: renditions are individually signed S3/CDN URLs that a `next/image` loader cannot derive from one src.
- **Admin talks to Django through a Next rewrite (`/api/*`)**, so the httpOnly `sw_admin` cookie is first-party; RSC calls forward it as `X-Admin-Session`.
- **Seed imagery is from Unsplash** (Unsplash License), hand-picked with no logos or text on product; credits in `docs/IMAGE_CREDITS.md`. Brands in the seed are fictional.
- **Mobile icons are a generated Lucide-300 subset** (`tool/gen_icons.py`) instead of `lucide_icons_flutter`'s Dart files, which cost ~150k lines of analysis for ~100 glyphs.
- **Mobile screenshots are golden-style tests** (`test/screenshots_test.dart`) rendering the real app against fixtures captured from the seeded API (`tool/capture_fixtures.py`), so `docs/screenshots/mobile` shows real data and photos without a device.
- **Payments provider is Snippe** (supersedes Beem Checkout as the default; Beem kept as legacy option): collections by USSD push (`POST /v1/payments`, `payment_type=mobile`), webhooks verified with HMAC-SHA256 over `"{X-Webhook-Timestamp}.{raw body}"` (5-min tolerance, idempotent by event id), plus a 2-minute reconcile task for missed webhooks.
- **Rider payouts via Snippe disbursements** (`POST /v1/payouts/send`, `channel=mobile`): balance = completed job earnings − pending/completed payouts; failed/reversed payouts release the amount. Manual (cash/bank) payouts are recorded instead when `payments.riderPayoutsProvider=manual`. New permission `payouts.manage` (Finance, Manager, Super Admin).
- **System roles are re-synced on every `migrate`** (post_migrate → `ensure_roles`) so new permissions reach existing installs.
- **Offline place labels:** without a Google Maps server key, dropped pins are labelled with the containing delivery zone (or "Near <store area>" within 1.5 km) plus a locally computed Plus Code (Open Location Code) instead of a generic "Pinned location". The seed adds 14 Dar es Salaam neighbourhood zones (no fee overrides) as a starting point.
- **Map route motion:** routes draw on over 900 ms when they appear/change; the plan view adds a slow travelling gold "stitch" (echoing the A loader). Native Google polylines get only the draw-on (no per-frame looping). Reduce Motion shows the finished line.
- **Product editor preview is client-side:** the phone preview renders from unsaved editor state (retail/wholesale, light/dark) rather than the server preview endpoint, so it is truly live; the server still re-prices everything at checkout. Drafts autosave to the API every 4 s of idle and to localStorage as a crash backup.
- **New option values use client placeholder ids (`new:<key>`)** that variants and media reference within the same save; the API maps them to the created rows, so autosave can resend the same payload safely.
- **In-browser recordings send their trim with `/media/complete`** (`options.trim`) so ffmpeg cuts it on the first processing pass.
- **Campaign audiences** treat a missing opt-out key as opted in (`has_key` + value check) and only count users with a live push token (`Exists` subquery); the composer shows live reach via `POST /v1/admin/campaigns/estimate`.
- **Demand heatmap** in Reports is a ~1 km density grid (no map key needed, never shows exact addresses).
