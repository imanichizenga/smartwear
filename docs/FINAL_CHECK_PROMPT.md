# SmartWear — Final Check & Fix Prompt

> Run this **after** the work from `docs/FIX_PROMPT.md` has been done. Paste everything below the line into a new Claude Code session on this repository.

---

You are the final reviewer before release. You are a principal engineer and a senior mobile UI engineer, and your job is to **verify, not assume**. Another engineer has implemented the fixes described in `docs/FIX_PROMPT.md`; read that file first, because it is the specification.

SmartWear is a monorepo:
- `apps/api`: Django + DRF + Channels, Celery, Postgres/PostGIS, Redis
- `apps/admin`: Next.js admin
- `apps/mobile`: Flutter app (Riverpod, go_router, Dio)

The approved visual design must be preserved. Reuse the existing tokens (`SwSpace`, `SwRadius`, `SwMotion`, `context.sw`, `context.type`) and kit widgets. Don't restyle anything.

## How to work

1. **Read before judging.** For every requirement below, open the actual code path end to end: UI → state → API client → endpoint → model. "A file exists" doesn't count as done. Trace the behaviour.
2. **Classify each item** as one of:
   - ✅ **Pass:** implemented and verified
   - 🔧 **Fixed:** was broken or incomplete, and you fixed it
   - ⚠️ **Blocked:** can't be completed here (state exactly why)
3. **Fix what's wrong, minimally and correctly.** Don't rewrite working code, and don't weaken, skip or delete tests to get green. Add a test for every bug you fix wherever practical.
4. **Run the full checks** (bottom of this file) at the start, to establish a baseline, and again at the end. Every failure must be fixed or explained.
5. **Commit in small, clearly described commits**, one per area.

## Checklist

### A. Authentication persistence (most important)
- [ ] Tokens are cleared **only** on these definitive server answers to `/auth/refresh` or an authenticated call:
  - 401 `refresh_invalid`, `refresh_device_mismatch` or `session_revoked`
  - 403 for a blocked or deleted account

  Timeouts, connection errors, DNS failures and 5xx must **never** clear tokens. Check `apps/mobile/lib/core/api.dart` and every `tokens.clear()` call site (grep for it).
- [ ] Cold start with a stored refresh token and **no network**: the user lands on Home signed in, using the cached user and showing an offline banner. Cold start with a stored token and a 500 from `/me`: still signed in.
- [ ] Refresh is single-flight. Ten concurrent 401s trigger exactly one `/auth/refresh` call, and all requests retry with the new token. Write a unit test that proves this.
- [ ] Server rotation grace window works: re-presenting the previous refresh token within the window succeeds; outside it, the token family is revoked. Expiry slides on every rotation. A migration exists for any new fields.
- [ ] The device id never changes while a refresh token exists, and secure-storage read errors don't crash or sign out on the splash screen.
- [ ] Android backup settings won't restore undecryptable secrets. iOS keychain accessibility allows reads after first unlock.
- [ ] The realtime socket handles close code `4401` by refreshing and then reconnecting. It doesn't loop with an expired token. The app refreshes on resume when the access token is near expiry.
- [ ] Admin block or revoke reaches a running app within seconds (realtime `session.revoked` and/or the next request). The app then signs out with a translated message.
- [ ] Sign out works offline: it clears locally and best-effort notifies the server.
- [ ] `x-app-version` is in `CORS_ALLOW_HEADERS`.

### B. OTP flow
- [ ] After a correct code: go to Home (or the style quiz for a new user when that feature is on), or to the explicit `from` route. Never land back on Welcome or the phone screen. Confirm this through `router.dart` redirects as well as the screen code.
- [ ] Router guards: signed-in users can't open `/welcome` or `/auth/*` (except the quiz). Auth-only routes redirect signed-out users to `/welcome?from=…`. There are no redirect loops: test splash → welcome → phone → OTP → home, and test deep-link while signed out → sign in → deep-link target.
- [ ] The code submits exactly once, with no double submit on rebuilds or selection changes. Input is ignored while busy.
- [ ] Code boxes are responsive:
  - no overflow at 320 dp width or at 1.3× text scale
  - paste and SMS/iOS autofill work
  - error shake respects reduce-motion
  - the resend cooldown comes from config, and resend errors show a toast
  - timers are cancelled on dispose

### C. Loading states
- [ ] Grep for `Ic.image` and any grey-box placeholder in `lib/ui/sw_image.dart` and the feature screens. **No** image-icon placeholder remains anywhere.
- [ ] Media states render correctly: missing media shows the branded fallback, processing shows the shimmer, a video shows its poster, and an image load error shows the fallback. Bad thumbhash data can't throw.
- [ ] Every async screen has a skeleton that **matches its real layout**: same structure, sizes, spacing and count. Compare each skeleton side by side with its loaded screen:
  - Home, Discover, Search, product list, product page, Bag, Checkout, Orders, Tracking, Chat, the Support hub
  - every Profile sub-screen
- [ ] Pull-to-refresh and reloads don't flash a skeleton over existing data. Error and offline states are distinct and each has a retry.

### D. Delivery location mode
- [ ] The admin setting exists (`automatic` / `manual`), has clear labels and help text in `apps/admin/src/lib/settings-meta.ts`, and is exposed in `/v1/config/public`.
- [ ] The app reads the mode **before** rendering any map. In manual mode no map widget is built and no map SDK is initialised; verify this in code.
- [ ] Manual mode:
  - location is auto-detected silently and shown read-only
  - the two extra fields appear, with validation, required flags from config and `sw` labels
  - submit works when location permission is denied or services are off
