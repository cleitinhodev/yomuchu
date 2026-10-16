#!/usr/bin/env python3
"""Gera TODOS os ícones do Yomuchu. Fontes em build/icones-fonte/:

  favicon-yomuchu.ico  (PREFERIDA) o .ico feito pelo usuário (16, 32, 48, 64, 128 e 256 px). É a fonte da verdade:
                       build/icon.ico é uma cópia dela, com os quadros originais intactos (byte a byte); só
                       acrescenta um quadro de 24 px (PNG), feito do quadro de 32 px, que o Windows usa em 125% de escala.
                       Os PNG (16, 32, 48, 64, 128, 256, icon-small, favicon) são extraídos dos quadros dela.
  yomuchu-logo.png     o logo em 512x512 (PNG, fundo transparente): é o ícone de 512 px (Linux) e a origem do
                       logo de 192 px do cabeçalho. Se o .ico do usuário não existir, TODOS os tamanhos saem
                       deste arquivo (plano B: 48 px ou mais por redução direta; 16, 24 e 32 px numa versão
                       nítida do mesmo desenho, com contorno um pouco mais grosso e máscara de nitidez suave).

Saídas: build/icon.ico, build/icon.png, build/icon-512.png, build/icon-small.png (32 px), build/icons/<n>x<n>.png
(16, 24, 32, 48, 64, 128, 256, 512), src/favicon.png (64 px) e src/logo.png (192 px).
Uso: python3 tools/gerar_icones.py   (requer Pillow e numpy: pip install pillow numpy)"""
import io, os, struct, sys
import numpy as np
from PIL import Image, ImageEnhance, ImageFilter

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
R = os.path.join(ROOT, 'build')
SRC = os.path.join(R, 'icones-fonte', 'yomuchu-logo.png')
USER_ICO = os.path.join(R, 'icones-fonte', 'favicon-yomuchu.ico')
SMALL, LARGE = [16, 24, 32], [48, 64, 128, 256, 512]
ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]
OUTLINE = (26, 10, 58)          # roxo bem escuro, a cor do contorno do logo


