# GreenFeast Version History

This file is the source of truth for the app's version, shown on the Account
screen (`src/constants/version.ts` mirrors it and is what the app actually
renders — the two must always match).

## Format: `1.x.y`

- **1** — major version. Bumped manually, only for major releases. Almost
  never changes.
- **x** — native build number. Incremented **only** when a new native binary
  is created with `eas build`.
- **y** — OTA update number. Incremented **only** when a JS-only change is
  published with `eas update`. **Resets to 0** every time `x` increments.

```
1.3.7  →  eas build  →  1.4.0  →  eas update  →  1.4.1  →  eas update  →  1.4.2
```

## Release workflow — read before bumping anything

**Versions are bumped only on the user's explicit approval — never
automatically as a side effect of a commit, a PR, or "the code looks
release-ready."** If commits have landed on `main` but this file hasn't been
updated to match, treat the running app as still under development at the
last version recorded below — do not assume a release happened, and do not
silently bump the number to "catch up."

When the user does approve a release, do both of these together, in the same
commit:

### On a new EAS Build (`eas build ...`)
1. In `src/constants/version.ts`: increment `build` by 1, reset `ota` to `0`.
2. In this file: add a new `## 1.x.0` section below (see format under
   "Changelog") with today's date and a short changelog of what's in the
   build.

### On a new OTA Update (`eas update ...`)
1. In `src/constants/version.ts`: increment `ota` by 1. Leave `build`
   unchanged.
2. In this file: add a new `## 1.x.y` section below with today's date and a
   short changelog of what the update contains.

### Major version bump
Manual, rare, and only when the user explicitly says so — e.g. a significant
relaunch. Reset `build` and `ota` to `0` when this happens.

---

## Changelog

Each entry: version, release date, build/OTA numbers, and a short bullet list
of what changed. Newest first.

### 1.10.2 — 2026-10-25
- Build 10, OTA 2.
- **Sunday is our day off.** My Plan shows a "Sunday is our day off" card
  with a green Contact us pill (WhatsApp) instead of an empty slot; a Sunday
  meal the office set up is view-only. Add to day (Menu / dish detail) no
  longer offers Sundays, and Home's one-tap add skips them. The server side
  shipped separately and already applies to every app version: add-dish,
  switch-meal, update-day-cart and remove-dish refuse Sunday meals for
  customers (only the admin can put a meal on a Sunday). JS-only.

### 1.10.1 — 2026-10-24
- Build 10, OTA 1.
- **Ruler pickers show the value live.** Height, weight, protein and fibre
  (onboarding) updated the number above the ruler only once the scroll
  stopped; it now follows the finger. The saved value is still committed
  when the ruler settles. JS-only.

### 1.10.0 — 2026-10-20
- Build 10, OTA 0.
- **Requires a new native build, not just an OTA update** — adds the
  `expo-store-review` native module. `expo.version` is 1.10.0, so this build
  has its own runtime version (1.9.0 phones never receive code that needs the
  module); iOS buildNumber 3, Android versionCode 3.
- **Apple's / Google's own "rate this app" pop-up**, only for happy customers:
  at least 8 meals delivered, one delivered in the last day (not required right
  after a renewal payment), no 1–2★ rating or failed drop in 14 days
  (`store_review_check`, migration 065), at most once per 120 days per phone,
  never while a meal-rating card is showing. Asked on Home shortly after
  opening, and after a plan renewal is confirmed.
- Includes everything in 1.9.12 below (meal ratings, Send feedback, rider and
  delivered time, WhatsApp code step).
- First build for the Google Play organisation account.

### 1.9.12 — 2026-10-19
- Build 9, OTA 12.
- **Rate your meals.** Once a meal is marked delivered, Home shows "How was
  your lunch?" — tap a star for a sheet with 1–5 stars, chips ("What went
  wrong?" / "What did you like?") and an optional comment; closing it after
  picking stars still saves them. Order history shows each meal's rating and
  lets customers rate or change it for 7 days. A "How was your lunch?" push
  (3 PM / 9 PM, switched on from admin → Notifications after this update)
  opens the same sheet. How often customers are asked is set in admin →
  Feedback (migration 064); 1–2★ ratings alert the team.
- **Send feedback** (Account): idea / problem / compliment / other, goes to
  admin → Feedback with the app version.
- **Rate us on the App Store** (Account, iPhone only): opens the App Store's
  write-review page. Apple's automatic rating prompt needs a native build.
- **Who's bringing your meal** (delivery partner app): My Plan shows "On the
  way with {rider}" with a Call button while it's out for delivery, then
  "Delivered at 1:05 pm by {rider}"; Order history shows the delivery time.
- **WhatsApp code for the phone number** on the onboarding phone screen —
  stays off (the number is saved directly, as before) until WhatsApp is set
  up on the server.

### 1.9.11 — 2026-10-14
- Build 9, OTA 11.
- **Meal edits feel instant.** Portions, add-ons, swaps, skips and undo-skip
  show the moment you tap and save in the background (errors are shown and
  the plan corrects itself). My Plan reloads in one round trip, and the
  meal-edit functions are woken up when My Plan / Customize open — a cold
  function used to cost 2–7 s per tap. Adding a dish with several portions
  is one call instead of one per portion.
- **Bell shows every notification** — delivery updates, skips, wallet,
  refunds, cash received, promotions — not only app updates; refreshed when
  a push arrives, marked read when opened.
- **"Restart to update"** button next to the bell once an update has
  downloaded, and the app now looks for updates whenever it comes back to
  the foreground (at most every 30 min), not only on a cold start.
- **This week's menu** screen: Home's "Explore this week's menu" and a new
  calendar icon on My Plan open the subscribers' weekly menu (a card per
  day, tap for details); works signed out.
- **Phone number already in use** is shown as soon as 10 digits are typed
  on the phone screen (one account per number until OTP).

