# The link preview picture for najdagent.si (1200x630): NAJD's gray emblem and name beside a real screenshot of the app's home screen.
# Usage: python scripts/make-og-image.py <website folder>
import os, sys
from PIL import Image, ImageDraw, ImageFont, ImageFilter

site = sys.argv[1]
here = os.path.join(os.path.dirname(__file__), '..')
W, H = 1200, 630
canvas = Image.new('RGB', (W, H), (14, 14, 14))
draw = ImageDraw.Draw(canvas)
# A soft blue light from the top right, the app's accent.
glow = Image.new('RGB', (W, H), (14, 14, 14))
ImageDraw.Draw(glow).ellipse((620, -360, 1500, 420), fill=(18, 52, 96))
canvas = Image.blend(canvas, glow.filter(ImageFilter.GaussianBlur(140)), 0.9)
draw = ImageDraw.Draw(canvas)

# The app's home screen, cut by the right edge, with rounded corners and a thin frame.
shot = Image.open(os.path.join(here, 'release', 'site-shots', 'home-en.png')).convert('RGB')
shot = shot.resize((900, 562), Image.LANCZOS)
mask = Image.new('L', shot.size, 0); ImageDraw.Draw(mask).rounded_rectangle((0, 0, shot.width - 1, shot.height - 1), 18, fill=255)
frame = Image.new('RGB', (shot.width + 4, shot.height + 4), (58, 58, 58))
fmask = Image.new('L', frame.size, 0); ImageDraw.Draw(fmask).rounded_rectangle((0, 0, frame.width - 1, frame.height - 1), 20, fill=255)
canvas.paste(frame, (548, 96), fmask)
canvas.paste(shot, (550, 98), mask)

emblem = Image.open(os.path.join(here, 'build', 'icon.png')).convert('RGBA').resize((120, 120), Image.LANCZOS)
canvas.paste(emblem, (72, 150), emblem)
fonts = 'C:/Windows/Fonts/'
bold = ImageFont.truetype(fonts + 'segoeuib.ttf', 64)
regular = ImageFont.truetype(fonts + 'segoeui.ttf', 30)
small = ImageFont.truetype(fonts + 'segoeui.ttf', 24)
draw.text((72, 300), 'NAJD AGENT', font=bold, fill=(242, 242, 242))
draw.text((74, 384), 'The AI agent for Windows', font=regular, fill=(170, 170, 170))
draw.text((74, 438), 'najdagent.si', font=small, fill=(122, 184, 255))
canvas.save(os.path.join(site, 'public', 'og-image.png'), optimize=True)
print('ok')
