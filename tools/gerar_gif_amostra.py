#!/usr/bin/env python3
"""Gera a pasta de teste de GIF animado: amostras/avulso/Capitulo 03 - GIF Animado

  01.jpg  capa (cópia da arte real do Capitulo 02)
  02.gif  página em pé ANIMADA (8 quadros, repete sempre)
  03.jpg  página normal
  04.gif  página DEITADA animada -> vira página dupla, como uma imagem deitada comum
  05.jpg  página normal
  06.GIF  página em pé animada, extensão em maiúsculas

Os GIFs são feitos a partir das páginas do Capitulo 02 (arte real), reduzidas, com um selo "GIF" que anda
pela página e uma barra de progresso, para dar para ver a animação. Uso: python3 tools/gerar_gif_amostra.py
(precisa de: pip install pillow). Também é chamado no fim de tools/montar_amostras.py e tools/gerar_amostras.py.
"""
import os, shutil
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASE = os.path.join(ROOT, 'amostras', 'avulso')
SRC = os.path.join(BASE, 'Capitulo 02 - Paginas Duplas')
OUT = os.path.join(BASE, 'Capitulo 03 - GIF Animado')
FRAMES = 8


def font(size):
    for f in ('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 'C:/Windows/Fonts/arialbd.ttf'):
        if os.path.exists(f):
            return ImageFont.truetype(f, size)
    return ImageFont.load_default()


def animated(src, out, size, accent):
    # uma paleta só para todos os quadros: o GIF guarda só a área que muda (arquivo pequeno)
    base = Image.open(src).convert('RGB').resize(size, Image.LANCZOS)
    w, h = size
    pal = Image.new('RGB', (w, h + h // 3))  # arte + faixas com as cores do selo, para entrarem na paleta
    pal.paste(base, (0, 0))
    d = ImageDraw.Draw(pal)
    for j, c in enumerate((accent, (255, 255, 255), (20, 20, 30))):
        d.rectangle([0, h + j * (h // 9), w, h + (j + 1) * (h // 9)], fill=c)
    pal = pal.quantize(colors=96, method=Image.MEDIANCUT, dither=Image.NONE)
    f = font(max(18, w // 14))
    frames = []
    for k in range(FRAMES):
        im = base.copy()
        d = ImageDraw.Draw(im)
        t = k / (FRAMES - 1)
        r = max(28, min(w, h) // 9)
        cx = int(r + 10 + t * (w - 2 * r - 20))
        cy = int(h * 0.12 + (h * 0.04) * (1 if k % 2 else -1))
        d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=accent, outline=(255, 255, 255), width=4)
        tw = d.textlength('GIF', font=f)
        d.text((cx - tw / 2, cy - f.size * 0.6), 'GIF', fill=(255, 255, 255), font=f)
        d.rectangle([0, h - 14, w, h], fill=(20, 20, 30))
        d.rectangle([0, h - 14, int(w * (k + 1) / FRAMES), h], fill=accent)
        frames.append(im.quantize(palette=pal, dither=Image.NONE))
    frames[0].save(out, save_all=True, append_images=frames[1:], duration=140, loop=0, optimize=True, disposal=1)


def main():
    if os.path.exists(OUT):
        shutil.rmtree(OUT)
    os.makedirs(OUT)
    shutil.copy(os.path.join(SRC, '01.jpg'), os.path.join(OUT, '01.jpg'))
    animated(os.path.join(SRC, '02.jpg'), os.path.join(OUT, '02.gif'), (400, 600), (200, 40, 120))
    shutil.copy(os.path.join(SRC, '03.jpg'), os.path.join(OUT, '03.jpg'))
    animated(os.path.join(SRC, '04.jpg'), os.path.join(OUT, '04.gif'), (720, 480), (40, 110, 200))
    shutil.copy(os.path.join(SRC, '05.jpg'), os.path.join(OUT, '05.jpg'))
    animated(os.path.join(SRC, '06.jpg'), os.path.join(OUT, '06.GIF'), (400, 600), (230, 120, 30))
    print('ok', OUT, sorted(os.listdir(OUT)))


if __name__ == '__main__':
    main()