### 1.9.10 — 2026-10-14
- Build 9, OTA 10.
- **Cash on delivery pays the first day online.** The first day's meals are
  paid through Cashfree and the rest (a round ₹100 amount) in cash on the
  first delivery — no more delivering on credit. My Plan shows the cash due.
- **One menu for everyone** — the recommendation no longer splits into a
  separate gut-health menu.
- **Swaps are free** — no more ₹20 badge or swap-fee line.
- **Fewer portions for a day**: "−" goes down to 1 portion; removing the last
  one is a skip. **Undo skip** until the cutoff.
- **Delivery address per meal** right under the meal (extra dishes too), so a
  second portion can go to another address; "Add a dish" asks where to send
  it. Address book reachable from Account and My Plan, with "deliver all
  upcoming meals here"; removing an address works (archived if used).
- **Order history** (history icon on My Plan, or Account): every meal with
  dish, portions, add-ons, address, skip reason and what it cost.
- Real error messages instead of "non-2xx" on skip, swap, cart and dish edits.
- Phone screen reports a failed save (e.g. number already on another account)
  instead of looping.

### 1.9.9 — 2026-10-13
- Build 9, OTA 9.
- **Change password** (Account, email logins; re-checks the current one).
- **Set your own password on first sign-in** for accounts the admin created
  with a temporary password (user_metadata.must_change_password).
- **Sign-in methods card** (Account): link Google or Apple to the same
  account. Needs "Allow manual linking" on in Supabase Auth.
