import os
from PIL import Image

SRC_DIR = os.path.join(os.path.dirname(__file__), '..', 'assets', 'category_images')
TARGET_SIZE = 480  # comfortably above 3x density for the 64pt home-screen circle


def pad_to_square(img):
    """Pad with transparent pixels to a square canvas, centered — never crop,
    so nothing in the source image (e.g. off-center garnish) gets cut off."""
    w, h = img.size
    size = max(w, h)
    canvas = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    canvas.paste(img, ((size - w) // 2, (size - h) // 2), img)
    return canvas


def main():
    files = sorted(f for f in os.listdir(SRC_DIR) if f.lower().endswith('.png'))
    print(f"--- Converting {len(files)} category images to square transparent WebP ---")
    for filename in files:
        src_path = os.path.join(SRC_DIR, filename)
        out_name = os.path.splitext(filename)[0] + '.webp'
        out_path = os.path.join(SRC_DIR, out_name)

        orig_size = os.path.getsize(src_path)
        with Image.open(src_path) as img:
            img = img.convert('RGBA')  # keep alpha — quality=82 RGB would drop transparency
            img = pad_to_square(img)
            img = img.resize((TARGET_SIZE, TARGET_SIZE), Image.Resampling.LANCZOS)
            img.save(out_path, 'WEBP', quality=82, method=6)

        new_size = os.path.getsize(out_path)
        reduction = (1 - new_size / orig_size) * 100
        print(f"  {filename}: {orig_size/1024:.1f} KB -> {out_name}: {new_size/1024:.1f} KB ({reduction:.1f}% smaller)")


if __name__ == '__main__':
    main()
