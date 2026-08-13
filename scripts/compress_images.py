import os
from PIL import Image

def compress_story_images():
    story_dir = os.path.join(os.path.dirname(__file__), '..', 'assets', 'images')
    files = ['farm.png', 'kitchen.png', 'door.png', 'you.png']
    print("--- Compressing Story Images ---")
    for filename in files:
        src_path = os.path.join(story_dir, filename)
        if not os.path.exists(src_path):
            print(f"Skipping {filename} - not found at {src_path}")
            continue
        
        orig_size = os.path.getsize(src_path)
        out_name = os.path.splitext(filename)[0] + '.webp'
        out_path = os.path.join(story_dir, out_name)
        
        with Image.open(src_path) as img:
            img = img.convert('RGB')
            # Resize if max dimension > 1080
            max_dim = 1080
            if max(img.size) > max_dim:
                scale = max_dim / float(max(img.size))
                new_size = (int(img.size[0] * scale), int(img.size[1] * scale))
                img = img.resize(new_size, Image.Resampling.LANCZOS)
            
            img.save(out_path, 'WEBP', quality=82, method=6)
        
        new_size = os.path.getsize(out_path)
        reduction = (1 - new_size / orig_size) * 100
        print(f"  {filename}: {orig_size/1024:.1f} KB -> {out_name}: {new_size/1024:.1f} KB ({reduction:.1f}% reduction)")

def compress_food_images():
    food_dir = os.path.join(os.path.dirname(__file__), '..', 'assets', 'food')
    if not os.path.exists(food_dir):
        return
    print("\n--- Compressing Local Food Assets ---")
    for filename in os.listdir(food_dir):
        if not filename.lower().endswith(('.jpg', '.jpeg', '.png')):
            continue
        src_path = os.path.join(food_dir, filename)
        orig_size = os.path.getsize(src_path)
        out_name = os.path.splitext(filename)[0] + '.webp'
        out_path = os.path.join(food_dir, out_name)
        
        with Image.open(src_path) as img:
            img = img.convert('RGB')
            max_dim = 800
            if max(img.size) > max_dim:
                scale = max_dim / float(max(img.size))
                new_size = (int(img.size[0] * scale), int(img.size[1] * scale))
                img = img.resize(new_size, Image.Resampling.LANCZOS)
            
            img.save(out_path, 'WEBP', quality=82, method=6)
        
        new_size = os.path.getsize(out_path)
        reduction = (1 - new_size / orig_size) * 100
        print(f"  {filename}: {orig_size/1024:.1f} KB -> {out_name}: {new_size/1024:.1f} KB ({reduction:.1f}% reduction)")

def compress_professional_shoot():
    shoot_dir = r'C:\Users\rudra\Documents\Greenfeast\Assets\Green Feast Salad Pics Professional shoot'
    out_dir = os.path.join(os.path.dirname(__file__), '..', 'assets', 'food_compressed')
    if not os.path.exists(shoot_dir):
        print(f"\nProfessional shoot directory not found: {shoot_dir}")
        return
    os.makedirs(out_dir, exist_ok=True)
    print(f"\n--- Compressing Professional Shoot Images to {out_dir} ---")
    for filename in os.listdir(shoot_dir):
        if not filename.lower().endswith(('.jpg', '.jpeg', '.png')):
            continue
        src_path = os.path.join(shoot_dir, filename)
        orig_size = os.path.getsize(src_path)
        out_name = os.path.splitext(filename)[0] + '.webp'
        out_path = os.path.join(out_dir, out_name)
        
        try:
            with Image.open(src_path) as img:
                img = img.convert('RGB')
                max_dim = 900
                if max(img.size) > max_dim:
                    scale = max_dim / float(max(img.size))
                    new_size = (int(img.size[0] * scale), int(img.size[1] * scale))
                    img = img.resize(new_size, Image.Resampling.LANCZOS)
                
                img.save(out_path, 'WEBP', quality=82, method=6)
            
            new_size = os.path.getsize(out_path)
            reduction = (1 - new_size / orig_size) * 100
            print(f"  {filename}: {orig_size/1024:.1f} KB -> {out_name}: {new_size/1024:.1f} KB ({reduction:.1f}% reduction)")
        except Exception as e:
            print(f"  Error processing {filename}: {e}")

if __name__ == '__main__':
    compress_story_images()
    compress_food_images()
    compress_professional_shoot()