def square(path, pad_frac):
    """recorta a área desenhada e centraliza num quadrado transparente com uma pequena margem"""
    im = Image.open(path).convert('RGBA')
    im = im.crop(im.getchannel('A').point(lambda v: 255 if v > 8 else 0).getbbox() or (0, 0, *im.size))
    s = max(im.size); pad = max(1, round(s * pad_frac)); s += 2 * pad
    out = Image.new('RGBA', (s, s), (0, 0, 0, 0))
    out.paste(im, ((s - im.width) // 2, (s - im.height) // 2))
    return out


def down(im, n):
    """Lanczos com alfa pré-multiplicado (sem halo escuro nas bordas transparentes)"""
    return im.convert('RGBa').resize((n, n), Image.LANCZOS, reducing_gap=3.0).convert('RGBA')


def crisp(src, n):
    """versão pequena e nítida do mesmo logo"""
    k = 4                                              # trabalha em 4x e reduz no fim
    w = down(src, n * k)
    a = np.asarray(w).astype(np.float32)
    alpha = a[..., 3] / 255.0
    # contorno um pouco mais grosso: escurece uma faixa fina logo dentro da borda (sem mudar a silhueta)
    ae = Image.fromarray((alpha * 255).astype(np.uint8)).filter(ImageFilter.MinFilter(2 * max(1, round(k * 0.55)) + 1))
    band = np.clip(alpha - np.asarray(ae).astype(np.float32) / 255.0, 0, 1)
    band = np.clip(band * 1.6, 0, 1)[..., None]
    rgb = a[..., :3] * (1 - 0.85 * band) + np.array(OUTLINE, np.float32) * (0.85 * band)
    w2 = Image.fromarray(np.dstack([np.clip(rgb, 0, 255), alpha * 255]).astype(np.uint8), 'RGBA')
    rgb_img = ImageEnhance.Contrast(ImageEnhance.Color(w2.convert('RGB')).enhance(1.15)).enhance(1.10)
    w2 = Image.merge('RGBA', (*rgb_img.split(), w2.getchannel('A')))
    out = down(w2, n)
    sharp = out.convert('RGB').filter(ImageFilter.UnsharpMask(radius=0.7, percent=90 if n <= 24 else 70, threshold=0))
    return Image.merge('RGBA', (*sharp.split(), out.getchannel('A')))


def read_ico(path):
    """[(tamanho, bytes do quadro)] exatamente como estão no arquivo"""
    d = open(path, 'rb').read()
    n = struct.unpack('<H', d[4:6])[0]
    out = []
    for k in range(n):
        w, h, _c, _r, _pl, _bpp, ln, off = struct.unpack('<BBBBHHII', d[6 + 16 * k:22 + 16 * k])
        out.append((w or 256, d[off:off + ln]))
    return out


def write_ico(path, frames):
    """frames: [(tamanho, bytes, bpp)] -> .ico (os bytes de cada quadro são gravados sem alteração)"""
    frames = sorted(frames, key=lambda f: f[0])
    head = struct.pack('<HHH', 0, 1, len(frames)); off = 6 + 16 * len(frames); ent = b''
    for n, b, bpp in frames:
        ent += struct.pack('<BBBBHHII', n % 256, n % 256, 0, 0, 1, bpp, len(b), off); off += len(b)
    open(path, 'wb').write(head + ent + b''.join(f[1] for f in frames))


def save_common(img, logo512):
    os.makedirs(os.path.join(R, 'icons'), exist_ok=True)
    for f in os.listdir(os.path.join(R, 'icons')): os.remove(os.path.join(R, 'icons', f))
    for n in sorted(img): img[n].save(os.path.join(R, 'icons', f'{n}x{n}.png'), optimize=True)
    img[512].save(os.path.join(R, 'icon.png'), optimize=True)       # Linux / geral
    img[512].save(os.path.join(R, 'icon-512.png'), optimize=True)
    img[32].save(os.path.join(R, 'icon-small.png'), optimize=True)  # ícone pequeno da janela
    img[64].save(os.path.join(ROOT, 'src', 'favicon.png'), optimize=True)
    down(logo512, 192).save(os.path.join(ROOT, 'src', 'logo.png'), optimize=True)


def main():
    logo = Image.open(SRC).convert('RGBA')
    if os.path.exists(USER_ICO):
        frames = read_ico(USER_ICO)
        ico = Image.open(USER_ICO)
        img = {n: ico.ico.getimage((n, n)).convert('RGBA') for n, _ in frames}
        img[24] = down(img[32], 24)                              # só para o quadro extra de 24 px
        img[512] = logo.resize((512, 512), Image.LANCZOS) if logo.size != (512, 512) else logo
        save_common(img, logo)
        b = io.BytesIO(); img[24].save(b, 'PNG', optimize=True)
        write_ico(os.path.join(R, 'icon.ico'), [(n, blob, 32) for n, blob in frames] + [(24, b.getvalue(), 32)])
        print('ok (ico do usuário + quadro de 24 px):', sorted(n for n, _ in frames) + [24])
        return
    big = square(SRC, 0.03)                 # plano B: tudo a partir do logo único
    tiny = square(SRC, 0.015)
    img = {}
    for n in LARGE: img[n] = down(big, n)
    for n in SMALL: img[n] = crisp(tiny, n)
    save_common(img, logo)
    blobs = []
    for n in ICO_SIZES:
        b = io.BytesIO(); img[n].save(b, 'PNG', optimize=True); blobs.append((n, b.getvalue(), 32))
    write_ico(os.path.join(R, 'icon.ico'), blobs)
    print('ok (plano B, só o logo):', ICO_SIZES)


if __name__ == '__main__':
    main()
