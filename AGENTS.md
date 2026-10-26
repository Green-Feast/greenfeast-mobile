# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v56.0.0/ before writing any code.

# Project

GreenFeast is a Jaipur-based meal subscription startup. This repo (`greenfeast-mobile`,
local path `greenfeast-app`) is the subscriber-facing Expo React Native app. Sole developer
is Rudransh Nareda (final-year MBBS student, no formal CS background, learning full-stack
by building this — prefers first-principles technical explanations over analogies).

**This is the final production app for App Store / Play Store submission — not a demo, MVP,
or prototype.** Every change should be production-grade: no shortcuts, no "good enough for a
demo" reasoning, proper error handling at system boundaries, full UX polish.

Sibling repos: `greenfeast-admin` (Next.js admin dashboard), Supabase backend (auth, postgres,
edge functions). Payments via Cashfree.

# Git / GitHub

- Repo lives in the **Green-Feast** GitHub org (private): `github.com/Green-Feast/greenfeast-mobile`, branch `main`.
- **Push as the `greenfeast` account via `gh`, never as `rudranshnareda`** — that account has no access to the Green-Feast org and pushes will fail with "Repository not found". `gh auth status` should show `greenfeast` as active; if not, that's a red flag, stop and ask.
- Commit author identity is set via local git config: `greenfeast <greenfeast.tech@gmail.com>`.
- **Never add a `Co-Authored-By: Claude` trailer to commits.** The user wants commits attributed solely to the project identity.

# EAS builds and updates

- `eas.json` has three profiles: `development` (dev client, for `expo start`), `preview`
  (internal-distribution APK, side-loadable — this is the one used for day-to-day device
  testing), `production` (`.aab` for Play Store).
- Standard test build command: `npx eas build --platform android --profile preview --non-interactive`.
  Builds are queued and can take **hours**, not minutes — kick off in the background.
- `gh`/`eas` are already authenticated as the `greenfeast` account on this machine.
- **`eas build` is fine to run directly** — it only produces an installable artifact.
- **Never run `eas update` (OTA push) directly.** Commit the change and hand the user the
  exact `eas update` command to run themselves using the explicit format:
  `npx eas update --channel preview --message "v1.x.y: <description>"`
  They want to control the timing since OTA pushes go live to real users immediately. Native-only changes (new native deps, app.json
  native config like `adaptiveIcon`/`softwareKeyboardLayoutMode`) can't ship via OTA at all
  and require a full rebuild.

# Versioning

The app displays a custom `1.x.y` version on the Account screen (`src/constants/version.ts`),
independent of `app.json`'s `expo.version`. **`x` bumps only on a new `eas build` (and resets
`y` to 0); `y` bumps only on a new `eas update`.** Full workflow and changelog: `VERSION.md` at
the project root. **Never bump the version yourself unless the user explicitly approves a
release** — a commit landing on `main` is not, by itself, a release. If `VERSION.md` doesn't
reflect the latest commits, that's expected, not a bug to fix.

# Known gotchas

- **`eas.json` build profiles must each have a `"channel"` key** (`development`/`preview`/
  `production`, matching the EAS branch names). This is baked into the native binary at build
  time — a build made without it can **never** receive any `eas update`, no matter how many
  updates get published, because the installed app has no channel to check. This bit us once:
  every build made before 2026-07-02 had no channel set, so months of OTA updates silently
  went nowhere. If an OTA update doesn't seem to be reaching a device, check
  `eas build:list --json` for a `channel` field on the installed build before assuming
  anything else — a missing channel means only a fresh build can fix it, not another update.
