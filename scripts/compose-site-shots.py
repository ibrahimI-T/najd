# Prepares the site and README screenshots from release/site-shots: puts the browser page and the NAJD side panel side by side (browser-<lang>),
# then writes WebP copies for najdagent.si (release/site-shots/webp) and PNG copies for the README (release/site-shots/readme).
# Usage: python scripts/compose-site-shots.py
import os
from PIL import Image

root = os.path.join(os.path.dirname(__file__), '..', 'release', 'site-shots')
webp = os.path.join(root, 'webp'); readme = os.path.join(root, 'readme')
os.makedirs(webp, exist_ok=True); os.makedirs(readme, exist_ok=True)

for lang in ('ar', 'en'):
    page = Image.open(os.path.join(root, f'page-{lang}.png')).convert('RGB')
    panel = Image.open(os.path.join(root, f'panel-{lang}.png')).convert('RGB')
    height = max(page.height, panel.height)
    canvas = Image.new('RGB', (page.width + 1 + panel.width, height), (46, 46, 46))
    # The panel sits on the side where a browser opens it: the right in English, the left in Arabic (Edge and Chrome mirror it).
    if lang == 'ar':
        canvas.paste(panel, (0, 0)); canvas.paste(page, (panel.width + 1, 0))
    else:
        canvas.paste(page, (0, 0)); canvas.paste(panel, (page.width + 1, 0))
    canvas.save(os.path.join(root, f'browser-{lang}.png'))

names = ['home', 'commands', 'task', 'approvals', 'memory', 'skills', 'plugins', 'browser']
for name in names:
    for lang in ('ar', 'en'):
        image = Image.open(os.path.join(root, f'{name}-{lang}.png')).convert('RGB')
        image.save(os.path.join(webp, f'{name}-{lang}.webp'), 'WEBP', quality=86, method=6)
        image.save(os.path.join(readme, f'{name}-{lang}.png'), optimize=True)
print('ok', len(names) * 2)