- **Password reset link works when it opens the app from closed** (cold start
  wasn't handled, so the reset screen timed out as "expired").
- **Closed-kitchen days** say so in My Plan, with the reason.
- **FSSAI licence number** on Contact Us (Lic. No. 12225026001073).

### 1.9.8 — 2026-10-13
- Build 9, OTA 8.
- **Meal photos open full-size.** The blurred preview shown while a dish photo
  downloads was drawn at its own tiny size (expo-image's default), so the first
  open of an uncached dish showed a small thumbnail. It now fills the frame.
- **Macro ring is honest.** Calories not covered by the macros entered for a
  dish show as a neutral grey segment; before, a dish with only protein entered
  showed a ring that was 100% protein-red.
- **Checkout waits for the server to activate the plan** (the app can no longer
  write plan status — migration 050), so My Plan opens on the active plan.
- **Contact Us shows the GSTIN** (FSSAI licence number appears once filled in).

### 1.9.7 — 2026-10-12
- Build 9, OTA 7.
- **Plan renewal.** When a plan's meals are used up, My Plan shows a "Renew
  plan" card that opens a sheet with four options: repeat the same plan, edit
  it (plan size, lunch/dinner per day, add-ons — live price), build a new plan
  through onboarding, or cancel. Repeat/edit create the new plan server-side
  (`renew-subscription`) and are paid through Cashfree like a first purchase;
  the sheet waits for the payment to be confirmed and the finished plan is
  closed automatically (its delivery batches carry over).
- **Low-wallet banner.** When a plan still has meals but the wallet can't cover
  the next one, My Plan says what it costs vs. the balance, with Add money.
- **Customer ID** (e.g. GF-000001) shown on the Account screen.
- Server-side changes that shipped alongside (no app update needed): balance
  checked at the 8 AM / 1 PM cutoffs, low-balance warning at 8 PM, refunds,
  customer codes, meals never scheduled past a plan's counter.

### 1.9.6 — 2026-10-11
- Build 9, OTA 6.
- **Wallet transactions show real dates.** The list ran full timestamps through
  the date-only formatter, which produced "Invalid Date" on every row. Rows now
  show date and time in IST (e.g. "10 Oct 2026, 3:36 pm"), newest first.

### 1.9.5 — 2026-10-10
- Build 9, OTA 5.
- **Home, My Plan and Menu refresh themselves.** New `useAutoRefresh` hook
  silently reloads on tab focus, when the app returns to the foreground, and
  every 5 minutes while the tab is open (30 s minimum gap). iOS users rarely
  close the app, so admin changes (menu swaps, delivered status, wallet
  debits) previously stayed invisible until a pull-to-refresh or relaunch.
  A failed background refresh now keeps the current screen instead of
  blanking My Plan or showing Home's error state.
- **My Plan shows delivered meals.** Delivered and out-for-delivery orders are
  now loaded, so a finished slot shows its cart with a Delivered badge instead
  of "No lunch on …". Such slots are locked (no Skip/Swap) and no longer count
  toward the low-balance warning.

### 1.9.4 — 2026-10-10
- Build 9, OTA 4.
- **Contact Us and Refunds & Cancellations pages added** (Account tab, next to
  Terms and Privacy). Cashfree's production whitelisting review requires a
  Contact Us page, a Terms page and a Refunds & Cancellations page inside the
  app; only Terms existed, with refund rules as one paragraph inside it. The
  refund policy is wallet-credit only, with a 2-hour claim window, 1-business-day
  response, and failed or duplicate online payments reversed by the payment
  provider to the original method. Terms and Privacy "Contact" sections now
  point to the Contact Us page.
- **Every WhatsApp support entry point now opens with a pre-written message**
  stating it came from the app, with the app version and the screen it was
  tapped from (shared `supportWhatsAppUrl` helper in `links.ts`). The Cash on
  Delivery confirmation message carries the same header.
- Published per platform (`--platform ios`, then `--platform android`),
  because `eas update`'s default web export fails on
  `react-native-cashfree-pg-sdk` (its `../package.json` import does not
  resolve under the web bundler).

### 1.9.3 — 2026-09-19
- Build 9, OTA 3.
- **Sign in with Apple no longer asks for a name Apple already gave us**
  (App Store guideline 4 rejection). Onboarding routed on `phone` alone, so
  every new account hit "What should we call you?" even when the name had
  been captured and written successfully. Routing is now name-aware: with a
  name on file, onboarding starts at the phone step instead.
- Three things had to line up for that to work. `public.users` is created by
  a trigger holding only `id`, and Apple's identity token carries no name, so
  the client-side credential is the single chance to capture it — it now
  stores given + family name rather than given alone. The auth store tracks
  `name` so the redirect can see it. And because Apple's name is written
  after the session lands, the redirect can already have pushed someone to
  the name screen before we know their name; it now moves them forward when
  the name arrives late instead of stranding them there.
- Note: Apple returns `fullName` only on the FIRST authorization per Apple
  ID. On any later sign-in it is null, and with no name on file the name
  screen legitimately appears — the framework genuinely has nothing to give.

### 1.9.2 — 2026-09-17
- Build 9, OTA 2.
- **Account deletion actually works now.** `orders.user_id` and
  `wallet_transactions.user_id` were still `ON DELETE NO ACTION`, so
  `auth.admin.deleteUser()` hit a foreign key violation for any account that
  had ever placed an order — surfaced in the app as the opaque "Edge Function
  returned a non-2xx status code". Migration 040 had fixed exactly this for
  `payments` and missed these two. Migration 043 cascades both. The admin
  dashboard never hit this because `wipeUserData()` deletes those rows by hand
  first; the in-app self-service path had no such workaround.
- **Delete confirmation no longer under-reports what's being lost.** The
  impact summary used `.maybeSingle()` on active subscriptions, which resolves
  to `{ data: null, error }` — not a throw — when an account has more than one.
  The catch never fired, so the dialog claimed "no active subscription" while
  silently hiding real deliveries about to be cancelled. It now sums every
  active/paused subscription.

### 1.9.1 — 2026-09-09
- Build 9, OTA 1.
- **Password reset added.** Email/password subscribers previously had no way
  back into a forgotten account — there was no "Forgot password?" anywhere in
  the app, and Google/Apple sign-in was the only recoverable path. Sign-in now
  links to a reset screen that emails a recovery link, and a new
  `/reset-password` route lets them set a new password from it.
- Two things had to change in the root layout for that to actually work:
  its always-mounted deep-link listener already exchanges any incoming
  `?code=`, so the reset screen must not exchange it a second time (PKCE
  codes are single-use); and the redirect effect now exempts
  `/reset-password`, since the session created by the recovery link would
  otherwise bounce an onboarded user straight to the tabs before they could
  type anything.

### 1.9.0 — 2026-08-22
- Build 9, OTA 0.
- **Real account deletion.** "Delete my account" in Account actually deletes
  the auth identity (not just app data) — snapshotted first into a new
  admin-only `deleted_accounts` archive, so support can still see order/
  wallet history without the account being recoverable. Same Google/Apple ID
  signing in again now creates a genuinely fresh account.
- **Cold-start bug fix**, confirmed via on-device logcat: a slow profile
  lookup on cold launch was defaulting `phone` to null on timeout, which
  force-navigated returning users into onboarding's name screen. Fixed —
  a timeout/failure never overwrites phone/onboarded anymore. Also added a
  local cache of the last known profile state so a returning user's routing
  resolves in ~150ms instead of waiting on the network at all.
- **All dev-only bypass UI removed** — no more skip-login, skip-payment, or
  fake-wallet-credit shortcuts in any build, including preview. Closed
  testers now go through the real OTP/OAuth and Cashfree flows.
- **Admin-editable menu catalogue.** New admin "Menu" page: create/edit/
  archive dishes and categories, with an in-browser image pipeline
  (auto-converts to optimized WebP at two sizes + a blur placeholder — no
  more manual Python scripts + app release to change the menu). Two flags
  per dish (`menu_visible`, `subscription_valid`) control whether it's
  browsable and/or orderable independently — a dish can be takeaway-only,
  shown with a Swiggy/Zomato link instead of Add-to-cart. Categories moved
  from a hardcoded array to a real table; defaults preserve today's exact
  menu with zero visible change until an admin edits something.
- iOS-only global scale increase — deferred to a future release; not in this
  build.

### 1.8.0 — 2026-08-18
- Build 8, OTA 0.
- **Requires a new native build, not just an OTA update** — adds the Sign in
  with Apple entitlement (native config) and a new native
  `AppleAuthenticationButton`.
- ⚠️ **The first Android build 8 artifact is dead — use the second one.** It
  crashed the whole app process during onboarding ("API key not found" from
  Google Maps). `react-native-maps`' config plugin *removes*
  `com.google.android.geo.API_KEY` from the AndroidManifest when it isn't
  passed `androidGoogleMapsApiKey` — it doesn't just skip Android — so the
  iOS-only plugin config added in the 1.7.1-era iOS build work had been
  silently deleting the Android key. Fixed by passing both keys; verified
  against the regenerated manifest. Version deliberately not bumped: the
  first artifact was never distributed, and both platforms stay on 1.8.0 for
  the same feature set. iOS was never affected.
- **Sign in with Apple now actually works.** The button and sign-in code
  already existed but had no native entitlement — `app.json` was missing
  `ios.usesAppleSignIn` and the `expo-apple-authentication` plugin, so
  `signInAsync()` threw at runtime. Also swapped the hand-rolled button for
  Apple's own `AppleAuthenticationButton` (their HIG requires it), and fixed
  a real bug: `credential.fullName` is only ever returned on the *first*
  authorization for a given Apple ID and was being discarded, so Apple
  sign-ups got no `users.name` and Home's greeting rendered blank forever —
  now persisted on first sign-in.
- **Fixed the Cashfree onboarding payment bug** (worked fine for wallet
  top-ups, got stuck spinning forever for a new subscription): the Cashfree
  SDK's `CFPaymentGatewayService` is a process-wide singleton with exactly
  one callback slot, and My Plan's wallet-topup screen stays mounted
  underneath onboarding (expo-router keeps a pushed-from screen alive) —
  whichever screen's cleanup fired last could silently unhook the other
  screen's listener, so a completed payment had nothing left to tell the
  onboarding screen. Both screens now go through a shared token-guarded
  wrapper so a stale cleanup can't tear down a listener that's still live.
  Also fixed the error message shown on failure: it was always the generic
  "Edge Function returned a non-2xx status code" regardless of the actual
  problem, because supabase-js never parses a non-2xx response body into
  `data` — the real `{ error: "..." }` body only lives in
  `error.context.json()`, which nothing was reading.
- **Sign-in screen redesign**: progressive disclosure (Google/Apple/email
  choice first, the email form only appears once chosen — removes the old
  screen's dead space without a layout trick), implied consent (deleted the
  checkbox — a pre-ticked box is the exact pattern regulators treat as
  invalid; replaced with a plain notice under the buttons), a real
  Google-branded button (was a blue "G" text glyph, not Google's mark), and
  a taller top-anchored hero photo instead of a fixed 200pt banner that
  cropped about half the bowl.
- **Admin can now set per-date meal/add-on availability and "Today's
  Special"** from the Kitchen tab. Subscribers see unavailable items greyed
  out with a reason (Menu, My Plan's day cart, the add-to-day sheet) rather
  than hidden — already-scheduled orders are never touched, only new
  choices for that date. Home's daily picks are now admin-controlled
  (falling back to the old rotation when nothing's set) and renamed to
  "Today's Special"; tapping a card now opens the same full dish detail view
  Menu uses (previously did nothing), with a real "Add to cart" that targets
  the next open delivery by name (e.g. "Add to today's dinner").
- **My Plan**: add-ons can now be added at more than one portion (a
  stepper, same as the existing meal-portion control — previously capped at
  one). Days that were never scheduled in your default plan (e.g. a weekday
  you didn't select) can now have a dish added directly instead of being a
  dead end with no way to open the day's editor.
- **Menu tab** cards show a short description instead of the protein/kcal
  badges (full nutrition still shown on the dish detail view).
- Fixed a live pricing bug: every meal swap showed "+₹20" even when it was
  actually the free counterpart-menu dish, because the app's own key had no
  read permission on the table that determines free swaps (`switch-meal`
  charged correctly server-side the whole time — only the displayed price
  was wrong).
- Various iOS-specific fixes found auditing for the platform: a carousel
  that could permanently desync after a rotation/split-screen (stale
  cached window width, never a Home-visible bug on a phone that's never
  rotated, but a real one), a shadow missing its offset (rendered as a
  symmetric halo on iOS instead of a cast shadow), a few tap targets under
  Apple's 44pt minimum, and font-scaling caps on a handful of fixed-width
  labels so very large accessibility text sizes don't clip them.

### 1.7.1 — 2026-08-13
- Build 7, OTA 1.
- Optimized app image loading performance:
  - Bundled Home Story Carousel images locally as compressed WebP assets (`farm.webp`, `kitchen.webp`, `door.webp`, `you.webp`), eliminating 10MB network payload for 0ms instant offline rendering.
  - Compressed all 20 food dish images to WebP format (>99% payload reduction from 10MB+ down to ~30-60KB each) and updated Supabase Storage with 1-year disk caching headers.
  - Added smooth `transition={200}` fade-in effects across `<Image>` components.
- Removed the OTA diagnostic panel (channel/source/updateId/runtime/log-check) from the Account screen — it was gated behind `SHOW_DEV_SKIP`, which the preview profile always sets, so it was showing on every test build. Dropped along with its now-unused `expo-updates` hooks and styles.
- Fixed an indefinite stuck-loading skeleton on the app's first cold launch of the day (worked fine on relaunch, which is why it went unnoticed for a while): `authLoading` had exactly one way to become `false` — `onAuthStateChange` firing — and supabase-js only fires that after restoring the session, which refreshes the token over the network first if it's expired. That refresh had no timeout, so a cold radio could stall it forever with zero logged errors, leaving every tab on its skeleton indefinitely. Added `withTimeout()` (`Promise.race` + `setTimeout`, deliberately not AbortController — the 1.6.5 attempt used AbortController and broke every Supabase call app-wide because signal support in this native build's fetch doesn't behave like browser/Node fetch, reverted in `8efa7f5`) and bounded session restore (10s), the profile lookup (10s), and Home's data fetch (15s). Verified on-device via airplane-mode repro.

### 1.7.0 — 2026-08-05
- Build 7, OTA 0.
- Replaced the WebView-embedded Cashfree checkout with Cashfree's official
  native React Native SDK (`react-native-cashfree-pg-sdk` +
  `cashfree-pg-api-contract`). Two WebView-specific bugs in a row (a
  redirect-timing bug causing false "success", then a real card payment
  failing before Cashfree even logged an attempt — likely a WebView/iframe
  cookie or environment incompatibility with the embedded `_modal` checkout)
  made clear this integration path wasn't reliable. The native SDK handles
  UPI/card/netbanking natively instead of through an injected web checkout,
  which is what Cashfree recommends for React Native apps.
  `CashfreeWebView.tsx` and `react-native-webview` are both removed —
  nothing else in the app used the WebView package.
- **Requires a new native build, not just an OTA update** — adds a native
  module and an iOS `Info.plist` entry (`LSApplicationQueriesSchemes` for
  UPI app deep links).

### 1.6.5 — 2026-08-05
- Build 6, OTA 5.
- Fixed a 50+ second stuck loading skeleton that only cleared after several
  app reopens: no Supabase call anywhere (auth session restore, REST
  queries) had a timeout, so a bad/black-holed connection could hang a
  request far longer than reasonable with nothing to fail it gracefully.
  Added a 15s AbortController timeout to the Supabase client's fetch,
  applied globally. Also wrapped the auth gate's profile lookup in a
  try/catch so a timeout there can't leave the app stuck waiting forever —
  it now falls back and lets the user retry once the network recovers.
  (Verified the classic supabase-js navigator-lock deadlock bug does NOT
  apply here — this version already defaults to lockless auth coordination,
  so applying that old fix would have been a regression.) JS-only.

### 1.6.4 — 2026-08-05
- Build 6, OTA 4.
- Fixed the wallet top-up checkout appearing as a squashed sliver at the
  bottom of My Plan instead of fullscreen: `CashfreeWebView` was rendered as
  a plain sibling `View` there (unlike the onboarding payment screen, which
  correctly wraps it in a real RN `<Modal>`). A bare View just takes
  whatever leftover space is left in the screen's normal layout; `<Modal>`
  renders to its own native fullscreen overlay regardless of where it sits
  in the tree. JS-only — no native config touched.

### 1.6.3 — 2026-08-05
- Build 6, OTA 3.
- Fixed Cashfree checkout firing "success" instantly with no payment made:
  `redirectTarget: "_self"` causes a full-page redirect, which inside a
  WebView resolves the checkout promise immediately with `{redirect: true}`
  the moment the redirect *starts* — not when payment finishes. Switched to
  `redirectTarget: "_modal"` (overlay, no navigation) and now only treat
  `result.paymentDetails` as completion, matching Cashfree's own docs.
  JS-only — no native config touched.

### 1.6.2 — 2026-08-05
- Build 6, OTA 2.
- Fixed slow cold start (10-20s skeleton on every app open): the auth store's
  single `loading` flag conflated "session restored" with "phone/onboarded
  profile looked up," so every tab's own data fetch (Home, My Plan, Account)
  was blocked behind an extra serial network round-trip it never actually
  needed. Split into `loading` (session only — what each tab's fetch waits
  on) and `profileLoading` (phone/onboarded lookup — only the redirect logic
  in `_layout.tsx` needs this). Removes one full round-trip from every cold
  start. JS-only change — no native config touched.

### 1.6.1 — 2026-08-05
- Build 6, OTA 1.
- Replaced Razorpay with Cashfree as the payment processor, everywhere —
  onboarding plan payment and wallet top-ups both now create Cashfree
  orders and checkout through a `CashfreeWebView` (same WebView + JS-SDK
  pattern as before, just Cashfree's checkout.js instead of Razorpay's).
  Test-mode credentials verified working end-to-end against Cashfree's
  sandbox Orders API. JS-only change — no native config touched.

### 1.6.0 — 2026-08-05
- Build 6, OTA 0.
- Fixed push notifications never actually registering — Android push via
  Expo requires the project's own Firebase (FCM V1) setup, which this app
  never had. Added `google-services.json` (client-side Firebase config,
  referenced via `app.json`'s new `android.googleServicesFile`) and
  uploaded the matching FCM V1 service-account key to EAS's Android
  credentials. Confirmed the missing `google-services.json` was the actual
  blocker — the EAS-side key alone wasn't enough, since the app itself has
  no way to reach Firebase without this file baked into the native build.
- **Requires a new native build, not just an OTA update** — this changes
  native Android config, same as the earlier splash-screen fix.

### 1.5.1 — 2026-07-30
- Build 5, OTA 1.
- Delivery cutoffs are now per-slot, same-day: lunch locks 8 AM IST, dinner
  locks 1 PM IST (both on the delivery date itself), replacing the old
  "everything locks at 8 PM the night before" rule. This is the client's
  explicit call ahead of rollout — kitchen/delivery lists need a hard,
  trustworthy freeze point per slot, not a blanket night-before cutoff.
- **Enforced server-side for the first time.** Every edit path (switch-meal,
  add-dish, update-day-cart, remove-dish, manage-subscription's skip) only
  ever rejected strictly-past dates, in UTC — there was no real cutoff
  enforcement anywhere before this. New Postgres function `is_slot_locked`
  (migration 031) is the single source of truth all five now call; verified
  directly against production at every boundary (yesterday/today/tomorrow ×
  both slots) before wiring it in.
- `src/lib/ist.ts`: `isDeliveryLocked(date)` → `isSlotLocked(date, slot)` +
  `isDayFullyLocked(date)`. Updated the three call sites (My Plan's day
  modal, Home's quick-add target selection, the Menu → Add-to-day sheet) to
  be slot-aware instead of date-only — Home's `findNextAddTarget` in
  particular was picking whichever slot happened to be first for a date,
  which could hand back an already-locked slot.
- My Plan also now locks a slot the moment its order reaches `preparing`,
  independent of the time cutoff — unlocking "today" under the new rule
  would otherwise expose Skip/Swap/Remove on a meal the kitchen already
  started.
- Updated every "8 PM the night before" reference (My Plan, Home's quick-add
  confirmation, the Add-to-day sheet, the Account FAQ, the Terms).

### 1.5.0 — 2026-07-13
- Build 5, OTA 0.
- Fixed the startup splash screen showing Expo's own default logo instead of
  GreenFeast's — `assets/images/splash-icon.png` turned out to be an
  unreplaced leftover copy of Expo's template asset (identical file size to
  `expo-logo.png`, dated the initial scaffold), and it was only wired up for
  Android in `app.json`, so iOS likely had the same problem. `app.json`'s
  `expo-splash-screen` plugin config now points at the real logo
  (`assets/images/logo.png`, the same mark used everywhere else in the app)
  for both platforms.
- Pause-subscription date-range calendar (`BookingCalendar`): the in-range
  tint was `Colors.primaryLight`, a hair off pure white — nearly invisible
  against the sheet's cream50 background, so the "connected band" fix from
  1.4.5 was technically correct but unreadable. Switched to `Colors.green100`
  (visibly green), dimmed disabled/past days to 40% opacity for clearer
  contrast against selectable ones, and bumped the day circle/text slightly
  for legibility.
- Meal detail's Zomato button: the brand SVG is a wordmark with a lot of
  built-in vertical padding, so at any button-sized icon dimension it
  rendered as an illegible squiggle (unlike Swiggy's icon, which is a
  compact mark and reads fine small). Replaced it with a bold italic
  "Zomato" text label instead of the glyph — removed the now-unused
  `ZomatoIcon` component.
- **Requires a new native build, not just an OTA update** — the splash fix
  is an `app.json`/native-asset change; the calendar/Zomato fixes are JS-only
  but are being held to ship in the same build rather than an OTA.

### 1.4.5 — 2026-07-13
- Build 4, OTA 5.
- Fixed two UI bugs: the "Tomorrow" day-cell label in the new Add-to-day
  sheet wrapped mid-word ("Tomorro"/"w") since it didn't fit the 56px cell —
  shortened to "Tmrw" (+ `numberOfLines={1}` as a backstop). The pause-
  subscription date-range calendar (`BookingCalendar`, range mode) tinted
  each in-range day as its own square with hard edges and left the
  start/end days untinted behind their selected circle (a visible gap) —
  now the whole span (including start/end) is tinted as one band, rounded
  at the true start/end and at each row's first/last column, so it reads
  as a connected pill like a normal booking-calendar range picker.

### 1.4.4 — 2026-07-12
- Build 4, OTA 4.
- Refer-a-friend WhatsApp card: added to the Account tab (was Home-only
  before); both the Home and Account cards are now WhatsApp-green
  (`Colors.whatsapp`) with a real WhatsApp glyph (new `WhatsAppIcon`
  component) instead of an emoji.
- Menu tab: tapping a meal now opens a full-screen detail view (was a
  partial bottom sheet) — full-bleed hero image, name, price, description,
  and a macro ring (protein/carbs/fat by calorie share, same style as the
  onboarding macro-breakdown card) with the exact-gram row underneath.
- Meal detail now has 4 CTAs: **Add to day** (opens a new day/slot/quantity
  picker — reuses the same `add-dish`/`update-day-cart` edge functions My
  Plan already uses, so anything added here shows up there too), **Swiggy**
  and **Zomato** (brand-colored buttons with real brand glyphs — new
  `SwiggyIcon`/`ZomatoIcon` components — linking to the restaurant's page on
  each), and **Takeaway** (placeholder, not wired up yet).
- New `src/components/AddToDaySheet.tsx`: subscriber-only picker for the next
  7 days, greys out locked days (past the 8 PM cutoff) or days with no
  scheduled delivery; non-subscribers see a "Build your plan" prompt instead.
- `supabase/migrations/028_meal_details_from_menu_csv.sql`: refreshes
  description/kcal/protein on 9 existing meal_templates rows from the
  kitchen's real POS menu export (only rows with a confident name+price
  match — nothing added, nothing renamed). **Run this migration whenever
  convenient — it only changes displayed copy/macros, the app doesn't
  depend on it.**

### 1.4.3 — 2026-07-11
- Build 4, OTA 3.
- Home screen: hero band (logo/greeting/headline/CTA above "Today's
  delivery") now has a green background, making the screen dual-tone
  instead of all-cream; text/icon colors flipped for contrast (white
  headline, light-green subtitle, white CTA pill with green text, white
  bell icon). Status bar icons switch to light while Home is focused (via
  useFocusEffect, since tabs stay mounted — a plain per-screen override
  would have leaked onto other tabs).
- Added visible spacing between the "Today's delivery" card and the
  "meals enjoyed" ring card (they read as one merged card before).

### 1.4.2 — 2026-07-11
- Build 4, OTA 2.
- Story carousel: real farm/kitchen/door/you photos, hosted in Supabase
  Storage (bucket `story-images`, 1-year cache) instead of bundled with the
  app — keeps them out of every future OTA payload and reuses the same
  disk-cache behavior as every meal photo. Requires running
  `scripts/upload-story-photos.ts` once to actually upload the 4 files.
- Fixed a real bug behind "images take 3-4 seconds to load every time I open
  the app": `scripts/upload-meal-photos.ts` never set `cacheControl` on
  upload, so Supabase defaulted to a 1-hour cache lifetime — every session
  more than an hour apart forced a full re-download regardless of the app's
  own `cachePolicy="memory-disk"`. Now set to 1 year for both meal photos
  and story photos going forward. Existing meal photos need re-uploading
  once (same script, unchanged files) to pick up the new header.

### 1.4.1 — 2026-07-11
- Build 4, OTA 1.
- Menu screen: configured the real Swiggy and Zomato links in the "Craving
  it right now?" footer (previously hidden placeholders). Takeaway/Maps
  link still pending.

### 1.4.0 — 2026-07-11
- Build 4, OTA 0.
- New native build. Embeds everything published as OTA updates since the
  last build (1.3.1–1.3.9) directly, so it all lands regardless of OTA
  state: month calendar strip, add-dish slot fixes, booking-style pause/skip
  calendars, back-navigation fix (root Stack), unified onboarding progress
  bar, sign-in redesign + consent flow, ruler/drag-card fixes, protein/fibre
  targets, address autocomplete, Home screen engagement overhaul (story
  carousel, progress ring, category deeplinks, daily picks, chef's note,
  referral card), and the status bar icon-color fix.

### 1.3.9 — 2026-07-11
- Build 3, OTA 9.
- Fixed status bar icons being white on a white/cream background app-wide
  (invisible/washed out). The global `<StatusBar style="light">` in
  `_layout.tsx` was hardcoded and never adapted per screen — every screen in
  the app has a light background, so it now defaults to `style="dark"`
  globally. The two screens with a full-bleed hero photo under the status
  bar (onboarding gate, sign-in) override it locally back to `style="light"`
  since white icons are correct there.

### 1.3.8 — 2026-07-11
- Build 3, OTA 8.
- Home screen engagement overhaul:
  - Replaced the 4 static "GreenFeast way" text cards with a full-bleed,
    auto-advancing photo carousel telling the farm → kitchen → door → you
    story (content in `src/constants/homeContent.ts` — swap in real
    farm/kitchen photos there anytime).
  - Today's delivery card now shows a photo, is tappable, and opens My Plan.
  - New deliveries progress ring ("X of Y meals enjoyed") for subscribers.
  - New category row — tap a category to deeplink straight into a
    pre-filtered Menu (`?category=` param).
  - New "Fresh from the kitchen" daily picks (2 dishes, rotate by date) with
    a one-tap-to-confirm "add to my next delivery" flow, reusing the
    existing `add-dish` function and the same 8 PM cutoff rule as My Plan
    (now shared via `isDeliveryLocked` in `src/lib/ist.ts`).
  - New rotating "chef's note" card and a refer-a-friend WhatsApp card.
  - Sections fade/slide in on load (Reanimated) instead of appearing all at
    once.
- Menu screen: added a "Craving it right now?" footer with Swiggy/Zomato/
  takeaway links (placeholders in `src/constants/links.ts` until real URLs
  are added — each button hides itself until configured).
- No new dependencies, no migrations, no edge-function changes — JS only.

### 1.3.7 — 2026-07-11
- Build 3, OTA 7.
- Sign-in: tapping Google/Apple/email sign-in without the Terms & Conditions
  box ticked now shows "Please tick the box below…" instead of the button
  silently doing nothing (buttons were disabled before, with no feedback).
  The message clears automatically when the box is ticked.
- Onboarding: the progress bar was scrolling away with the page on 7 screens
  (recommendation, plan, addon-upsell, days, address, summary, payment) —
  it's now a fixed header on all of them, matching how the Wizard-based
  screens (height/weight through allergies) already behaved.

### 1.3.6 — 2026-07-11
- Build 3, OTA 6.
- Address autocomplete now actually appears where the user reported it
  missing: it had only been wired into the Address book screen, not the
  **onboarding** Delivery Address screen (SF11) they were testing. Root
  cause confirmed live via adb: on 1.3.5, typing in SF11's street field
  produced zero network calls — the screen simply had no autocomplete code.
  The key + API were verified working via a direct curl (status OK).
- Extracted the logic into a shared `PlacesAutocomplete` component
  (`usePlacesAutocomplete` hook + `PredictionsDropdown`), now used by BOTH
  address forms, replacing the inline copy in the Address book screen.

### 1.3.5 — 2026-07-09
- Build 3, OTA 5.
- Recommendation carousel: all 4 cards are now a true fixed equal height
  (was only a `minHeight` before, so longer cards were still taller);
  each card scrolls internally if its content ever grows past that height.
- "Your menu style" card: bigger photo (140 → 220) to fill the extra space.
- Macro breakdown card: added an Apple-Health-style ring showing each
  macro's share of calories, colored per macro (protein/carbs/fat).
- Price breakdown card: added a matching ring showing base-plan cost's
  share of the total, in a single accent-green color (not per-macro colors).
- Address autocomplete: fixed predictions not appearing — added status/error
  logging to the Places API calls (silent failures are now visible via
  `adb logcat` if the key/API config is the issue) and switched the dropdown
  from absolute positioning to normal in-flow rendering, since an
  absolutely-positioned dropdown inside a ScrollView is unreliable on
  Android regardless of the API response.

### 1.3.4 — 2026-07-09
- Build 3, OTA 4.
- Fixed back navigation: root layout now uses a real `Stack` instead of a
  headless `Slot`, and Terms/Privacy moved into their own `(legal)` route
  group — swiping back from anywhere now returns to the actual previous
  screen instead of an unrelated one.
- Unified onboarding's 4 competing progress bars into a single "train track"
  `SectionProgress` (current section's segment expands with fine sub-step
  fill; others stay compact) — consistent from Height & Weight through
  Payment. Name/Phone no longer show a progress bar.
- Sign-in screen: added a hero photo and now owns the Terms/Privacy consent
  checkbox (gating Google/Apple/email sign-in); removed from the Name screen.
  Consent is recorded once, robustly, regardless of which auth path is used.
- Fixed the height/weight ruler's off-by-one display and the arrow-button/
  scroll desync; fixed the drag-to-rank goal card's shadow getting clipped by
  neighboring cards mid-drag; renamed "Eat cleaner" → "Gut health".
- Added protein + fibre daily target scales (replacing a plain text box) —
  now actually persisted to `dietary_profiles` (previously collected but
  never saved). Occupation's "Other" option now has a text field, plus 4 new
  preset options.
- Recommendation carousel cards are now evenly sized with no dead space;
  added a menu-style photo. Gate screen's hero photo now fades into the page
  background instead of cutting off sharply.
- Delivery address entry now shows live Google Places autocomplete
  suggestions while typing.
- Backend: new `protein_target`/`fibre_target` columns on `dietary_profiles`
  (migration 027, already run).

### 1.3.3 — 2026-07-09
- Build 3, OTA 3.
- My Plan: calendar strip now runs from subscription start through end of
  month (extending into next month near month-end) instead of stopping at
  Saturday of the current week.
- My Plan: adding a dish to a slot with no scheduled base order (e.g. "Add
  dinner" on a lunch-only plan) now works — it used to dead-end on "No
  delivery scheduled for this day."
- Plan Settings: removed "Change plan"; renamed "Edit delivery address" to
  "Address book"; Pause and Skip now use a full month-grid calendar
  (hotel-booking style) instead of scrollable date chips — pause has no
  length limit and can be resumed early anytime.
- My Plan: wallet modal button relabelled "Pay with Razorpay" → "Add money";
  "View transactions" is now a visible outlined button instead of a small
  text link.
- Backend: `add-dish` accepts an optional `meal_slot` so a dish can be added
  to a slot with no existing order (deployed ahead of this release).

### 1.3.2 — 2026-07-08
- Build 3, OTA 2.
- Republish of 1.3.1 — same app code, fixed update bundle. **Root cause of the
  entire "OTA updates never apply" saga found and fixed:** updates published
  with `--environment preview` take env vars from the EAS server environment
  (not local `.env` / `eas.json`), which was missing all `EXPO_PUBLIC_*` vars —
  so every published bundle crashed on launch (`supabaseUrl is required`) and
  was permanently blacklisted by expo-updates' anti-bricking recovery, leaving
  the embedded build running forever. All six vars now live in the EAS preview
  environment. Details in AGENTS.md "Known gotchas."
- The 1.3.1 update group is abandoned (broken bundle, blacklisted on devices
  that attempted it).

### 1.3.1 — 2026-07-08
- Build 3, OTA 1.
- Home: fixed "No delivery today" showing incorrectly on days with both a
  lunch and dinner order; fixed hero-to-section spacing.
- My Plan: fixed "View details" button text overflow; removed duplicate
  Skip/Pause tiles and Wallet/Address/Settings cards (consolidated into the
  hero card, Add Money modal, and Plan Settings); extra dishes are now
  removable before the cutoff; hero Skip button now skips only the viewed
  slot (lunch or dinner) instead of the whole day; week strip now
  auto-scrolls to today; fixed date-strip-to-hero-card spacing; fixed a
  dashed-border-sticking bug when switching between empty and populated days.
- Backend: new `remove-dish` edge function; `manage-subscription`'s skip
  handler now accepts an optional `meal_slot` (backward-compatible — Plan
  Settings' whole-day skip flow is unaffected).

### 1.3.0 — 2026-07-07
- Build 3, OTA 0.
- "Update downloaded" notification is now actionable: tapping it calls
  `Updates.reloadAsync()` to apply the pending update immediately instead of
  waiting for a cold-start relaunch.
- Added before/after `console.log` around every reload (updateId/channel/
  runtimeVersion/isEmbeddedLaunch) so `adb logcat` shows definitively whether
  a reload actually switched updates.
- Added a "Check update logs" diagnostic (dev-only) that calls
  `Updates.readLogEntriesAsync()` and displays expo-updates' own internal
  log entries (including error codes like `UpdateFailedToLoad`,
  `AssetsFailedToLoad`) directly in the Account screen.
- New build (not just OTA) so this ships regardless of the still-open OTA
  delivery investigation — see AGENTS.md known gotchas once resolved.

### 1.2.2 — 2026-07-06
- Build 2, OTA 2.
- Added a bell icon on Home with a local notification history (AsyncStorage),
  fed by real expo-updates lifecycle events: "Update downloaded — reopen to
  install" and "Update installed" (both OTA and native builds).
- Added placeholder Terms & Conditions / Privacy Policy documents, reachable
  from anywhere (required an AuthGate exemption for the new `legal` route
  group). Required consent checkbox added to the universal new-account gate
  (name.tsx); permanent view-only links added to the Account page.
- **Requires migration 026_terms_consent.sql to be run before this ships** —
  it adds `users.terms_accepted_at` / `users.terms_version`, which the
  signup flow now writes to.

### 1.2.1 — 2026-07-06
- Build 2, OTA 1.
- Implemented the true Guest App states from APP_FLOW.md (G1/G2/G4), which
  were never built — Home, Subscribe, and Account only ever handled the
  logged-in-no-subscription case, so an anonymous guest saw a broken blank
  profile instead of a Login/Sign Up prompt, and "Build your plan" pushed
  guests straight into the health wizard with no session.
- Home/Subscribe/Account now all wait for the auth store to finish resolving
  before deciding what to render, fixing a startup race that could briefly
  misrender the wrong state on cold launch.

### 1.2.0 — 2026-07-06
- Build 2, OTA 0.
- New native build. Embeds all fixes from 1.1.0–1.1.2 directly (nav bar
  insets, version display, tab bar press animation + crash fix) so they land
  regardless of OTA state.
- Added a dev-only updates diagnostic on the Account screen (channel / embedded
  vs OTA / updateId / runtime), gated behind SHOW_DEV_SKIP, to make OTA state
  visible on-device. Needed because OTA updates were not reaching an older
  install and the on-device channel/update state couldn't be inspected
  otherwise.

### 1.1.2 — 2026-07-02
- Build 1, OTA 2.
- Fixed a crash introduced in 1.1.1: expo-router's tab bar invokes
  `tabBarButton` as a plain function call rather than via JSX, so a component
  using Reanimated hooks directly couldn't be passed as that option — its
  hooks attached to the wrong fiber and crashed on mount. Fixed by wrapping it
  in JSX (`(props) => <TabBarButton {...props} />`) at the call site instead.

### 1.1.1 — 2026-07-02
- Build 1, OTA 1.
- Replaced the default Android ripple on the bottom tab bar with a custom
  scale/opacity press animation (Reanimated) and a light haptic tick.

### 1.1.0 — 2026-07-02
- Build 1, OTA 0.
- Fixed `eas.json` build profiles missing a `"channel"` key — every build made
  before this one had no update channel embedded, so no `eas update` could
  ever reach an installed app. New builds now correctly wire
  development/preview/production channels.
- Also carries everything already published to the `preview` OTA branch
  (Android 3-button nav bar inset fixes, in-app version display).

### 1.0.1 — 2026-07-02
- Build 0, OTA 1.
- Version control implemented.

### 1.0.0 — 2026-07-02
- Build 0, OTA 0.
- Versioning system introduced. This is the starting point for build/OTA
  tracking — earlier EAS builds made before this system existed are not
  retroactively numbered.
