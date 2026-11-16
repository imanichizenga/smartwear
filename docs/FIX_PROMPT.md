# SmartWear — Fix & Finish Prompt

> Paste everything below the line into a new Claude Code session opened on this repository.

---

You are a senior full-stack engineer and senior mobile UI engineer working on **SmartWear**: a pnpm/turbo monorepo with
- `apps/api`: Django + DRF + Channels (WebSocket at `/realtime/`), Celery, Postgres/PostGIS, Redis
- `apps/admin`: Next.js admin (React Query, `src/lib/realtime.ts`)
- `apps/mobile`: Flutter (Riverpod 3, go_router, Dio, flutter_secure_storage, cached_network_image, thumbhash, video_player, google_maps_flutter)

The visual design is approved and must be **preserved**. Reuse the existing tokens (`SwSpace`, `SwRadius`, `SwMotion`, `context.sw`, `context.type`) and kit widgets (`SwButton`, `SwTextField`, `SwIconButton`, `Skeleton`, `EmptyState`, `SectionHeader`, `showSwSheet`, `showSwToast`, `ALoader`). Don't invent a new style. Every string goes through `ref.s(...)` with **both `en` and `sw` translations** (`lib/l10n`).

Work through the phases below in order. Before editing each area, read it fully; the line references below are from an audit and may have drifted. After each phase, run the checks listed in **Verification** and fix anything that fails before you continue. Commit after each phase with a clear message.

---

## Phase 1: Persistent authentication (highest priority)

**Requirement:** once signed in, a user stays signed in across app restarts, network loss, server hiccups and long gaps. Only two things may sign them out: (a) they tap Sign out, or (b) an admin blocks the account or revokes the session.

Root causes the audit confirmed:

1. **A network error during token refresh wipes the tokens.** In `apps/mobile/lib/core/api.dart` → `Api._refresh()`, `on DioException { await tokens.clear(); ... }` catches *every* Dio error: timeouts, no connectivity, DNS failures, 5xx. If the app opens offline or the API is slow, the user is logged out.
   - Fix: clear tokens **only** when the server answers `/auth/refresh` with 401 and code `refresh_invalid` / `refresh_device_mismatch` / `session_revoked`, or 403 (blocked/deleted account). For any other failure, keep the tokens, return `false`, and surface `ApiException(offline)`.
2. **`onSignedOut` is never wired.** `apiProvider` builds `Api(ref.watch(tokenStoreProvider))` with no callback, so a real server-side revocation never updates `sessionProvider`. Wire it so a genuine revocation calls `SessionNotifier` to set the signed-out state and route to `/welcome`, with a toast such as "You were signed out" (translate it).
3. **Session restore treats any non-401 error as "signed out".** In `lib/core/providers.dart` → `SessionNotifier.restore()`, a 5xx sets `user: null`, and offline sets the hack `{'offline': true}` as the user.
   - Fix: cache the last `/me` user JSON in secure storage or prefs on every successful login, refresh and `/me`. On restore, if a refresh token exists, mark the session **signed in immediately from the cache** (no network wait on the splash screen), then revalidate `/me` in the background. Only a definitive revocation (see 1) signs out. Remove the `offline: true` pseudo-user.
4. **Refresh-token rotation can lock out a legitimate user.** In `apps/api/accounts/tokens.py` → `rotate_refresh`, if the app is killed after the server rotates but before the client persists the new token, the next launch sends the previous token. That is treated as theft, so the whole family is revoked.
   - Fix: add a **reuse grace window**. If the presented hash equals `session.previous_hash`, the session is still active, the device matches, and the last rotation was ≤ 2 minutes ago (add a `rotated_at` field with a migration), rotate again and succeed instead of revoking. Keep theft detection outside the window.
   - Persist both tokens atomically on the client: write the refresh token first, then the access token, and never leave `refresh == null` while `access != null`.
5. **Absolute expiry.** `expires_at` is set once (60 days) and never slides. Make it sliding: on each successful rotation, set `expires_at = now + refreshTokenTtlDays`, so active users are never forced to log in again. Raise the default `refreshTokenTtlDays` to 180.
6. **Device id stability.** The `refresh_device_mismatch` check depends on `sw.device`. Make `TokenStore.load()` resilient:
   - Wrap secure-storage reads in try/catch. On Android keystore corruption, fall back gracefully and don't throw on the splash screen.
   - Never regenerate a device id while a refresh token exists.
   - Use `AndroidOptions(encryptedSharedPreferences: true)` / `resetOnError: false` as appropriate for flutter_secure_storage v11.
   - Set `android:allowBackup="false"` (or proper `dataExtractionRules`) in `android/app/src/main/AndroidManifest.xml` so restored backups don't carry undecryptable keys.
   - On iOS use `KeychainAccessibility.first_unlock` so background refreshes can read the token.