- **OTA update bundles need the `EXPO_PUBLIC_*` env vars at publish time, and
  `--environment <env>` sources them ONLY from the EAS server environment (expo.dev), ignoring
  both local `.env` and `eas.json` `env` blocks.** This bit us for months (resolved
  2026-07-08): the EAS "preview" environment had no Supabase vars, so every update published
  with `--environment preview` shipped a bundle where `supabaseUrl` was `undefined`, crashed
  at module init on first launch, and was then **permanently blacklisted by expo-updates'
  anti-bricking error recovery** — the app silently fell back to the embedded bundle forever
  and re-downloaded/re-notified the same update on every launch. From the outside this looks
  identical to "updates download but never apply," with zero errors in
  `Updates.readLogEntriesAsync()`; the giveaways are the Expo dashboard's "Known crashes"
  count on the update, a brief grey flash on the first launch attempt, and
  `UpdatesErrorRecovery: falling back to older update` in logcat. The required vars now
  live in the EAS **preview** environment (`eas env:list --environment preview` to verify);
  the **production** environment must get the same vars **before** the first production OTA
  is ever published. Note: a blacklisted update is dead on that device — publish a new
  (fixed) update rather than expecting the old one to retry.
- `tsconfig.json`'s `@/assets/*` path alias maps to the **project-root** `assets/` folder,
  not `src/assets/` — the more general `@/*` → `./src/*` alias does NOT cover it. Any asset
  `require()`d via `@/assets/...` must physically live in root `assets/`, or Metro fails to
  resolve it at bundle time (this broke an EAS build once — JS bundling phase failure).
- Android adaptive icon: `android.adaptiveIcon.backgroundColor` (in `app.json`) is what's
  actually used, not a background image. The `foregroundImage` layer needs safe-zone padding
  — keep visible content to roughly the center 66% of the canvas — or it gets clipped by
  circular/squircle launcher masks.
- Keyboard handling uses `react-native-keyboard-controller` via a custom
  `KeyboardAwareScreen`/`useAutoFocus` wrapper in `src/components/keyboard/`, used across all
  onboarding text-input screens. Native dependency — needs a rebuild (not OTA-able) when it
  or its config changes.
- **`instantiate-orders` and `cashfree-webhook` must be deployed with `--no-verify-jwt`**
  (`npx supabase functions deploy instantiate-orders --no-verify-jwt`). Both are called with
  non-JWT credentials (the nightly Vercel cron sends `INTERNAL_FN_SECRET`; Cashfree sends a
  signed webhook), and both do their own auth in code. With the gateway's JWT check on, the
  cron got `401 Invalid JWT` before the function ran — orders were only ever created when a
  subscriber happened to open My Plan (its auto-sync sends a real user JWT). Found and fixed
  2026-10-10. There is no `supabase/config.toml`, so the flag must be passed on every deploy.
- **Cashfree webhooks: GreenFeast has its own account-level endpoint** (Cashfree → Developers →
  Webhooks, production: `…/functions/v1/cashfree-webhook`, version 2026-01-01, events success /
  failed / user-dropped payment). It is configured per environment — a missing production
  endpoint meant the first production top-up (2026-10-11) was paid but never credited; add the
  same endpoint under Test mode if sandbox is ever used again. The Cashfree account is shared
  with the restaurant's Petpooja POS (its endpoint and the `NOTIFY_URL` rows belong to the
  restaurant — never edit or delete them), so our endpoint also receives restaurant payments:
  `cashfree-webhook` ignores any order id that isn't `sub_…` or `topup_…`. Our orders do not set
  `order_meta.notify_url`, so the app does not depend on the restaurant's settings.
- **Money rules since migration 044 (2026-10-12 security fixes).** Customers can only UPDATE
  `orders.address_id` (column grant + `orders_guard_customer_update` trigger: open slot, own
  address) and cannot write `order_addons` at all — any new client-side write to orders or cart
  lines must go through an edge function. Delivery billing always recomputes the price
  (`recompute_order_cart`), never trusts `cart_total`. Wallets are credited only from money
  actually received: Cashfree payments via `cashfree-webhook` (`fund-subscription-wallet` only
  credits a payment already marked paid), and cash via the admin's "Record cash received"
  (`recordCashPayment`, reference `cash_<paymentId>`). Plan prices are computed server-side
  (`cashfree-create-order`); the amount the app sends is ignored.
