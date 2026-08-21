import os
from PIL import Image

DOWNLOADS = os.path.join(os.path.expanduser('~'), 'Downloads')
OUT_DIR = os.path.join(os.path.dirname(__file__), '..', 'assets', 'store', 'screenshots')
os.makedirs(OUT_DIR, exist_ok=True)

# (source filename in Downloads, output name, crop-top px, crop-bottom px)
# Source screenshots are 720x1600. Status bar ~70px, gesture-nav bar ~40px.
SHOTS = [
    ('WhatsApp Image 2026-08-19 at 1.18.53 AM.jpeg', '01_home_hero.jpg'),
    ('WhatsApp Image 2026-08-19 at 1.18.54 A3M.jpeg', '02_home_story.jpg'),
    ('WhatsApp Image 2026-08-19 at 1.18.54 A2M.jpeg', '03_menu.jpg'),
    ('WhatsApp Image 2026-08-19 at 1.18.54 AM.jpeg', '04_my_plan.jpg'),
]

TOP_CROP = 70
BOTTOM_CROP = 40

for src_name, out_name in SHOTS:
    src_path = os.path.join(DOWNLOADS, src_name)
    if not os.path.exists(src_path):
        print(f'  SKIP  {src_name} — not found')
        continue
    img = Image.open(src_path)
    w, h = img.size
    cropped = img.crop((0, TOP_CROP, w, h - BOTTOM_CROP))
    out_path = os.path.join(OUT_DIR, out_name)
    cropped.save(out_path, quality=95)
    print(f'  OK    {out_name}  {cropped.size}')
