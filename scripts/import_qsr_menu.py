"""
One-off bulk import for the finalized QSR menu (2026-08-21).

Merge rule (per explicit user decision, not a full wipe):
  - 5 dishes keep their existing id/slug and get UPDATED in place (name
    matched exactly, or a user-confirmed rename): mexican-fiesta-bowl,
    italian-harvest-bowl, thai-zen-bowl, bbq-protein-wrap, smoky-chipotle-wrap.
  - 22 dishes are brand new inserts (fresh slugs), including Umami Soba Bowl
    and Berry Bloom, which the user confirmed replace Japanese Umami Bowl and
    Berry Blast Smoothie respectively (different slug, so these are inserts,
    not updates — the old rows below cover archiving the ones they replace).
  - 15 dishes not in the new menu at all get archived (is_active=false) —
    every current dish that isn't one of the 5 above and isn't superseded by
    a rename: all 4 salads (new menu has no salad section), Japanese Umami
    Bowl, Korean Bibimbap Bowl, Mediterranean Mezze Bowl, Indian Spice Bowl,
    Mediterranean Falafel Wrap, Thai Peanut Wrap, both old toasts, Berry
    Blast/Green Detox/Tropical Protein smoothies.
  - Never a hard delete — matches the app's existing archive-only policy
    (orders.meal_template_id has no ON DELETE clause; see migration 041's
    notes and greenfeast-admin's archiveDish action).

Photos: bowls use the "(top)" shot per user decision. Panini and Wrap items
have no individual photo — the source manifest says they share one photo per
category, so all 3 Panini dishes get the Panini category art and all 3 Wrap
dishes get the Wrap category art (also a user-confirmed decision). Berry
Bloom has no source photo at all and ships with the app's existing
emoji-fallback (image fields left NULL).

Panini/Wrap per-item macros aren't in the source menu (only a category-wide
range is given, e.g. "395-500 kcal") — left NULL rather than fabricated from
a range; same treatment coffee gets for protein/carbs/fat/fibre (only kcal
given).

Run with:
  SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... python scripts/import_qsr_menu.py
"""
import base64
import io
import os
import sys
import time
import requests
from PIL import Image

SUPABASE_URL = os.environ["SUPABASE_URL"].rstrip("/")
SERVICE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
BUCKET = "meal-images"
SKU_DIR = r"C:\Users\rudra\Documents\Green Feast SKU Library\Green Feast SKU Library"

HEADERS = {
    "apikey": SERVICE_KEY,
    "Authorization": f"Bearer {SERVICE_KEY}",
}


def slugify(name: str) -> str:
    out = "".join(c.lower() if c.isalnum() else "-" for c in name)
    while "--" in out:
        out = out.replace("--", "-")
    return out.strip("-")


# ── Image pipeline (mirrors the admin Menu page's client-side pipeline —
#    900px full / 400px thumb WebP q82, plus a tiny blur placeholder) ──────

def fit(w, h, max_dim):
    if w <= max_dim and h <= max_dim:
        return w, h
    scale = max_dim / max(w, h)
    return round(w * scale), round(h * scale)


def to_webp_bytes(im: Image.Image, max_dim: int, quality: int) -> bytes:
    w, h = fit(im.width, im.height, max_dim)
    resized = im.resize((w, h), Image.Resampling.LANCZOS)
    buf = io.BytesIO()
    resized.save(buf, "WEBP", quality=quality, method=6)
    return buf.getvalue()


def blur_data_url(im: Image.Image) -> str:
    w, h = fit(im.width, im.height, 24)
    tiny = im.resize((w, h), Image.Resampling.LANCZOS)
    buf = io.BytesIO()
    tiny.save(buf, "WEBP", quality=40, method=6)
    b64 = base64.b64encode(buf.getvalue()).decode()
    return f"data:image/webp;base64,{b64}"


def upload(path: str, data: bytes, content_type: str):
    url = f"{SUPABASE_URL}/storage/v1/object/{BUCKET}/{path}"
    r = requests.post(
        url, headers={**HEADERS, "Content-Type": content_type, "x-upsert": "true"}, data=data
    )
    if r.status_code not in (200, 201):
        raise RuntimeError(f"upload {path} failed: {r.status_code} {r.text}")


