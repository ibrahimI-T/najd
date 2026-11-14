from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "release" / "website-shot-review.jpg"
pairs = [
    (name, f"najd-agent-website/public/screenshots/{name}-ar.webp", f"najd-agent-website/public/screenshots/{name}-en.webp")
    for name in ("hero", "welcome", "commands", "plugins", "memory", "learning", "atlas", "approvals")
]
thumb_w, thumb_h, label_h = 480, 300, 28
sheet = Image.new("RGB", (thumb_w * 2, (thumb_h + label_h) * len(pairs)), "#101216")
draw = ImageDraw.Draw(sheet)
font = ImageFont.load_default(size=18)
for row, (name, ar, en) in enumerate(pairs):
    for col, rel in enumerate((ar, en)):
        image = Image.open(ROOT / rel).convert("RGB")
        image.thumbnail((thumb_w, thumb_h))
        x = col * thumb_w + (thumb_w - image.width) // 2
        y = row * (thumb_h + label_h) + label_h + (thumb_h - image.height) // 2
        sheet.paste(image, (x, y))
        draw.text((col * thumb_w + 10, row * (thumb_h + label_h) + 4), f"{name} / {'AR' if col == 0 else 'EN'}", fill="white", font=font)
sheet.save(OUT, quality=88, optimize=True)
print(OUT)
print(OUT.stat().st_size)