7. **Realtime socket loops with an expired token.** In `lib/core/realtime.dart`, the server closes with code `4401` when the access JWT has expired, and `_onClosed` simply reconnects with the same token forever.
   - Fix: on close code 4401, call a refresh through `Api` first (single-flight), then reconnect with the new access token. Proactively refresh about 60 s before access expiry, or on app resume via `AppLifecycleListener`.
8. **Admin-initiated logout must work.** Confirm that admin block (`is_blocked`), "revoke session" and account deletion produce 401/403 on the next API call or refresh, and push a `session.revoked` realtime event to `user.<id>` so the app signs out within seconds. Add this event server-side wherever admins revoke or block, and handle it in the app.
9. Add `x-app-version` to `CORS_ALLOW_HEADERS` in `apps/api/smartwear/settings.py`, since the client sends `X-App-Version`.

**Tests:**
- API pytest: rotation grace window, theft-outside-window revokes the family, sliding expiry, blocked user refresh returns 403.
- Flutter unit tests with a mocked Dio:
  - offline refresh keeps tokens
  - 401 `refresh_invalid` clears them
  - restore with a cached user and no network shows signed in

## Phase 2: OTP verification flow

1. **The user isn't taken Home after a correct code.** The stack is `/welcome` (via `go`) → push `/auth/phone` → push `/auth/otp`. `_finish()` in `features/auth/auth_screens.dart` pops while `canPop`, which lands back on **Welcome**.
   - Fix: after a successful verify, always `context.go('/')`, or `/auth/quiz` for new users when the `styleQuiz` feature is on.
   - If sign-in was started from a gated action (`?return=1` / `requireSignIn`), go back to the originating route instead. Pass it as an explicit `from` query param, not pop-guessing.
   - Add real **router guards** in `router.dart`:
     - signed-in users who hit `/welcome` or `/auth/*` (except `/auth/quiz`) are redirected to `/`
     - auth-only routes (`/orders`, `/checkout`, `/chat/*`, profile sub-pages that need an account) redirect signed-out users to `/welcome?from=…`
2. **Double submission.** `OtpInput._changed` fires `onCompleted` on *every* controller notification while length == N, including selection changes and rebuilds. Guard it so the callback fires once per distinct complete value, and ignore input while `_busy`.
3. **Improve the code field** (`OtpInput` in `ui/kit.dart`):
   - Box size is responsive: compute it from the available width (`LayoutBuilder`), with min 40, max 56, and gaps of `SwSpace.s2`. The fixed `width: 48` × 6 overflows on small phones and at 1.3× text scale.
   - Show a blinking caret in the active box; filled boxes use `c.ink` borders, the active box a 1.5px accent border, and the error state is red with a short shake animation (respect reduce-motion).
   - Support paste of the full code: long-press opens a "Paste" option. Strip non-digits and auto-submit.
   - Android SMS autofill: `sms_autofill` is already a dependency, so wire `SmsAutoFill().listenForCode` and `AutofillHints.oneTimeCode` for iOS.
   - Show a success state (check icon / brief green border) before navigating.
   - The resend button must handle errors (try/catch with a toast), use the configured cooldown (not a hard-coded 30), and the timer must not call `setState` after dispose.
   - "Change number" returns to the phone screen with the number prefilled.

## Phase 3: Loading states — skeletons only, no image placeholders

**Requirement:** while waiting for the server, show a skeleton that **mirrors the real layout** of that screen. Never show a grey box with an image icon.