- **Cash on delivery since migration 052 (2026-10-14).** App signups pay the first day's meals
  online (`cashfree-create-order {cod:true}`; the cash part is rounded down to ₹100) and the plan
  goes active with `subscriptions.cod_due_paise` left to collect — no delivering on credit.
  Only plans the admin sets up as cash on delivery have `cod_on_credit` (the billing functions
  and cutoff checks let those wallets go negative until the cash is recorded). Unpaid `pending`
  plans get no orders.
- **One menu (052).** `weekly_menu` only has `menu_type = 'M1'`; every plan is M1 and swaps are
  free (no "Meal switch" fee lines). "Same dish every day" is `customer_meal_rules` (per
  customer, survives renewals), applied by `instantiate-orders` ahead of the weekly menu.
- **Batches belong to addresses (052).** `addresses.batch_id_lunch/dinner`; trigger
  `orders_batch_from_address` sets every order's batch from its address and
  `addresses_batch_changed` moves upcoming orders when an address changes batch. The
  subscription-level batch columns are legacy. One default address per customer (partial unique
  index); customers change it with `set_default_address(id, move_upcoming)` and remove one with
  `archive_address(id)` (archived, not deleted, once orders used it).
- **Customer messages are templates (052).** Automated texts live in `notification_templates`
  (edited in admin → Notifications → Automated messages) and are sent with
  `notify_event(user, key, vars)` from SQL / edge functions or `notifyEvent()` in the admin —
  don't hard-code new message text.
- **WhatsApp OTP for the customer's number (061).** The onboarding phone screen asks the
  `phone-otp` edge function (`status` / `send` / `verify`); it sends a Meta Cloud API
  Authentication template and saves `users.phone` + `phone_verified_at` only after the code
  matches. Off (app saves the number directly, as before) until `WHATSAPP_TOKEN` and
  `WHATSAPP_PHONE_NUMBER_ID` are set; App Review numbers via `OTP_REVIEW_PHONES` /
  `OTP_REVIEW_CODE`. Customers can't write `phone_verified_at`, and changing the number
  themselves clears it (trigger `users_phone_unverify`).
- **Delivery partner app (057–060, 2026-10-17).** Its own Expo app, the greenfeast-delivery-partner
  repo (Android/iOS and a web version on Vercel). Partners sign in with their phone number and a
  password the admin sets (Delivery Partners → App login); the Supabase account is
  `p<10 digits>@partners.greenfeast.test` with `user_metadata.gf_account = 'partner'`, so
  `handle_new_auth_user` makes no `public.users` row for it (Auth sets app_metadata only after
  the insert). The app has no service key: everything goes through the `partner_*` functions
  (060), which check `current_partner()` and bill / message like admin Operations
  (`advance_order_delivered`, `notify_event`; `{rider}` in out_for_delivery). On orders:
  `delivery_partner_id`, `out_for_delivery_at` / `delivered_at` (stamped by trigger
  `orders_stamp_delivery` on every path), `delivery_issue` (a failed drop — unbilled until the
  office delivers it or skips it as `not_delivered`) and `delivery_photo_path` (private bucket
  `delivery-photos`; partners upload into today's folder via `is_active_partner()`). Cash a
  partner collects is a `cash_reports` row until the office records it. Customers see their
  rider via `my_riders(date)`.
- **Scheduled jobs live in the database (pg_cron, UTC), not only on Vercel.** Migration 045:
  `enforce_slot_balance('lunch'|'dinner')` at 8 AM / 1 PM IST skips orders the wallet can't
  cover before the kitchen cooks them; `warn_low_balance()` at 8 PM IST warns about tomorrow.
  Both notify through `notify_user()` (in-app row + Expo push via pg_net). List jobs with
  `select * from cron.job`. Order creation is still the Vercel cron (1 AM IST).
- **Meal ratings and app feedback (064, 2026-10-19).** Customers rate each delivered lunch / dinner
  (1–5★, chips, optional comment) from Home's card, a 3 PM / 9 PM push (`send_rating_asks`,
  template `rate_meal`, tap data `{type:'rate_meal', date, slot}`) or Order history (7-day window),
  and send feedback from Account. Every write goes through `rate_meal` / `dismiss_rating_prompt` /
  `send_app_feedback`; `my_rating_prompt()` picks the meal to ask about and records the ask — how
  often is `feedback_settings` (admin → Feedback). Customers can read only some columns of their own
  `meal_ratings`. 1–2★ ratings and feedback from live customers alert the admins (`notify_admins`).
  The rating sheet is app-wide (`RatingSheetHost` in the (app) layout, opened via `useRatingStore`).
  Account's "Rate us on the App Store" uses the write-review URL; Apple's automatic prompt
  (`expo-store-review`) needs a native build, so it waits for the next one.
