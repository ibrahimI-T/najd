from pathlib import Path
from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "najd-agent-website" / "public" / "screenshots"
SHOTS = {
    "hero": "release/qa-slash-0.10.6/03-after-{lang}.png",
    "welcome": "release/qa-welcome-0.10.6/01-welcome-{lang}.png",
    "commands": "release/qa-slash-0.10.6/01-all-{lang}.png",
    "plugins": "release/qa-capabilities/{lang}-dark-1440.png",
    "memory": "release/qa-memory/{lang}-dark-1440.png",
    "learning": "release/qa-learning/{lang}-1440.png",
    "atlas": "release/qa-activity-ui-0.10.6/05-atlas-{lang}.png",
    "approvals": "release/qa-website-approvals/approval-{lang}.png",
}

OUTPUT.mkdir(parents=True, exist_ok=True)
for name, pattern in SHOTS.items():
    for language in ("ar", "en"):
        source = ROOT / pattern.format(lang=language)
        image = Image.open(source).convert("RGB")
        canvas = Image.new("RGB", (1440, 900), "#0b0d10")
        fitted = ImageOps.contain(image, canvas.size, Image.Resampling.LANCZOS)
        canvas.paste(fitted, ((canvas.width - fitted.width) // 2, (canvas.height - fitted.height) // 2))
        target = OUTPUT / f"{name}-{language}.webp"
        canvas.save(target, "WEBP", quality=90, method=6)
        print(f"{target.name}: {target.stat().st_size} bytes")
