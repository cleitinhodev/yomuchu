#!/usr/bin/env python3
"""Gera amostras/avulso/Capitulo 02 - Paginas Duplas: 12 páginas, com páginas duplas
(deitadas, 2x mais largas) nas posições 4 e 8. A posição 8 força uma página em branco
antes dela (paridade), como nos leitores de mangá de verdade."""
import os
from PIL import Image, ImageDraw, ImageFont
OUT = os.path.join(os.path.dirname(__file__), '..', 'amostras', 'avulso', 'Capitulo 02 - Paginas Duplas')
W, H = 760, 1080
SPREADS = {4, 8}
import sys
if os.path.exists(os.path.join(OUT, '..', '..', '.arte-real')) and '--forcar' not in sys.argv:
    print('amostras/ tem arte real (amostras/.arte-real); nada foi alterado. Use --forcar para recriar.')
    sys.exit(0)
os.makedirs(OUT, exist_ok=True)
for f in os.listdir(OUT): os.remove(os.path.join(OUT, f))
def font(sz):
    for p in ['/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', '/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf']:
        if os.path.exists(p): return ImageFont.truetype(p, sz)
    return ImageFont.load_default()
for n in range(1, 13):
    spread = n in SPREADS
    w = W * 2 if spread else W
    im = Image.new('RGB', (w, H), (250, 246, 236))
    d = ImageDraw.Draw(im)
    d.rectangle([24, 24, w - 25, H - 25], outline=(30, 30, 30), width=6)
    if spread:
        # céu em degradê + horizonte contínuo de ponta a ponta (mostra se as metades se encaixam)
        for y in range(30, H // 2):
            c = int(120 + 120 * y / (H / 2)); d.line([(30, y), (w - 31, y)], fill=(c // 2, c // 1.6 if False else int(c * 0.7), 230))
        d.rectangle([30, H // 2, w - 31, H - 31], fill=(70, 150, 90))
        d.ellipse([w // 2 - 160, H // 2 - 330, w // 2 + 160, H // 2 - 10], fill=(255, 205, 70), outline=(30, 30, 30), width=6)
        d.line([(30, H // 2), (w - 31, H // 2)], fill=(30, 30, 30), width=8)
        txt = f'PÁGINA DUPLA {n}'
        d.text((w // 2, H - 170), txt, fill=(20, 20, 20), font=font(84), anchor='mm')
        d.text((120, H - 90), '◀ esquerda', fill=(20, 20, 20), font=font(44), anchor='lm')
        d.text((w - 120, H - 90), 'direita ▶', fill=(20, 20, 20), font=font(44), anchor='rm')
    else:
        hue = [(232, 90, 90), (90, 140, 232), (90, 190, 120), (220, 160, 60)][n % 4]
        d.rectangle([60, 60, w - 61, H // 2], fill=hue, outline=(30, 30, 30), width=5)
        d.rectangle([60, H // 2 + 30, w // 2 - 15, H - 61], outline=(30, 30, 30), width=5)
        d.rectangle([w // 2 + 15, H // 2 + 30, w - 61, H - 61], outline=(30, 30, 30), width=5)
        d.text((w // 2, H // 4), str(n), fill=(255, 255, 255), font=font(220), anchor='mm', stroke_width=6, stroke_fill=(30, 30, 30))
        d.text((w // 2, H * 3 // 4), f'pág. {n}', fill=(30, 30, 30), font=font(56), anchor='mm')
    im.save(os.path.join(OUT, f'{n:02d}.jpg'), quality=82)
print('ok', OUT)