def public_url(path: str) -> str:
    return f"{SUPABASE_URL}/storage/v1/object/public/{BUCKET}/{path}"


def process_and_upload(slug: str, src_path: str):
    """Returns (image_url, thumb_url, blur_data_url) for a dish, or (None, None, None)."""
    if not src_path or not os.path.exists(src_path):
        print(f"    no source image for {slug} ({src_path})")
        return None, None, None
    im = Image.open(src_path).convert("RGBA")
    stamp = int(time.time() * 1000)
    full_path = f"{slug}/{stamp}-full.webp"
    thumb_path = f"{slug}/{stamp}-thumb.webp"
    upload(full_path, to_webp_bytes(im, 900, 82), "image/webp")
    upload(thumb_path, to_webp_bytes(im, 400, 82), "image/webp")
    blur = blur_data_url(im)
    print(f"    uploaded {full_path}, {thumb_path}")
    return public_url(full_path), public_url(thumb_path), blur


# ── Menu data ───────────────────────────────────────────────────────────

def p(name):
    return os.path.join(SKU_DIR, "Screen 1 - Power Bowls", f"{name}.png")


PANINI_ART = os.path.join(SKU_DIR, "Screen 2 - Wraps, Paninis & Toasts", "_Panini Range (category photo).png")
WRAP_ART = os.path.join(SKU_DIR, "Screen 2 - Wraps, Paninis & Toasts", "_Wraps (category photo).png")


def t(name):
    return os.path.join(SKU_DIR, "Screen 2 - Wraps, Paninis & Toasts", f"{name}.png")


def b(name):
    return os.path.join(SKU_DIR, "Screen 3 - Beverages", f"{name}.png")


# (id, updates existing row?) — the 5 that keep their current slug
EXISTING_ID_OVERRIDES = {
    "Mexican Fiesta Bowl": "mexican-fiesta-bowl",
    "Italian Harvest Bowl": "italian-harvest-bowl",
    "Thai Zen Bowl": "thai-zen-bowl",
    "BBQ Protein Wrap": "bbq-protein-wrap",
    "Smoky Chipotle Wrap": "smoky-chipotle-wrap",
}

# Dishes archived because the new menu drops them, or a rename supersedes them.
ARCHIVE_IDS = [
    "indian-spice-bowl", "japanese-umami-bowl", "korean-bibimbap-bowl", "mediterranean-mezze-bowl",
    "asian-sesame-salad", "caesar-power-salad", "greek-quinoa-salad", "moroccan-chickpea-salad",
    "berry-blast-smoothie", "green-detox-smoothie", "tropical-protein-smoothie",
    "avocado-smash-toast", "egg-white-toast",
    "mediterranean-falafel-wrap", "thai-peanut-wrap",
]

