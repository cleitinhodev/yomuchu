#!/usr/bin/env python3
"""Gera páginas de mangá fictícias (placeholder) para testar o leitor."""
import os, random, math, shutil
from PIL import Image, ImageDraw, ImageFont, ImageFilter

BASE = os.path.join(os.path.dirname(__file__), '..', 'amostras')
W, H = 900, 1350
FONT_B = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'

def font(size, bold=False):
    return ImageFont.truetype(FONT_B if bold else FONT, size)

def speed_lines(d, box, rnd, center=None):
    x0, y0, x1, y1 = box
    cx, cy = center or ((x0 + x1) / 2, (y0 + y1) / 2)
    for _ in range(70):
        a = rnd.uniform(0, math.tau)
        r1 = rnd.uniform(60, 140); r2 = 900
        d.line([(cx + math.cos(a) * r1, cy + math.sin(a) * r1),
                (cx + math.cos(a) * r2, cy + math.sin(a) * r2)], fill=(30, 30, 30), width=rnd.choice([1, 1, 2, 3]))

def screentone(img, box, rnd, step=9):
    x0, y0, x1, y1 = box
    d = ImageDraw.Draw(img)
    rr = rnd.choice([1, 2])
    for y in range(int(y0), int(y1), step):
        off = (step // 2) if (y // step) % 2 else 0
        for x in range(int(x0) + off, int(x1), step):
            d.ellipse([x - rr, y - rr, x + rr, y + rr], fill=(150, 150, 150))

def character(d, cx, cy, s, rnd, accent):
    # cabeça estilizada de mangá: rosto, cabelo espetado, olhos grandes
    d.ellipse([cx - s, cy - s * 1.1, cx + s, cy + s * 1.1], fill='white', outline='black', width=4)
    for i in range(7):
        a = math.pi + i * math.pi / 6
        px, py = cx + math.cos(a) * s, cy + math.sin(a) * s * 1.05
        d.polygon([(px - s * .3, py + s * .2), (px + s * .3, py + s * .2),
                   (cx + math.cos(a) * s * 1.6, cy + math.sin(a) * s * 1.5)], fill=accent, outline='black')
    d.rectangle([cx - s, cy - s * .9, cx + s, cy - s * .35], fill=accent)
    for ex in (-.42, .42):
        d.ellipse([cx + ex * s - s * .2, cy - s * .15, cx + ex * s + s * .2, cy + s * .35], fill='black')
        d.ellipse([cx + ex * s - s * .1, cy - s * .08, cx + ex * s + s * .02, cy + s * .08], fill='white')
    d.arc([cx - s * .25, cy + s * .45, cx + s * .25, cy + s * .75], 10, 170, fill='black', width=4)

def bubble(d, box, text, rnd):
    x0, y0, x1, y1 = box
    d.ellipse(box, fill='white', outline='black', width=3)
    tx = (x0 + x1) / 2; ty = y1
    d.polygon([(tx - 18, ty - 10), (tx + 10, ty - 10), (tx + rnd.randint(-40, 40), ty + 35)], fill='white', outline='black')
    d.line([(tx - 16, ty - 8), (tx + 8, ty - 8)], fill='white', width=6)
    f = font(22, True)
    lines = text.split('\n')
    for i, ln in enumerate(lines):
        tw = d.textlength(ln, font=f)
        d.text(((x0 + x1) / 2 - tw / 2, (y0 + y1) / 2 - 14 * len(lines) + i * 28), ln, font=f, fill='black')

FALAS = ['Vamos lá!', 'O quê?!', 'Não pode\nser...', 'Hehe!', 'Cuidado!', 'Eu vou\nvencer!', 'Hmm...', 'Espera!', 'Agora!', 'Obrigado!']
SFX = ['BAM!', 'ZOOM', 'DOKI', 'SWOOSH', 'KRAK!', 'GO GO']

def page(path, title, n, total, accent, seed):
    rnd = random.Random(seed)
    img = Image.new('RGB', (W, H), (250, 248, 242))
    d = ImageDraw.Draw(img)
    m = 45
    # layout de painéis
    rows = rnd.choice([[1, 2, 2], [2, 1, 2], [1, 2], [2, 2, 1], [1, 1, 2]])
    hs = [rnd.uniform(.8, 1.3) for _ in rows]; tot = sum(hs)
    y = m; gap = 22
    for ri, cols in enumerate(rows):
        h = (H - 2 * m - 70 - gap * (len(rows) - 1)) * hs[ri] / tot
        x = m
        ws = [rnd.uniform(.7, 1.3) for _ in range(cols)]; tw = sum(ws)
        for ci in range(cols):
            w = (W - 2 * m - gap * (cols - 1)) * ws[ci] / tw
            pw, ph = int(w), int(h)
            pan = Image.new('RGB', (pw, ph), 'white')
            d2 = ImageDraw.Draw(pan)
            box = [0, 0, pw, ph]
            kind = rnd.random()
            if kind < .3:
                speed_lines(d2, box, rnd)
            elif kind < .55:
                screentone(pan, box, rnd)
            d2 = ImageDraw.Draw(pan)
            character(d2, pw * rnd.uniform(.35, .65), ph * rnd.uniform(.5, .62), min(pw, ph) * rnd.uniform(.18, .26), rnd, accent)
            if rnd.random() < .75:
                bw, bh = min(pw * .55, 230), 90
                bx = rnd.uniform(10, max(11, pw - bw - 10)); by = 12
                bubble(d2, [bx, by, bx + bw, by + bh], rnd.choice(FALAS), rnd)
            if rnd.random() < .3:
                f = font(44, True)
                d2.text((pw * .5, ph * .7), rnd.choice(SFX), font=f, fill=accent, stroke_width=3, stroke_fill='black')
            img.paste(pan, (int(x), int(y)))
            d.rectangle([int(x), int(y), int(x) + pw - 1, int(y) + ph - 1], outline='black', width=5)
            x += w + gap
        y += h + gap
    # limpa o excesso fora dos painéis (margens e calhas)
    mask = Image.new('L', (W, H), 255)
    md = ImageDraw.Draw(mask)
    y = m
    paper = Image.new('RGB', (W, H), (250, 248, 242))
    # redesenha bordas
    d = ImageDraw.Draw(img)
    # rodapé
    f = font(26, True)
    label = f'{title}  ·  p. {n}/{total}'
    tw = d.textlength(label, font=f)
    d.rectangle([0, H - 75, W, H], fill=(250, 248, 242))
    d.rectangle([0, 0, W, m - 4], fill=(250, 248, 242))
    d.rectangle([0, 0, m - 4, H], fill=(250, 248, 242))
    d.rectangle([W - m + 4, 0, W, H], fill=(250, 248, 242))
    d.text((W / 2 - tw / 2, H - 58), label, font=f, fill=(40, 40, 40))
    # número grande da página
    fb = font(120, True)
    num = str(n)
    nw = d.textlength(num, font=fb)
    d.text((W - m - nw - 10, H - 75 - 150), num, font=fb, fill=accent, stroke_width=6, stroke_fill='black')
    img.save(path, quality=88)

def cover(path, title, vol, accent, seed, fmt='JPEG'):
    rnd = random.Random(seed)
    img = Image.new('RGB', (W, H), accent)
    d = ImageDraw.Draw(img)
    speed_lines(d, [0, 0, W, H], rnd, center=(W / 2, H * .55))
    character(d, W / 2, H * .55, 230, rnd, tuple(max(0, c - 70) for c in accent))
    d.rectangle([0, 0, W, 260], fill=(20, 20, 24))
    f = font(84, True)
    tw = d.textlength(title, font=f)
    if tw > W - 60:
        f = font(int(84 * (W - 60) / tw), True); tw = d.textlength(title, font=f)
    d.text((W / 2 - tw / 2, 70), title, font=f, fill='white', stroke_width=4, stroke_fill=accent)
    f2 = font(48, True)
    v = f'VOLUME {vol}'
    d.rectangle([0, H - 150, W, H], fill=(20, 20, 24))
    d.text((W / 2 - d.textlength(v, font=f2) / 2, H - 115), v, font=f2, fill='white')
    img.save(path, fmt, quality=90)

def volume(folder, title, vol, pages, accent, seed, names='num', ext='.jpg'):
    os.makedirs(folder, exist_ok=True)
    for i in range(1, pages + 1):
        if names == 'num':
            name = f'{i:02d}{ext}'
        elif names == 'pagina':
            name = f'pagina{i}{ext}'  # sem zeros: testa ordenação natural (pagina2 < pagina10)
        else:
            name = f'{i:03d}{ext}'
        p = os.path.join(folder, name)
        if i == 1:
            cover(p, title, vol, accent, seed, 'PNG' if ext.lower() == '.png' else 'JPEG')
        else:
            page(p, title, i, pages, accent, seed * 1000 + i)


def _arte_real_protegida(base):
    """Não sobrescreve as amostras com arte real (ver tools/montar_amostras.py)."""
    import sys
    if os.path.exists(os.path.join(base, '.arte-real')) and '--forcar' not in sys.argv:
        print('amostras/ tem arte real (amostras/.arte-real); nada foi alterado. '
              'Use --forcar para recriar as páginas de placeholder.')
        sys.exit(0)


if __name__ == '__main__':
    _arte_real_protegida(BASE)
    if os.path.exists(BASE):
        shutil.rmtree(BASE)
    # 1) pasta avulsa com 20 páginas (nomes pagina1..pagina20 -> testa ordenação natural)
    volume(os.path.join(BASE, 'avulso', 'Capitulo 01 - O Comeco'), 'O COMEÇO', 1, 20, (200, 40, 50), 7, names='pagina')
    # 2) biblioteca: 3 séries
    lib = os.path.join(BASE, 'biblioteca')
    # série com volumes aninhados (Serie/Volume)
    for v in (1, 2, 3):
        volume(os.path.join(lib, 'Kitsune Blade', f'Volume {v}'), 'KITSUNE BLADE', v, 14 + v * 2, (230, 120, 30), 100 + v)
    for v in (1, 2):
        volume(os.path.join(lib, 'Estrela do Mar', f'Vol. {v}'), 'ESTRELA DO MAR', v, 12, (40, 110, 200), 200 + v, ext='.PNG')
    # volume único direto na raiz da biblioteca
    volume(os.path.join(lib, 'Robo Samurai - Volume Unico'), 'ROBÔ SAMURAI', 1, 18, (60, 160, 90), 300, names='num3')
    print('ok')
