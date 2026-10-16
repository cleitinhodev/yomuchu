# Ícones do Yomuchu

Esta pasta guarda os **desenhos originais** dos ícones:

| Arquivo | Uso |
|---|---|
| `livrovazio.png` | ícone **pequeno**: 16, 24 e 32 px, canto da janela / barra de título |
| `iconeYomuchu.png` | ícone **grande**: 48 a 512 px, área de trabalho, instalador, atalhos, Linux |

Para trocar, substitua os arquivos mantendo **os mesmos nomes** (PNG, de preferência quadrado
e com fundo transparente) e rode:

    python3 tools/gerar_icones.py

O script recria `build/icon.ico` (16–256 px, misturando os dois desenhos), `build/icon.png`,
`build/icon-small.png`, `build/icons/*.png` e `src/favicon.png`. Depois gere o instalador de novo
(`npm run dist:win` / `npm run dist:linux`).