DISHES = [
    # ── Power Bowls ──
    dict(name="Mexican Fiesta Bowl", category="bowl", price=349,
         description="Brown rice, beans, pineapple salsa, guacamole, charred corn, nachos, veggies, hydroponic greens, chipotle dressing",
         kcal=490, protein=19, fibre=12, tags=["GF", "High Fibre"], img=p("Mexican Fiesta Bowl (top)")),
    dict(name="Mediterranean Bliss Bowl", category="bowl", price=349,
         description="Couscous, paneer, chickpeas, beetroot hummus, roasted beetroot, pickled cabbage, veggies, hydroponic greens, tahini dressing",
         kcal=510, protein=23, fibre=14, tags=["High Protein", "Most Loved"], img=p("Mediterranean Bliss Bowl (top)")),
    dict(name="Umami Soba Bowl", category="bowl", price=349,
         description="Soba noodles, paneer, broccoli, pickled cabbage, veggies, hydroponic greens, peanut dressing",
         kcal=500, protein=20, fibre=12, tags=["Contains Nuts", "Chef's Special"], img=p("Umami Soba Bowl (top)")),
    dict(name="Italian Harvest Bowl", category="bowl", price=349,
         description="Creamy spinach pasta, herbed feta, olives, mushroom, broccoli, veggies, green goddess dressing",
         kcal=530, protein=18, fibre=12, tags=[], img=p("Italian Harvest Bowl (top)")),
    dict(name="Quinoa Buddha Bowl", category="bowl", price=349,
         description="Quinoa, paneer, herbed chickpeas, roasted beetroot, veggies, hydroponic greens, mango dressing",
         kcal=500, protein=21, fibre=11, tags=["GF", "High Protein"], img=p("Quinoa Buddha Bowl (top)")),
    dict(name="Thai Zen Bowl", category="bowl", price=349,
         description="Brown rice, chilli tofu, veggies, hydroponic greens, peanut dressing",
         kcal=480, protein=18, fibre=13, tags=["GF", "Contains Nuts"], img=p("Thai Zen Bowl (top)")),
    dict(name="Burrito Bowl", category="bowl", price=349,
         description="Brown rice, paneer, mixed beans, charred corn, guacamole, pineapple salsa, sour cream, nachos, veggies, chipotle dressing",
         kcal=550, protein=24, fibre=13, tags=["GF", "High Protein"], img=p("Healthy Burrito Bowl (top)")),
    dict(name="Avo Protein Bowl", category="bowl", price=349,
         description="Quinoa, chilli tofu, guacamole, broccoli, pickled cabbage, veggies, hydroponic greens, honey mustard dressing",
         kcal=510, protein=21, fibre=11, tags=[], img=p("Avo Protein Bowl (top)")),
    dict(name="Tropical Fruit Bowl", category="bowl", price=299,
         description="Pineapple, sunmelon, Valencia orange, kiwi, blueberry, red grapes, seeds, lemon honey dressing (seasonal fruits)",
         kcal=190, protein=3.5, fibre=6, tags=[], img=p("Tropical Fruit Salad (top)")),

    # ── Panini (new category; per-item macros not given, only a range) ──
    dict(name="Peri Peri Paneer Panini", category="panini", price=349,
         description="Peri peri paneer, cheese, assorted veggies, hydroponic lettuce, peri peri dip",
         kcal=None, protein=None, fibre=None, tags=[], img=PANINI_ART),
    dict(name="Green Goddess Panini", category="panini", price=349,
         description="Grilled paneer, guacamole, cheese, cucumber, hydroponic lettuce",
         kcal=None, protein=None, fibre=None, tags=["Less Spicy"], img=PANINI_ART),
    dict(name="Plant Protein Panini", category="panini", price=349,
         description="Soya kebab, cheese, assorted veggies, hydroponic lettuce, tandoori dip",
         kcal=None, protein=None, fibre=None, tags=["High Protein"], img=PANINI_ART),

    # ── Wraps (per-item macros not given, only a range) ──
    dict(name="BBQ Protein Wrap", category="wrap", price=349,
         description="Beetroot tortilla, tandoori paneer, cheese, assorted veggies, hydroponic lettuce, peri peri dip",
         kcal=None, protein=None, fibre=None, tags=["High Protein"], img=WRAP_ART),
    dict(name="Plant Protein Soya Wrap", category="wrap", price=349,
         description="Wheat tortilla, soya kebab, cheese, vegetables, hydroponic lettuce, tandoori dip",
         kcal=None, protein=None, fibre=None, tags=[], img=WRAP_ART),
    dict(name="Smoky Chipotle Wrap", category="wrap", price=349,
         description="Beetroot tortilla, paneer, pineapple salsa, guacamole, mixed beans, cheese, assorted veggies, hydroponic lettuce, chipotle dressing",
         kcal=None, protein=None, fibre=None, tags=[], img=WRAP_ART),

    # ── Open Toasts ──
    dict(name="Avo Feta Toast", category="toast", price=329,
         description="Sourdough, guacamole, feta cheese, cherry tomato, seed mix, pomegranate",
         kcal=325, protein=8, fibre=7, tags=[], img=t("Avo Feta Toast")),
    dict(name="Earthy Hummus Toast", category="toast", price=329,
         description="Sourdough, hummus, Parmesan cheese, saute mushroom, olives, parsley",
         kcal=345, protein=15, fibre=7, tags=[], img=t("Earthy Hummus Toast")),

    # ── Functional Smoothies ──
    dict(name="Blue Mind", category="smoothie", price=299,
         description="Strawberry, blue spirulina, banana, Greek yoghurt, coconut milk",
         kcal=190, protein=7, fibre=4, tags=["Antioxidant"], img=b("Blue Mind")),
    dict(name="Going Nuts", category="smoothie", price=299,
         description="Peanut butter, ashwagandha, cocoa, banana, oat milk, sea salt",
         kcal=235, protein=9, fibre=5, tags=["Contains Nuts", "Low Cortisol"], img=b("Going Nuts")),
    dict(name="Avo Clarity", category="smoothie", price=299,
         description="Avocado, shatavari, banana, oat milk, granola, chia seeds",
         kcal=280, protein=5, fibre=9, tags=["Contains Nuts", "Gut Health"], img=b("Avo Clarity")),
    dict(name="Purple Pulse", category="smoothie", price=299,
         description="Blueberry, brahmi, banana, coconut milk, Greek yoghurt",
         kcal=220, protein=8, fibre=5, tags=["Focus"], img=b("Purple Pulse")),
    dict(name="Cocoa Core", category="smoothie", price=299,
         description="Chocolate, cocoa, mulethi, banana, oat milk, almond flakes",
         kcal=340, protein=9, fibre=5, tags=["Contains Nuts", "Balance"], img=b("Cocoa Core")),
    dict(name="Berry Bloom", category="smoothie", price=299,
         description="Mixed berries, blue spirulina, banana, coconut milk",
         kcal=195, protein=6, fibre=6, tags=["Antioxidant"], img=None),

    # ── Coffee (new category; only kcal given) ──
    dict(name="Iced Cold Brew", category="coffee", price=250,
         description="Iced cold brew coffee (300 ml)",
         kcal=5, protein=None, fibre=None, tags=[], img=b("Cold Brew")),
    dict(name="Vietnamese Cold Brew", category="coffee", price=250,
         description="Vietnamese-style cold brew coffee (300 ml)",
         kcal=145, protein=None, fibre=None, tags=[], img=b("Vietnamese Cold Brew")),
    dict(name="Ginger Ale Cold Brew", category="coffee", price=250,
         description="Cold brew coffee with ginger ale (300 ml)",
         kcal=60, protein=None, fibre=None, tags=[], img=b("Gingerale Cold Brew")),
    dict(name="Iced Latte", category="coffee", price=250,
         description="Iced latte made with oat milk (300 ml)",
         kcal=85, protein=None, fibre=None, tags=[], img=b("Iced Latte")),
]


