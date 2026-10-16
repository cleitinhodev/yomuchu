# Ícones do Yomuchu

Esta pasta guarda as **fontes** a partir das quais todos os ícones são gerados:

| Arquivo | Uso |
|---|---|
| `favicon-yomuchu.ico` | **o ícone feito pelo usuário** (era `favicon yomuchu.ico`): quadros de 16, 32, 48, 64, 128 e 256 px. É a **fonte da verdade** dos tamanhos de 16 a 256 |
| `yomuchu-logo.png` | o logo em 512×512 (PNG, fundo transparente): ícone de **512 px** (Linux) e origem do logo de 192 px do cabeçalho |
| `anteriores/iconeYomuchu.png` | desenho antigo (gato no livro), guardado caso queira voltar |
| `anteriores/livrovazio.png` | desenho antigo pequeno (livro simples), guardado caso queira voltar |

Para trocar o ícone, substitua `favicon-yomuchu.ico` (e, se quiser, `yomuchu-logo.png`) mantendo os nomes e rode,
na pasta do projeto:

    python3 tools/gerar_icones.py        # precisa de: pip install pillow numpy

O script recria:

- `build/icon.ico`: uma cópia do `.ico` do usuário com os quadros **originais intactos**, mais um quadro de
  **24 px** (feito do quadro de 32 px; o Windows usa 24 px em telas com 125% de escala);
- `build/icons/16x16.png` … `256x256.png`: extraídos dos quadros do `.ico` do usuário; `24x24.png` vem do quadro de 32 px;
  `512x512.png` vem do `yomuchu-logo.png`;
- `build/icon.png` e `build/icon-512.png` (512 px), `build/icon-small.png` (32 px, quadro do `.ico`);
- `src/favicon.png` (64 px, quadro do `.ico`) e `src/logo.png` (192 px, cabeçalho da biblioteca e tela de doação).

**Plano B:** se `favicon-yomuchu.ico` não existir, o script gera todos os tamanhos só a partir do `yomuchu-logo.png`
(48 px ou mais: redução direta em alta qualidade; 16, 24 e 32 px: o mesmo desenho com redução Lanczos, contorno um
pouco mais grosso, contraste levemente maior e nitidez suave).

Para conferir a legibilidade, rode `python3 tools/folha_icones.py` (cria `screenshots/icones-contato.png`).
Para voltar a um desenho antigo, copie-o de `anteriores/` para `yomuchu-logo.png` e apague o `.ico` do usuário
(os antigos usavam dois arquivos; o script atual usa um só no plano B).

Depois gere o instalador de novo (`npm run dist:win` / `npm run dist:linux`).