- [ ] The API validates the manual fields, stores them (a migration exists), and quotes and creates the order without coordinates without crashing. The manual notes appear in the admin order detail and the rider job view.
- [ ] Automatic mode is visually and functionally unchanged. If the mode changes while the user is in checkout, the app reflects it when the screen reopens.

### E. Profile screens
- [ ] Every row in `profile_screen.dart` routes to a **registered** route with a finished screen. Cross-check every `context.push` / `context.go` target in `apps/mobile/lib` against `router.dart` and list any unregistered path. The screens to check:
  - Wishlist, Saved places, Payments, Wholesale, Notifications, Help & support, Privacy & account, Edit profile
- [ ] Each screen has a skeleton, empty, error/offline and data state, consistent app bar and spacing, and real API wiring. Destructive actions confirm first.

### F. Navigation, Discover, Bag, layout quality
- [ ] Exactly **one** search entry (the tab). The Home top bar has a Wishlist button with a count badge.
- [ ] Bag: there's no blank band above the summary. The list's bottom padding equals the real summary height. Nav-bar clearance comes from one shared source, with no magic numbers like `260` or `84`. Check this on a small (360×640) and a tall (430×932) screen.
- [ ] Discover:
  - images, videos, failed videos and looks with missing media all behave consistently
  - only the visible video plays; videos pause on tab switch and app background, and controllers are disposed with no leaks
  - action buttons have ≥ 44pt tap targets, labels never wrap, and the Save label is correct
  - tag pins stay on screen
  - pull-to-refresh and the end-of-feed state work
- [ ] Senior UI pass across mobile and admin:
  - primary buttons are full width at the bottom inside the safe area, with consistent heights and paddings
  - form fields have consistent label/helper/error spacing, the correct keyboard actions and next-field focus, and are never hidden behind the keyboard
  - nothing overflows at 1.3× text scale
  - the admin's form grids and action bars are aligned
- [ ] Write `flutter test` golden or widget tests for at least the Bag, OTP and a Profile sub-screen at the small screen size, or extend the existing `test/screenshots_test.dart`.

### G. Order-based real-time chat
- [ ] Every support thread is tied to an order:
  - there's a DB constraint on `(kind, order)`
  - creating a thread validates that the order belongs to the user
  - a user can't read or post to another user's thread (write an API test for this)
- [ ] Messages are delivered in real time both ways over Channels (`thread.<id>`). Polling is used only as a fallback while the socket is down.
- [ ] Presence (online / last seen) works: it's backed by a Redis TTL heartbeat, goes offline when the app closes or the connection drops, and is shown in both the mobile and admin headers.
- [ ] Typing indicator is throttled. Read receipts work, and unread counts clear on open.
- [ ] Optimistic send is idempotent via a client id: there are no duplicates on retry or reconnect, and failed sends offer a retry.
- [ ] Emoji picker on mobile and admin. Emoji-only messages render larger. Multi-codepoint emoji are stored and shown correctly (check DB collation/encoding).
- [ ] An **order banner/context card** is visible on both sides: order number, status, date, items/total, and a link to the order. The admin can filter threads by order number and start a chat from the order detail page.
- [ ] A push is sent only when the recipient isn't viewing the thread, and a push tap deep-links to it.

### H. Cold-start & edge cases
- [ ] The splash screen never blocks on the network for more than about 1.2 s. If config fails with no cache, the app uses defaults.
- [ ] Search `apps/mobile/lib` for `setState(` and for `context.` used after an `await`. Each one must be guarded with `mounted`/`context.mounted`. Every `Timer`, `StreamSubscription`, `AnimationController`, `VideoPlayerController` and `TextEditingController` is disposed.
- [ ] Every submit button has a busy state and is protected from double taps. Order and payment POSTs send an `Idempotency-Key`.
- [ ] Cart quantity updates are debounced and race-safe. Promo errors clear on edit. Checkout handles:
  - quote failure
  - a zone that isn't served
  - the minimum order amount
  - a payment timeout
- [ ] Every new user-facing string exists in **both** `en` and `sw`, and no hard-coded English remains in new widgets.
- [ ] No secrets, debug prints or test endpoints are left in the code, and no `TODO` remains in shipped paths.

## Verification commands (baseline at start, and must be green at the end)

```bash
cd apps/api && uv run ruff check . && uv run python manage.py check --deploy --fail-level ERROR && uv run python manage.py makemigrations --check --dry-run && uv run pytest -n 4 -p no:warnings
```

```bash
pnpm install --frozen-lockfile && pnpm turbo run typecheck lint test && pnpm turbo run build --filter=@smartwear/admin
```

```bash
cd apps/mobile && flutter pub get && flutter analyze && flutter test
```

If a toolchain isn't available in your environment (for example Flutter or Postgres), say so explicitly. Still review that code by reading it, and mark the item ⚠️ instead of ✅.

## Final report (required)

Finish with:
1. **A table** of every checklist item, with its status (✅ / 🔧 / ⚠️) and one line of evidence. The evidence is a `file:line`, a test name, or the command output.
2. **The bugs you fixed**: what was wrong, the root cause, and the fix, with the commit for each.
3. **The verification command results**: baseline versus final.
4. **Remaining risks or follow-ups**, honestly stated. Don't claim anything works that you didn't verify.
