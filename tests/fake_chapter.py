#!/usr/bin/env python3
"""Gera as imagens do site falso usado pelo teste de "Abrir link": páginas reais, uma dupla e iscas
(botões, logo, banner, avatar, miniaturas, capa relacionada, GIF, SVG, arquivo minúsculo...).
Uso: fake_chapter.py PASTA_SAIDA"""
import sys, os, random
from PIL import Image, ImageDraw
out = sys.argv[1]; os.makedirs(out, exist_ok=True)
rnd = random.Random(7)

def noisy(w, h, label, seed):
    r = random.Random(seed)
    cell = 8
    small = Image.new('RGB', (w // cell + 1, h // cell + 1))
    px = small.load()
    base = r.randint(140, 235)
    for y in range(small.height):
        for x in range(small.width):
            v = max(0, min(255, base + r.randint(-70, 70)))
            px[x, y] = (v, v, max(0, min(255, v + r.randint(-20, 20))))
    im = small.resize((small.width * cell, small.height * cell), Image.NEAREST).crop((0, 0, w, h))
    d = ImageDraw.Draw(im)
    d.rectangle([20, 20, w - 20, h - 20], outline=(0, 0, 0), width=6)
    d.rectangle([w // 2 - 120, h // 2 - 40, w // 2 + 120, h // 2 + 40], fill=(255, 255, 255))
    d.text((w // 2 - 100, h // 2 - 10), label, fill=(0, 0, 0))
    return im

def save(im, name, **kw):
    im.save(os.path.join(out, name), **kw)

pages = {'p1': (800, 1200), 'p2': (800, 1200), 'p3': (780, 1170), 'p4': (800, 1200), 'p5': (830, 1245),
         'p6': (800, 1200), 'p7': (800, 1200), 'p8': (800, 1200), 'p9': (800, 1200), 'p10': (800, 1200)}
for i, (k, (w, h)) in enumerate(pages.items()):
    save(noisy(w, h, 'PAGINA ' + k, i + 1), k + '.jpg', quality=70)
save(noisy(400, 600, 'PAGINA p4 pequena', 44), 'p4_small.jpg', quality=70)            # versão menor (srcset 400w)
save(noisy(1600, 1200, 'DUPLA', 99), 'spread.jpg', quality=70)                            # dupla deitada (≈ 2× a largura)
# duplicata por conteúdo: mesmo arquivo com outro nome/URL
import shutil; shutil.copy(os.path.join(out, 'p3.jpg'), os.path.join(out, 'p3_copia.jpg'))
# versão PNG e WebP de páginas (formatos)
save(noisy(800, 1200, 'PAGINA png', 21), 'p11.png')
save(noisy(800, 1200, 'PAGINA webp', 22), 'p12.webp', quality=70)
# ---- iscas
save(Image.new('RGBA', (300, 100), (255, 80, 80, 255)), 'logo.png')
save(noisy(728, 90, 'BANNER', 31).convert('RGB'), 'banner.jpg', quality=70)
save(noisy(128, 128, 'avatar', 32), 'avatar.jpg', quality=80)
save(Image.new('RGBA', (32, 32), (0, 0, 0, 255)), 'btn.png')
save(noisy(120, 170, 'mini1', 33), 'thumb1.jpg', quality=70)
save(noisy(200, 280, 'mini2', 34), 'thumb2.jpg', quality=70)
save(noisy(300, 420, 'mini3', 35), 'thumb3.jpg', quality=70)
save(noisy(520, 740, 'CAPA RELACIONADA', 36), 'related.jpg', quality=70)               # passa no tamanho mínimo, mas não no grupo de resolução
save(noisy(800, 800, 'quadrada', 37), 'square.jpg', quality=70)                          # proporção 1:1
save(noisy(1400, 500, 'BANNER LARGO', 38), 'wide.jpg', quality=70)                       # 2,8:1
Image.new('L', (800, 1200), 245).save(os.path.join(out, 'tiny.jpg'), quality=10, optimize=True)             # tamanho certo, arquivo minúsculo
frames = [noisy(600, 900, 'gif%d' % i, 40 + i) for i in range(2)]
frames[0].save(os.path.join(out, 'anim.gif'), save_all=True, append_images=frames[1:], duration=100, loop=0)
open(os.path.join(out, 'icon.svg'), 'w').write('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1200"><rect width="800" height="1200" fill="red"/></svg>')
print('ok', len(os.listdir(out)))