1. `ui/sw_image.dart` → `SwImage`:
   - When `media == null` **or** its type isn't `IMAGE`, it currently renders a grey box with `Ic.image`. Replace that with:
     - a VIDEO with a poster: render the poster/thumbnail (`media.poster` / `thumbnail`; check what the API's media serializer returns in `apps/api/media` and add it if missing)
     - a still-processing medium: an animated shimmer (same shimmer as `Skeleton`)
     - genuinely missing media: a neutral, branded fallback (soft `c.hairline` surface with a subtle brand monogram or gradient), never the "broken image" icon
   - While the network image loads: thumbhash blur, or else the shimmer. The error builder shows the same branded fallback, not an empty box.
   - Guard `thumbhashImage` against bad base64 with try/catch.
2. Replace the generic single-box skeletons with **layout-faithful skeletons**:
   - `bag_screen.dart`: 3 line rows (92px 4:5 thumb, brand, title, price) plus the summary block
   - `discover_screen.dart`: a full-screen dark shimmer with the action column and caption/button placeholders in their real positions
   - `chat_screen.dart`: alternating left/right bubble skeletons plus the order banner
   - `orders_screen.dart`: a row shape matching the real order card
   - `search_screen.dart`, `tracking_screen.dart`, `checkout_screen.dart` (summary/options), and **every new profile sub-screen**
3. Put the skeleton building blocks in `ui/kit.dart`: `SkeletonLine`, `SkeletonBox`, `SkeletonAvatar`, `SkeletonList(itemBuilder, count)`. Use one shared shimmer controller for performance. Respect reduce-motion with a static tint.
4. `AsyncValue` handling everywhere:
   - use `skipLoadingOnRefresh` / `skipLoadingOnReload` so pull-to-refresh doesn't flash a skeleton over existing data
   - show inline retry for errors
   - show a distinct offline state (`ApiException.isNetwork`) versus a server-error state

## Phase 4: Delivery location — admin-selectable Automatic (map) vs Manual (form)

**Requirement:** before showing any map at checkout, the app checks the admin setting.

1. **API** (`apps/api/core/settings_schema.py` → `Checkout`, or a new `DeliveryLocation` section):
   - `locationMode: Literal["automatic", "manual"] = "automatic"`
   - `manualDetailFields`: the two extra fields' labels and `required` flags, with `labelSw`. Defaults:
     - "Describe your location (street, building, landmark)"
     - "What do you need / delivery instructions"
   - Expose these in `GET /v1/config/public`; add them to the public whitelist near line ~393.
   - Add metadata in `apps/admin/src/lib/settings-meta.ts` so admins see a clear "Delivery location: Automatic (map) / Manual (form)" control with help text.
2. **Checkout API:** accept the manual payload: `locationMode`, `locationDetails`, `deliveryNotes`, plus the auto-detected `lat`/`lng`/`accuracy` when available.
   - Validate that required manual fields are non-empty when the mode is `manual`. Store them on the order/delivery (migration).
   - Show them in the admin order detail (`components/orders/order-detail.tsx`) and the rider job view.
   - If manual mode has no coordinates, `quote()` must still work: use the nearest default zone/store pricing or a configured flat fee. Never crash on a missing lat/lng.
3. **Mobile** (`features/checkout/checkout_screen.dart`, `checkout_state.dart`, `place_picker.dart`):
   - Read `locationMode` from config first, and show a matching skeleton while config loads.
   - **automatic:** the current map flow (`SwMap`, place picker, accuracy hint), unchanged visually.
   - **manual:** no map is rendered or loaded. The system still auto-detects the location silently via `geolocator`:
     - show it as a read-only "Detected location" chip with the reverse-geocoded area, or "Couldn't detect location" if permission is denied (manual still works without it)
     - then show the **two additional fields** (multi-line `SwTextField`s, character counters, validation)
     - then Submit
   - Handle these edge cases:
     - permission denied or denied forever
     - location services off
     - an admin who changes the mode while the user is mid-checkout (re-read config on screen open)
     - keyboard covering the fields (`Scrollable.ensureVisible`)
     - preserving typed text on rebuild

## Phase 5: Profile — implement every screen

`profile_screen.dart` links to routes that **don't exist in `router.dart`**: `/wishlist`, `/places`, `/payments`, `/wholesale`, `/notifications`, `/support`, `/privacy`. Implement each one as a real screen with the shared app bar, layout-faithful skeleton, empty state, error/offline state and pull-to-refresh. Wire them to existing API endpoints; read the `urls.py` files under `apps/api/*` and add missing endpoints if needed.

- **Wishlist:** grid of `ProductCard`s (reuse `GridSkeleton`), remove with undo toast, empty state with a CTA to Discover.
- **Saved places:** list, add (reuses the place picker in automatic mode or the form in manual mode), rename/label (Home/Work/Other), set default, delete with confirm.
- **Payments:** saved mobile-money numbers / preferred method and the payment history list.
- **Wholesale:** application status (none/pending/approved/rejected), apply form, tier explanation.
- **Notifications:** inbox from `GET /me/notifications`, unread dots, mark-all-read, per-channel toggles. Tapping an item deep-links (order → tracking, chat → thread).
- **Help & support:** see Phase 7. The entry point lists the user's orders so they can start or continue an order chat.
- **Privacy & account:** active sessions (`GET` sessions, revoke others), data export, delete account with typed confirmation.
- **Edit profile:** name, email, avatar via `image_picker` (upload with progress), phone shown verified.
- The profile header must show the avatar/initials, name and phone. Every row uses the same `_Row` component, spacing and chevrons.

## Phase 6: Navigation & layout polish

1. **Duplicate search:** Home's app bar (`home_screen.dart:67`) has a search icon and the bottom tab bar (`shell/shell.dart:27`) also has Search. Replace the Home app-bar search button with a **Wishlist** button (heart icon, with a count badge when > 0) that opens `/wishlist`. Keep the Search tab.
2. **Bag summary empty space:**
   - `bag_screen.dart` pads the list with a hard-coded `260 + safe.bottom` bottom inset, while `_Summary` adds `84 + safe.bottom` of padding for the floating nav. This leaves a big blank band and mismatched spacing.
   - Fix: lay out as `Column(Expanded(list), summary)`, or measure the summary height and use exactly that as the list's bottom padding.
   - Derive the nav-bar clearance from one shared constant / `MediaQuery` instead of magic numbers.
   - Make the summary compact: totals in one tight block, and the Checkout button full-width directly above the nav bar.
   - Apply the same audit to checkout's `_PlaceBar` / `SlideToConfirm` and to the product page's bottom bar.
3. **Discover** (`discover_screen.dart`) must behave consistently for every media type:
   - **Video looks:** play inline with `video_player`, muted by default with a mute toggle, looping. Auto-play only the visible page and pause others (`PageView` `onPageChanged`, `VisibilityDetector` or page index). Pause on app background/tab switch, and dispose controllers.
   - **Loading:** show the poster/thumbhash and a subtle buffering indicator.
   - **Video fails or has no source:** fall back to the poster/cover image.
   - **No media at all:** skip the look server-side (filter out looks whose media isn't ready) *and* client-side defensively.
   - **Action buttons** (like/save/share): fixed 48×48 tap targets, consistent spacing, visible on light and dark media (soft scrim behind the column), with labels that never wrap.
     - The save button currently shows the "added to wishlist" text as its label. Use a proper "Save" / "Saved" label.
     - Share uses the platform share sheet (or copies with a toast confirming it).
   - **Product tag pins:** clamp them inside safe bounds so they never render off-screen.
   - Pull-to-refresh at the top, and an end-of-feed state.
4. **Senior-level consistency pass across mobile and admin:**
   - Primary actions are full-width at the bottom inside `SafeArea` with `SwSpace.s5` side padding.
   - Use one button height per size; secondary/ghost actions are aligned and never cramped.
   - Form fields: consistent label → field → helper/error spacing, keyboard-aware scrolling, the correct `textInputAction` / next-field focus, and no field hidden behind the keyboard.
   - Tap targets are ≥ 44pt. No overflow at 1.3× text scale or on a 360-dp-wide screen.
   - In the admin: form grids align, action bars are right-aligned and consistent, and loading uses skeletons instead of centered spinners (e.g. the support inbox list).

## Phase 7: Order-based real-time chat (customer ↔ admin/support)

**Requirement:** customers and admins chat in real time, with emoji and online/offline presence. **Every conversation belongs to an order**, and the order context is always visible.

1. **Data model** (`apps/api/notifications/models.py`):
   - Every support thread requires an `order`. Make `(kind='support', order)` unique, alongside the existing `one_order_chat` constraint for the rider kind.
   - Today `ThreadsView.post` reuses *any* open support thread for the user and ignores `orderId` (`ChatThread.objects.filter(kind="support", user=user, status__in=[...]).first()`), which mixes orders. Fix it to get-or-create per `(user, order)`, and validate that the order belongs to the user.
   - Add `read_at` (or per-side `last_read_message_id`) for read receipts, and a client-generated `client_id` for idempotent sends and optimistic UI.
   - Write a data migration for existing support threads without an order: leave them readable, but they can't receive new messages.
2. **Realtime** (Django Channels, `notifications/consumers.py`):
   - Customer and admin subscribe to `thread.<id>`.
   - Broadcast `chat.message`, `chat.read` and `chat.typing` (throttled).
   - **Presence:** track online state in Redis with a TTL heartbeat (e.g. `presence:user:<id>` and `presence:staff`) on connect, heartbeat and disconnect. Broadcast `presence.changed` to the thread room. Expose `online` and `lastSeenAt` in `thread_out`.
   - The authorization check in `_allowed` must cover `thread.<id>` for the thread's customer and for admins with the support permission.
3. **Mobile chat** (`features/chat/chat_screen.dart`, a new `/support` hub):
   - **Order banner** pinned under the app bar: order number, status chip, date, item thumbnail and total. Tapping it opens the order tracking/detail page.
   - The app bar shows "SmartWear Support" with an online dot or "last seen …".
   - Entry points: an "Ask about this order" button on the order detail/tracking screen and in each order row. The Help hub lists orders, each with its thread's last message and unread badge.
   - Messages:
     - **optimistic send** (pending → sent → read ticks, with retry on failure)
     - day separators and grouped bubbles
     - auto-scroll to the newest message only when already at the bottom, otherwise a "new messages" pill
     - load older messages on scroll up
   - **Emoji:** an emoji button toggles an emoji picker panel that replaces the keyboard. Use the `emoji_picker_flutter` package, matching theme colours. Send emoji-only messages larger.
   - Typing indicator. Replace the 8 s polling `Timer` with realtime, and fall back to polling only while the socket is down.
   - Mark as read on open and while visible. A push notification tap deep-links to the thread.
4. **Admin chat** (`apps/admin/src/components/sell/support.tsx`):
   - Thread list grouped by order, showing the order number prominently, customer name, an online dot, the last message and unread count. Filter by order number.
   - A conversation header with an **order context card** (number, status, items, total, delivery address/location details including the manual-mode notes, and a link to the order).
   - An emoji picker in the composer (e.g. `emoji-mart` or a lightweight picker), typing indicator, read receipts, optimistic send, and customer online/last-seen.
   - From an order detail page (`components/orders/order-detail.tsx`), add a "Message customer" button that opens or creates that order's thread.
5. Push notifications for new messages when the recipient is offline, and no push when they're actively viewing the thread.

## Phase 8: Cold-start & edge-case sweep

- **Splash:** don't block on the network. Route as soon as the cached session and config are read, and cap the wait at about 1.2 s.
- If `/config/public` fails with no cache, use safe defaults and retry in the background. Never stick on the splash screen.
- **Riverpod:** no `ref.read` of `prefsProvider` outside an override. No `setState` after dispose (audit every `Timer`, stream subscription and `await` followed by `setState`/`context`; guard with `mounted`).
- **Network:**
  - global offline banner
  - retries with backoff on idempotent GETs
  - `Idempotency-Key` on order/payment POSTs
  - double-tap protection on every submit button (`busy` state)
- **Images:** set `memCacheWidth`/`memCacheHeight` from the layout to avoid OOM on long grids, and precache the next Discover page's media.
- **Deep links / push taps** while signed out: store the target, sign in, then continue to it.
- **Cart:** quantity changes debounced and race-safe, a stock-change problems banner, a promo error that clears when the user edits the field, and the swipe-to-delete undo toast.
- **Checkout:** handle quote failure, delivery zone not served, minimum order amount, and payment timeout/back navigation on `payment_wait_screen.dart`.
- **Run analyzers** and fix everything: `flutter analyze`, `ruff`, ESLint/TypeScript in the admin.

---

## Verification (run after each phase; all must pass)

```bash
cd apps/api && uv run ruff check . && uv run python manage.py makemigrations --check --dry-run && uv run pytest -n 4 -p no:warnings
```

```bash
pnpm turbo run typecheck lint test && pnpm turbo run build --filter=@smartwear/admin
```

```bash
cd apps/mobile && flutter analyze && flutter test
```

Then walk through these flows manually (or with widget tests where possible) and confirm each one:

1. Sign in, kill the app, turn on airplane mode, reopen: the user is still signed in and sees cached content with an offline banner.
2. Sign in, wait past the access-token TTL, then reopen: there's a silent refresh and no login screen.
3. An admin blocks the user or revokes the session: the app signs out within seconds with a message.
4. Enter the OTP: it lands on Home (or the quiz for a new user), with no double submit, and paste/autofill work.
5. The admin sets Manual: checkout shows no map, shows the detected-location chip and the two fields, and the order shows those notes in the admin and rider views. Switch to Automatic: the map flow returns.
6. Every Profile row opens a finished screen with skeleton, empty and error states.
7. Discover: an image look, a video look, a video that fails, and a look with missing media all behave consistently.
8. Home has the Wishlist button (with badge) and only one Search (the tab).
9. Bag: no blank band, and the summary sits flush above the nav bar on small and large phones.
10. Chat: a customer opens a chat from an order and the admin sees it under that order number. Messages are instant both ways, emoji works, online/typing/read states update, and the order banner is visible on both sides.

Don't remove or weaken existing tests. Keep the approved visual language and add `sw` translations for every new string. Finish with a short report: what changed per phase, any new endpoints/settings/migrations, and anything left as a follow-up.
