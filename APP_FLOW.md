# GreenFeast App Flow

## Screen Code Reference

### INTRO (Guest Entry)

| Code | Screen | Next | Notes |
|------|--------|------|-------|
| 1A | Intro Card 1 | 1B | First launch card |
| 1B | Intro Card 2 | 1C | Second launch card |
| 1C | Intro Card 3 | 2A (Login) / Guest App | Skip or Login choice |

### SIGN UP / SIGN IN

| Code | Screen | Next | Notes |
|------|--------|------|-------|
| 2A | Phone (Login) | 2B | OAuth + email/password |
| 2B | OTP | 3A | Verify phone (if SMS) |
| 3A | Name | 3B | Confirm full name |
| 3B | Phone (Onboarding) | 3C | WhatsApp number |
| 3C | What Would You Like to Explore? | SF1 (Build Plan) / Logged In Guest App | Skip or proceed |

### BUILD PLAN SUBSCRIPTION FLOW

#### Health Profile & Questionnaire

| Code | Screen | Next | Notes |
|------|--------|------|-------|
| SF1 | Height & Weight | SF2 | Collect body metrics |
| SF2 | Rank Your Goals | SF3 | Drag-to-reorder: Weight loss, Energy, Muscle, Wellness |
| SF3 | How Do You Stay Active? | SF4 | Exercise type selection |
| SF4 | How Often Do You Train? | SF5 | Exercise frequency |
| SF5 | Daily Protein + Fibre Target | SF6 | Optional protein goal |
| SF6 | Occupation | SFQ1 | Collect occupation |
| SFQ1 | Dynamic Question 1 | SFQ2 | Based on primary goal |
| SFQ2 | Dynamic Question 2 | SF7 | Based on primary goal |
| SF7 | Allergies & Dietary | SF8 | Allergens + preference + free text |
| SF8 | Loading Screen | SF9 | Compute recommendation |

#### Plan Selection & Add-ons

| Code | Screen | Next | Notes |
|------|--------|------|-------|
| SF9 | Recommended Plan | SF10 | Carousel: Recommendation / Menu Style / Macros / Price |
| SF9B | Choose Different Plan | SF10 | Browse all plans |
| SF10 | When Do You Want Your Meals? | SF11 | Days (Mon–Sat) + Lunch/Dinner |

#### Address & Summary

| Code | Screen | Next | Notes |
|------|--------|------|-------|
| SF11 | Delivery Address | SF12 | Street + Pincode + Landmark + Type + Map pin |
| SF12 | Your Subscription | SF13 | Review summary (plan, meals, add-ons, address, price) |

#### Payment & Success

| Code | Screen | Next | Notes |
|------|--------|------|-------|
| SF13 | Payment Screen | SF13B | Online / COD choice |
| SF13B | Welcome to GreenFeast | Subscribed App | Success screen |

### GUEST APP (Unsubscribed, Not Logged In)

| Code | Screen | Navigation | Notes |
|------|--------|------------|-------|
| G1 | Home | Bottom Nav | "Build your plan" → Login (2A) |
| G2 | Subscribe | Bottom Nav | "Build your plan" → Login (2A) |
| G3 | Menu | Bottom Nav | Browse meals |
| G4 | Account | Bottom Nav | "Login / Sign Up" → Login (2A) |

### LOGGED IN GUEST APP (Logged In, No Subscription)

| Code | Screen | Navigation | Notes |
|------|--------|------------|-------|
| LG1 | Home | Bottom Nav | "Build your plan" → SF1 |
| LG2 | Subscribe | Bottom Nav | "Build your plan" → SF1 |
| G3 | Menu | Bottom Nav | Browse meals |
| LG4 | Account | Bottom Nav | Profile, settings, logout |

### SUBSCRIBED APP (Logged In, Has Subscription)

| Code | Screen | Navigation | Notes |
|------|--------|------------|-------|
| S1 | Home | Bottom Nav | Today's delivery, menu nudge |
| S2 | My Plan | Bottom Nav | **Cart** / Plan Settings / Wallet / Address |
| G3 | Menu | Bottom Nav | 2-column grid, category pills |
| S4 | Account | Bottom Nav | FAQ, WhatsApp, Logout, Legal |

### MY PLAN (S2) Sub-Screens

| Code | Screen | Notes |
|------|--------|-------|
| S2-Cart | Day/Slot Cart Modal | Edit meals, swap fee, add dish, skip |
| S2-Settings | Plan Settings | Pause/Resume, Extend, Cancel, etc. |
| S2-Wallet | Wallet Screen | Balance, transaction history |
| S2-Address | Address Screen | Add/edit delivery addresses |

### ACCOUNT (S4 / LG4) Sub-Screens

| Code | Screen | Notes |
|------|--------|-------|
| S4-FAQ | FAQ | Help articles |
| S4-WhatsApp | WhatsApp Link | Direct WhatsApp support |
| S4-Logout | Logout | Sign out |
| S4-Terms | Terms of Service | Legal |
| S4-Privacy | Privacy Policy | Legal |
| S4-Delete | Delete Account | Permanent deletion |

---

## Navigation Summary

```
LAUNCH
  ↓
1A → 1B → 1C (Skip/Login)
  ├─ Skip ───→ Guest App (G1-G4)
  └─ Login ──→ 2A → 2B → 3A → 3B → 3C (Skip/Build)
                        ├─ Skip ───→ Logged In Guest App (LG1-LG4)
                        └─ Build ──→ SF1 → ... → SF13B → Subscribed App (S1-S4)
```

---

## Notes

- **Code format:** Screen codes are short mnemonics (1A, SF1, S2, etc.) for quick reference.
- **SF** = Subscription Flow (onboarding wizard)
- **S** = Subscribed user (active plan)
- **G** = Guest (unsubscribed)
- **LG** = Logged-in guest (authenticated, no plan)
- All flows are gated by authentication status + subscription status + payment method (online/COD).
