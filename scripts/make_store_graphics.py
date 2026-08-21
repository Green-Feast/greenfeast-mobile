import os
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.join(os.path.dirname(__file__), '..')
ASSETS = os.path.join(ROOT, 'assets', 'images')
OUT_DIR = os.path.join(ROOT, 'assets', 'store')
os.makedirs(OUT_DIR, exist_ok=True)

GREEN900 = (22, 48, 26, 255)     # Colors.green900
GREEN700 = (27, 94, 32, 255)     # Colors.green700 (primary)
CREAM50 = (253, 250, 243, 255)   # Colors.cream50
YELLOW400 = (232, 203, 66, 255)  # Colors.yellow400
WHITE = (255, 255, 255, 255)

FRAUNCES_BOLD = os.path.join(ROOT, 'node_modules', '@expo-google-fonts', 'fraunces', '700Bold', 'Fraunces_700Bold.ttf')
INTER_MED = os.path.join(ROOT, 'node_modules', '@expo-google-fonts', 'inter', '500Medium', 'Inter_500Medium.ttf')


def make_icon():
    """512x512 Play Store listing icon — flatten the transparent-corner
    source icon onto a solid white square (Play's guidelines discourage
    transparency in the listing icon even though it's technically allowed)."""
    src = Image.open(os.path.join(ASSETS, 'icon.png')).convert('RGBA')
    canvas = Image.new('RGBA', src.size, WHITE)
    canvas.alpha_composite(src)
    canvas = canvas.resize((512, 512), Image.Resampling.LANCZOS)
    canvas.convert('RGB').save(os.path.join(OUT_DIR, 'play_store_icon.png'))
    print('play_store_icon.png -> 512x512')


def make_feature_graphic():
    """1024x500 Play Store feature graphic: brand-green field, logo mark on
    the left, wordmark + tagline on the right."""
    W, H = 1024, 500
    canvas = Image.new('RGBA', (W, H), GREEN900)
    draw = ImageDraw.Draw(canvas)

    # Icon mark, vertically centered on the left
    icon_size = 260
    icon = Image.open(os.path.join(ASSETS, 'icon.png')).convert('RGBA')
    icon = icon.resize((icon_size, icon_size), Image.Resampling.LANCZOS)
    icon_x, icon_y = 50, (H - icon_size) // 2
    canvas.alpha_composite(icon, (icon_x, icon_y))

    text_x = icon_x + icon_size + 50
    max_text_w = W - text_x - 40

    # Wordmark
    wordmark = 'GreenFeast'
    wm_size = 92
    while True:
        wordmark_font = ImageFont.truetype(FRAUNCES_BOLD, wm_size)
        wm_bbox = draw.textbbox((0, 0), wordmark, font=wordmark_font)
        if wm_bbox[2] - wm_bbox[0] <= max_text_w or wm_size <= 40:
            break
        wm_size -= 2
    wm_h = wm_bbox[3] - wm_bbox[1]

    # Tagline
    tagline = 'Fresh, macro-balanced meals, delivered daily'
    tl_size = 32
    while True:
        tagline_font = ImageFont.truetype(INTER_MED, tl_size)
        tl_bbox = draw.textbbox((0, 0), tagline, font=tagline_font)
        if tl_bbox[2] - tl_bbox[0] <= max_text_w or tl_size <= 18:
            break
        tl_size -= 1
    tl_h = tl_bbox[3] - tl_bbox[1]

    gap = 22
    block_h = wm_h + gap + tl_h
    start_y = (H - block_h) // 2

    draw.text((text_x, start_y - wm_bbox[1]), wordmark, font=wordmark_font, fill=CREAM50)
    draw.text((text_x, start_y + wm_h + gap - tl_bbox[1]), tagline, font=tagline_font, fill=YELLOW400)

    canvas.convert('RGB').save(os.path.join(OUT_DIR, 'feature_graphic.png'))
    print('feature_graphic.png -> 1024x500')


if __name__ == '__main__':
    make_icon()
    make_feature_graphic()