- **Coupons (066, 2026-10-26).** A coupon (admin → Coupons) sets its own price for one meal on the
  15- and 30-meal plans (`plans.allow_coupons`; never the trial). A plan bought with one keeps that
  price in `subscriptions.meal_price_paise` (null = regular), and **every place that prices a meal
  must use it**: `subscription_meal_rate()` in SQL, `_shared/pricing.ts` (`mealRate`) in edge
  functions, `lib/pricing.ts` in the admin — otherwise a discounted wallet runs out before the plan
  ends. `coupon_quote()` is the only place that checks a code (who: new / renewal / selected
  customers; dates; per-plan price; limits). `cashfree-create-order` takes `coupon_code` (only for a
  pending plan, never a top-up) and records it on the payment; `cashfree-webhook` calls
  `apply_payment_coupon()` before activating, so orders are made at the coupon price. The app
  previews with `preview_coupon` / `my_coupon_offers` (`CouponField`).
- **Plans are data (`plans` table)** — trial 5, plan15, plan30, and plan60 (067: 60 meals,
  ₹14,340 = ₹239/meal, coupons allowed). Almost everything reads the table; the exceptions to update
  when adding a plan are `(onboarding)/payment.tsx`'s `PLAN_FALLBACK` (first draw before the row
  loads) and the `PlanId` type in `lib/recommendation.ts`. `plans.allow_cod` = cash on delivery is
  offered in the app (false for plan60 — `cashfree-create-order` refuses it; the admin can still set
  a cash plan up by hand). `cashfree-create-order` also refuses a payment whose on-screen amount
  (`amount_paise`) is lower than the real charge — an old app that doesn't know a plan's price.
  A new plan is inserted `is_active = false` and switched on once the app update that knows it is
  out.
- **Refunds** go through the admin Money tab: to wallet (store credit, `refundToWallet`) or to
  the bank via Cashfree (`admin-refund` edge function, `--no-verify-jwt`, INTERNAL_FN_SECRET),
  which debits the wallet first and is completed/reversed by `REFUND_STATUS_WEBHOOK`. Ledger:
  `refunds` table. Every user has a permanent `users.customer_code` (GF-000001…).
- **Renewals create a new subscription.** A plan is finished when `deliveries_remaining` hits 0;
  order creation never schedules past it and the cutoff check skips leftovers
  (`plan_finished`). My Plan's renew sheet (`RenewPlanSheet`) offers repeat / edit (via the
  `renew-subscription` function, which copies the plan into a new pending subscription with
  `renewed_from`), redo onboarding, or cancel. Payment goes through `cashfree-create-order` like a
  first purchase; on activation `retire_previous_subscriptions()` expires the finished plan,
  cancels its leftover orders and passes on its delivery batches.

# UI/UX design system

The app went through a full UI/UX rework (completed 2026-07-02) to a new design system:
Fraunces (headings) + Caveat (script accents) replacing Poppins, warm cream canvas, deep
forest-green primary (`#1B5E20`), a dedicated macro nutrition color palette, and shared
components (`OnboardingProgress`, `MacroRow`, `AllergenBadge`, `RulerPicker`). Haptic feedback
(`expo-haptics`) is wired throughout: Light on selections, Medium on primary actions, Success
notification on payment confirmation / welcome moments. All onboarding + app-tab screens have
been migrated. Legacy `Colors.*` aliases in `src/constants/colors.ts` still resolve to the
same hex values as the new named tokens, so old and new naming can coexist safely.
