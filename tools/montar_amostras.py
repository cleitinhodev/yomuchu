#!/usr/bin/env python3
"""Monta amostras/ a partir da arte real (6 capas + 12 páginas, a 11 deitada).

Uso:  python3 tools/montar_amostras.py "<pasta com capas/ e páginas/>"

Cada imagem é recomprimida uma única vez (JPEG q85, altura máx. 1600) e os mesmos
bytes são reaproveitados onde a página se repete, então o git guarda cada imagem só
uma vez. A estrutura (nomes, quantidades e posição das páginas duplas) é a mesma que
os testes (tests/e2e.js) esperam:
  biblioteca/Kitsune Blade/Volume 1..3   16/18/20 págs  (capas 01..03)
  biblioteca/Estrela do Mar/Vol. 1..2    13 págs, extensão .JPG maiúscula (capas 04..05)
  biblioteca/Robo Samurai - Volume Unico 18 págs, 001.jpg (capa 06)
  avulso/Capitulo 01 - O Comeco          20 págs pagina1..20.jpg, só retrato
  avulso/Capitulo 02 - Paginas Duplas    12 págs, página deitada nas posições 4 e 8
Grava amostras/.arte-real para os geradores de placeholder não sobrescreverem.
"""
import io, os, re, sys, shutil
from PIL import Image

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
BASE = os.path.join(ROOT, 'amostras')
MAX_H, Q = 1600, 85


def enc(path):
    im = Image.open(path).convert('RGB')
    if im.height > MAX_H:
        im = im.resize((round(im.width * MAX_H / im.height), MAX_H), Image.LANCZOS)
    b = io.BytesIO()
    im.save(b, 'JPEG', quality=Q, optimize=True, progressive=True)
    return b.getvalue()


def find(folder):
    out = {}
    for f in sorted(os.listdir(folder)):
        m = re.match(r'(\d+)', f)
        if m and f.lower().endswith(('.png', '.jpg', '.jpeg', '.webp')):
            out[int(m.group(1))] = os.path.join(folder, f)
    return out


def main(src):
    sub = {d.lower(): os.path.join(src, d) for d in os.listdir(src)}
    capas = find(sub['capas'])
    pags = find(sub.get('páginas') or sub.get('paginas'))
    assert len(capas) >= 6 and len(pags) >= 12, (len(capas), len(pags))
    C = {i: enc(capas[i]) for i in range(1, 7)}
    P = {i: enc(pags[i]) for i in range(1, 13)}
    land = [i for i in P if Image.open(io.BytesIO(P[i])).width > Image.open(io.BytesIO(P[i])).height]
    L = land[0]
    retrato = [i for i in range(1, 13) if i not in land]

    if os.path.exists(BASE):
        shutil.rmtree(BASE)

    def write(folder, seq, name):
        os.makedirs(folder, exist_ok=True)
        for n, data in enumerate(seq, 1):
            with open(os.path.join(folder, name(n)), 'wb') as fh:
                fh.write(data)

    def vol(capa, total):
        seq = [C[capa]] + [P[i] for i in range(1, 13)]
        k = 0
        while len(seq) < total:  # completa repetindo as páginas em retrato
            seq.append(P[retrato[k % len(retrato)]]); k += 1
        return seq

    lib = os.path.join(BASE, 'biblioteca')
    for v in (1, 2, 3):
        write(os.path.join(lib, 'Kitsune Blade', f'Volume {v}'), vol(v, 14 + v * 2), lambda n: f'{n:02d}.jpg')
    for v in (1, 2):
        write(os.path.join(lib, 'Estrela do Mar', f'Vol. {v}'), vol(3 + v, 13), lambda n: f'{n:02d}.JPG')
    write(os.path.join(lib, 'Robo Samurai - Volume Unico'), vol(6, 18), lambda n: f'{n:03d}.jpg')

    av = os.path.join(BASE, 'avulso')
    seq = [P[retrato[k % len(retrato)]] for k in range(20)]
    write(os.path.join(av, 'Capitulo 01 - O Comeco'), seq, lambda n: f'pagina{n}.jpg')
    ordem = [8, 9, 10, L, 12, 1, 2, L, 3, 4, 5, 6]
    write(os.path.join(av, 'Capitulo 02 - Paginas Duplas'), [P[i] for i in ordem], lambda n: f'{n:02d}.jpg')

    with open(os.path.join(BASE, '.arte-real'), 'w') as fh:
        fh.write('Amostras montadas com tools/montar_amostras.py a partir da arte real.\n'
                 'tools/gerar_amostras.py e tools/gerar_amostras_duplas.py não sobrescrevem\n'
                 'esta pasta (use --forcar para voltar às páginas de placeholder).\n')
    print('ok', BASE)


if __name__ == '__main__':
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