def main():
    print(f"Importing {len(DISHES)} dishes...")
    for d in DISHES:
        slug = EXISTING_ID_OVERRIDES.get(d["name"], slugify(d["name"]))
        print(f"  {d['name']} -> {slug}")
        image_url, thumb_url, blur = process_and_upload(slug, d["img"])

        payload = {
            "id": slug,
            "name": d["name"],
            "category": d["category"],
            "description": d["description"],
            "short_description": None,
            "price": d["price"] * 100,
            "kcal": d["kcal"],
            "protein": d["protein"],
            "carbs": None,
            "fat": None,
            "fibre": d["fibre"],
            "tags": d["tags"],
            "is_active": True,
            "menu_visible": True,
            "subscription_valid": True,
        }
        if image_url:
            payload["image_url"] = image_url
            payload["thumb_url"] = thumb_url
            payload["blur_data_url"] = blur

        r = requests.post(
            f"{SUPABASE_URL}/rest/v1/meal_templates?on_conflict=id",
            headers={**HEADERS, "Content-Type": "application/json",
                     "Prefer": "resolution=merge-duplicates,return=minimal"},
            json=payload,
        )
        if r.status_code not in (200, 201, 204):
            print(f"    UPSERT FAILED: {r.status_code} {r.text}")
            sys.exit(1)

    print(f"\nArchiving {len(ARCHIVE_IDS)} dishes not in the new menu...")
    r = requests.patch(
        f"{SUPABASE_URL}/rest/v1/meal_templates?id=in.({','.join(ARCHIVE_IDS)})",
        headers={**HEADERS, "Content-Type": "application/json", "Prefer": "return=minimal"},
        json={"is_active": False},
    )
    if r.status_code not in (200, 204):
        print(f"  ARCHIVE FAILED: {r.status_code} {r.text}")
        sys.exit(1)

    print("\nDone.")


if __name__ == "__main__":
    main()
