# Configuration

Everything is edited in **Admin → Settings** and stored encrypted in the database (see the brief, §4). Environment variables are only `DATABASE_URL`, `REDIS_URL`, `MASTER_ENCRYPTION_KEY`, plus native build-time values below.

## Payments — Snippe (Settings → Payments)

| Setting | Where to get it |
|---|---|
| Mobile money provider | Choose **Snippe** |
| Public API URL | The public HTTPS address of this API, e.g. `https://api.smartwear.co.tz`. Snippe posts results to `{url}/v1/webhooks/snippe` (sent with every request — no dashboard setup needed). |
| API key (`snp_…`) | [snippe.sh/dashboard](https://snippe.sh/dashboard) → Settings → API Keys → Create. Scopes: `collection:read`, `collection:create`; add `disbursement:read`, `disbursement:create` for rider payouts. Shown once. |
| Webhook secret | Snippe dashboard → Settings → Webhook Secret. Unsigned/forged/stale (>5 min) results are rejected. |
| API base URL | Leave `https://api.snippe.sh`. |
| Pay riders by | `manual` (record cash/bank payouts) or `snippe` (mobile-money payout to the rider's wallet). |
| Smallest payout / Payout description | Minimum Snippe payout (TZS) and the statement narration. |

**Test connection** reads the Snippe balance, checks the webhook secret and URL, and (if payouts are on) calls the payout-fee endpoint to prove the disbursement scope.

Transactions: [snippe.sh/dashboard/payments/transactions](https://snippe.sh/dashboard/payments/transactions) — mirrored in Admin → Payments (collections) and Admin → Rider payouts (disbursements). Collections are TZS only, minimum 500, expire after 4 h.

## Native build-time values

- Google Maps **native** SDK key (display only, restricted) via `--dart-define`/platform config. All Places/Geocoding/Routes calls go through the API with the DB-stored server key.
- Google Sign-In URL scheme (iOS) / SHA-1 (Android); the `webClientId` is fetched from `GET /v1/config/public`.
- Push: `google-services.json` / APNs entitlements; server keys in the DB.
