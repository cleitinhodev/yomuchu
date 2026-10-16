#!/usr/bin/env python3
"""Folha de contato dos ícones (para conferir a legibilidade): 16, 24, 32 e 48 px ampliados sem suavização
(vizinho mais próximo) sobre fundo escuro e claro, tamanho real, e o de 256 px. Saída: screenshots/icones-contato.png"""
import os
from PIL import Image, ImageDraw
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
R = os.path.join(ROOT, 'build', 'icons')
DARK, LIGHT = (20, 12, 36), (245, 240, 251)
load = lambda n: Image.open(os.path.join(R, f'{n}x{n}.png')).convert('RGBA')
def tile(im, bg, z):
    t = Image.new('RGBA', (im.width * z, im.height * z), bg + (255,)); t.alpha_composite(im.resize((im.width * z, im.height * z), Image.NEAREST)); return t.convert('RGB')
W = 1000
sheet = Image.new("RGB", (W, 1800), (40, 40, 48)); d = ImageDraw.Draw(sheet); y = 10
for n, z in [(16, 16), (24, 12), (32, 9), (48, 6)]:
    d.text((10, y), f'{n} px, ampliado {z}x (vizinho mais próximo), fundo escuro e claro', fill=(255, 255, 255))
    sheet.paste(tile(load(n), DARK, z), (10, y + 14)); sheet.paste(tile(load(n), LIGHT, z), (10 + n * z + 10, y + 14)); y += n * z + 30
d.text((10, y), 'tamanho real (1x): 16, 24, 32, 48 sobre escuro e claro', fill=(255, 255, 255)); y += 16
x = 10
for bg in (DARK, LIGHT):
    for n in (16, 24, 32, 48):
        sheet.paste(tile(load(n), bg, 1).resize((n, n)), (x, y)); x += n + 14
y += 64
d.text((10, y), '256 px', fill=(255, 255, 255)); sheet.paste(tile(load(256), DARK, 1), (10, y + 14)); sheet.paste(tile(load(256), LIGHT, 1), (280, y + 14)); y += 285
sheet = sheet.crop((0, 0, 600, y))
out = os.path.join(ROOT, 'screenshots', 'icones-contato.png'); sheet.save(out); print(out, sheet.size)
