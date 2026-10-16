'use strict';
/* Yomuchu (leitor) — livro virtual com virada de página em 3D (tiras aninhadas simulam a curvatura do papel) */
const api = window.mangaAPI;
const $ = (s) => document.querySelector(s);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const N_STRIPS = 14;
const BEND = 58;          // curvatura máxima (graus) no meio da virada

const book = $('#book'), zoomer = $('#zoomer'), leaf = $('#leaf');
const slotEls = { left: $('#slotL'), right: $('#slotR') };
const boards = { left: $('.board.left'), right: $('.board.right') };
const stacks = { left: $('.stack.left'), right: $('.stack.right') };
const spine = $('.spine');

const S = {
  folder: null, title: '', pages: [], n: 0,
  dir: 'rtl', mode: 'double', sound: true, flipSpeed: 1, detectSpreads: true,
  views: [], pageView: [], spreads: 0,
  k: 0,                  // índice da vista (spread ou página)
  geo: null,             // geometria calculada
  trans: null,           // transição ativa
  queue: [],
  zoom: 1, panX: 0, panY: 0,
  fs: false, transparent: true,
  fitted: false,
};
window.__reader = S; // usado pelos testes automatizados
window.__readerTest = {};

// ------------------------------------------------------------ textura de papel (ruído)
(function makeNoise() {
  const c = document.createElement('canvas'); c.width = c.height = 160;
  const g = c.getContext('2d'); const d = g.createImageData(160, 160);
  for (let i = 0; i < d.data.length; i += 4) {
    const v = 200 + Math.random() * 55;
    d.data[i] = v; d.data[i + 1] = v * 0.98; d.data[i + 2] = v * 0.93; d.data[i + 3] = Math.random() * 38;
  }
  g.putImageData(d, 0, 0);
  document.documentElement.style.setProperty('--noise', `url(${c.toDataURL()})`);
})();

// ------------------------------------------------------------ tiras da folha
const strips = [];
(function buildLeaf() {
  let parent = leaf;
  for (let i = 0; i < N_STRIPS; i++) {
    const s = document.createElement('div'); s.className = 'strip';
    const f = document.createElement('div'); f.className = 'face f'; f.innerHTML = '<i class="gut"></i><i class="sh"></i>';
    const b = document.createElement('div'); b.className = 'face b'; b.innerHTML = '<i class="gut"></i><i class="sh"></i>';
    s.append(f, b); parent.appendChild(s);
    strips.push({ el: s, f, b, fsh: f.lastChild, bsh: b.lastChild, fgut: f.firstChild, bgut: b.firstChild });
    parent = s;
  }
  const st = document.createElement('style');
  st.textContent = `
    #leaf.sright .strip { left: var(--w); transform-origin: 0 50%; width: var(--sw); }
    #leaf.sright > .strip { left: 0; }
    #leaf.sleft .strip { right: var(--w); transform-origin: 100% 50%; width: var(--sw); }
    #leaf.sleft > .strip { right: 0; }`;
  document.head.appendChild(st);
})();

// ------------------------------------------------------------ cache de imagens
const cache = new Map();
function ensure(i) {
  if (i == null || i < 0 || i >= S.n) return Promise.resolve(null);
  const url = S.pages[i].url;
  let c = cache.get(url);
  if (!c) {
    const img = new Image();
    img.decoding = 'async';
    c = { img, w: 0, h: 0, p: null };
    c.p = new Promise((res) => {
      img.onload = () => { c.w = img.naturalWidth; c.h = img.naturalHeight; (img.decode ? img.decode() : Promise.resolve()).catch(() => {}).then(() => res(c)); };
      img.onerror = () => res(c);
    });
    img.src = url;
    cache.set(url, c);
  }
  return c.p;
}
function meta(i) { return i == null ? null : cache.get(S.pages[i].url) || null; }
function preloadAround() {
  const a = anchorPage();
  for (let d = -3; d <= 8; d++) ensure(a + d);
  if (cache.size > 80) { // limpa imagens distantes
    const keep = new Set(); for (let d = -10; d <= 16; d++) if (S.pages[a + d]) keep.add(S.pages[a + d].url);
    for (const k of cache.keys()) if (!keep.has(k)) cache.delete(k);
  }
}

// ------------------------------------------------------------ vistas
const isDouble = () => S.mode === 'double';
const leafSide = () => (S.dir === 'ltr' ? 'right' : 'left');
const otherSide = (s) => (s === 'left' ? 'right' : 'left');
/* ---- páginas duplas (spreads)
 * Uma imagem deitada (largura/altura > SPREAD_RATIO) é uma página dupla: ocupa o livro aberto inteiro.
 * As vistas ficam numa tabela (S.views), recalculada ao abrir, ao trocar o modo e ao mudar a opção:
 *   { a, b }            duas páginas: a = lida primeiro (lado oposto à folha), b = lado que vira
 *   { a, b: null, blank: true }   página sozinha antes de uma dupla: o outro lado fica em branco
 *   { s }               página dupla: metade em cada lado do livro
 * A folha que vira carrega "conteúdos" { p, half }: half = metade física ('left'/'right') de uma dupla. */
const SPREAD_RATIO = 1.1;
function pageDims(i) {
  const pg = S.pages[i]; if (!pg) return null;
  if (pg.w && pg.h) return { w: pg.w, h: pg.h };
  const m = cache.get(pg.url); return m && m.w ? { w: m.w, h: m.h } : null;
}
function isSpreadPage(i) { const d = pageDims(i); return !!(S.detectSpreads && d && d.w / d.h > SPREAD_RATIO); }
function buildViews() {
  const V = [];
  if (!isDouble()) { for (let i = 0; i < S.n; i++) V.push({ a: null, b: i }); }
  else if (S.n) {
    V.push(isSpreadPage(0) ? { s: 0, a: null, b: null } : { a: null, b: 0 }); // capa sozinha
    let pending = null;
    for (let i = 1; i < S.n; i++) {
      if (isSpreadPage(i)) {
        if (pending != null) { V.push({ a: pending, b: null, blank: true }); pending = null; }
        V.push({ s: i, a: null, b: null });
      } else if (pending == null) pending = i;
      else { V.push({ a: pending, b: i }); pending = null; }
    }
    if (pending != null) V.push({ a: pending, b: null });
  }
  S.views = V;
  S.pageView = new Array(S.n);
  V.forEach((v, k) => { for (const p of [v.a, v.b, v.s]) if (p != null) S.pageView[p] = k; });
  S.spreads = V.filter((v) => v.s != null).length;
}
function viewCount() { return S.views ? S.views.length : 0; }
function view(k) { return (S.views && S.views[k]) || { a: null, b: null }; }
function viewOfPage(p) { return S.pageView ? (S.pageView[clamp(p, 0, S.n - 1)] ?? 0) : 0; }
function anchorPage(k = S.k) { const v = view(k); return v.s != null ? v.s : v.a != null ? v.a : v.b != null ? v.b : 0; }
function maxVisible(k = S.k) { const v = view(k); return Math.max(v.s ?? -1, v.a ?? -1, v.b ?? -1, 0); }
/** conteúdo de um lado ('a' ou 'b') de uma vista: { p, half } ou null */
function sideContent(v, which) {
  if (!v) return null;
  if (v.s != null) return isDouble() ? { p: v.s, half: which === 'b' ? leafSide() : otherSide(leafSide()) } : (which === 'b' ? { p: v.s, half: null } : null);
  const p = v[which]; return p == null ? null : { p, half: null };
}
const hasSide = (v, which) => v.s != null || v[which] != null || (which === 'b' && !!v.blank);

// ------------------------------------------------------------ geometria
function pageAspect() {
  // proporção típica das páginas simples (mediana), ignorando as duplas
  const as = [];
  for (let i = 0; i < S.n && as.length < 15; i++) { const d = pageDims(i); if (d && d.w / d.h <= SPREAD_RATIO) as.push(d.w / d.h); }
  if (!as.length) { const d = pageDims(0); return d ? clamp(d.w / d.h / (d.w / d.h > SPREAD_RATIO ? 2 : 1), 0.45, 1.2) : 0.68; }
  as.sort((x, y) => x - y);
  return clamp(as[as.length >> 1], 0.45, 1.2);
}
function pads() { return S.fs ? { x: 26, t: 26, b: 26 } : { x: 26, t: 54, b: 52 }; }
function layout() {
  if (!S.n) return;
  const W = innerWidth, H = innerHeight, p = pads();
  const aw = W - 2 * p.x, ah = H - p.t - p.b;
  const a = pageAspect();
  const halves = isDouble() ? 2 : 1;
  const BR = 0.02, SR = 0.02; // borda (capa) e reserva da pilha, relativas à altura
  let ph = ah / (1 + 2 * BR);
  let need = halves * ph * a + 2 * ph * (BR + SR);
  if (need > aw) ph *= aw / need;
  ph = Math.max(60, Math.floor(ph));
  const pw = Math.floor(ph * a), b = Math.max(5, Math.round(ph * BR)), sMax = Math.max(4, Math.round(ph * SR));
  const bw = halves * pw + 2 * (b + sMax), bh = ph + 2 * b;
  const bx = Math.round((W - bw) / 2), by = Math.round(p.t + (ah - bh) / 2);
  const g = { pw, ph, b, sMax, bw, bh, bx, by, spineX: b + sMax + pw };
  S.geo = g;
  Object.assign(book.style, { left: bx + 'px', top: by + 'px', width: bw + 'px', height: bh + 'px' });
  const slotTop = b + 'px', inner = b + sMax;
  book.classList.toggle('single', !isDouble());
  book.classList.toggle('sp-left', !isDouble() && leafSide() === 'right');
  book.classList.toggle('sp-right', !isDouble() && leafSide() === 'left');
  if (isDouble()) {
    Object.assign(slotEls.left.style, { left: inner + 'px', top: slotTop, width: pw + 'px', height: ph + 'px', display: '' });
    Object.assign(slotEls.right.style, { left: inner + pw + 'px', top: slotTop, width: pw + 'px', height: ph + 'px', display: '' });
    Object.assign(boards.left.style, { left: 0, top: 0, width: g.spineX + 'px', height: bh + 'px', display: '' });
    Object.assign(boards.right.style, { left: g.spineX + 'px', top: 0, width: g.spineX + 'px', height: bh + 'px' });
    boards.right.style.borderRadius = '';
    Object.assign(spine.style, { left: g.spineX - 7 + 'px', top: slotTop, width: '14px', height: ph + 'px' });
  } else {
    slotEls.left.style.display = 'none'; boards.left.style.display = 'none';
    Object.assign(slotEls.right.style, { left: inner + 'px', top: slotTop, width: pw + 'px', height: ph + 'px' });
    Object.assign(boards.right.style, { left: 0, top: 0, width: bw + 'px', height: bh + 'px', borderRadius: '7px' });
  }
  for (const side of ['left', 'right']) { stacks[side].style.top = b + 'px'; stacks[side].style.height = ph + 'px'; }
  // folha
  const ls = leafSide();
  leaf.classList.toggle('sright', ls === 'right'); leaf.classList.toggle('sleft', ls === 'left');
  const leafLeft = isDouble() ? (ls === 'right' ? g.spineX : inner) : inner;
  Object.assign(leaf.style, { left: leafLeft + 'px', top: slotTop, width: pw + 'px', height: ph + 'px' });
  const w = pw / N_STRIPS;
  leaf.style.setProperty('--w', w + 'px'); leaf.style.setProperty('--sw', w + 0.6 + 'px');
  // a perspectiva fica no pai direto da folha (#book), senão o 3D é "achatado"
  book.style.perspective = Math.round(pw * 3.8) + 'px';
  book.style.perspectiveOrigin = `${isDouble() ? g.spineX : (ls === 'right' ? inner : inner + pw)}px ${bh / 2}px`;
  updateStacks();
  for (const el of Object.values(slotEls)) if (el._c) placeSlotImage(el, el._c);
  if (S.trans) { setupLeafFaces(S.trans); drawLeaf(); }
  applyZoom(false);
}

/** slot físico (esquerda/direita) que mostra o lado "a" ou "b" */
function slotFor(which) {
  if (!isDouble()) return slotEls.right;
  const ls = leafSide();
  return which === 'b' ? slotEls[ls] : slotEls[otherSide(ls)];
}
/** c = { p, half } ou null; blank = página em branco inserida antes de uma dupla */
function setSlot(el, c, blank) {
  const img = el.firstElementChild;
  el._c = c;
  el.classList.toggle('blankpage', !c && !!blank);
  el.classList.toggle('spread-half', !!(c && c.half));
  if (!c) { el.classList.add('empty'); img.style.backgroundImage = ''; img.style.backgroundSize = img.style.backgroundPosition = ''; el.dataset.page = ''; delete el.dataset.half; return; }
  el.classList.remove('empty');
  el.dataset.page = c.p;
  if (c.half) el.dataset.half = c.half; else delete el.dataset.half;
  img.style.backgroundImage = `url("${S.pages[c.p].url}")`;
  placeSlotImage(el, c);
}
function placeSlotImage(el, c) {
  const img = el.firstElementChild;
  if (c.half && S.geo) {
    const r = fitRect(c);
    img.style.backgroundSize = `${r.dw}px ${r.dh}px`;
    img.style.backgroundPosition = `${r.dx}px ${r.dy}px`;
  } else { img.style.backgroundSize = ''; img.style.backgroundPosition = ''; }
}
function setHalfVisible(which, vis) {
  if (!isDouble()) return;
  const side = which === 'b' ? leafSide() : otherSide(leafSide());
  for (const e of [slotEls[side], boards[side], stacks[side]]) e.classList.toggle('half-hidden', !vis);
}
function updateStacks() {
  const g = S.geo; if (!g) return;
  const read = S.n > 1 ? maxVisible() / (S.n - 1) : 1;
  const thick = g.sMax * clamp(0.55 + S.n / 150, 0.55, 1);
  const ls = leafSide(), os = otherSide(ls);
  const inner = g.b + g.sMax;
  const wS = Math.max(read < 1 ? 1.5 : 0, thick * (1 - read)), wO = Math.max(read > 0 ? 1.5 : 0, thick * read);
  const place = (side, w) => {
    const st = stacks[side]; st.style.width = w + 'px';
    if (!isDouble()) st.style.left = (side === 'left' ? inner - w : inner + g.pw) + 'px';
    else st.style.left = (side === 'left' ? inner - w : inner + 2 * g.pw) + 'px';
  };
  place(ls, wS); place(os, wO);
}

function renderStatic() {
  const v = view(S.k);
  setSlot(slotFor('b'), sideContent(v, 'b'), v.blank);
  if (isDouble()) setSlot(slotFor('a'), sideContent(v, 'a'));
  for (const el of Object.values(slotEls)) { el.querySelector('.cast').style.opacity = 0; }
  book.classList.remove('flipping');
  book.classList.toggle('on-spread', v.s != null && isDouble());
  setHalfVisible('a', hasSide(v, 'a'));
  setHalfVisible('b', hasSide(v, 'b'));
  updateStacks();
  updateUI();
  preloadAround();
}

// ------------------------------------------------------------ transição (virada)
/** retângulo da imagem dentro de uma página (para uma metade de dupla: a imagem cobre as duas páginas) */
function fitRect(c) {
  const g = S.geo, m = pageDims(c.p);
  const W = c.half ? 2 * g.pw : g.pw;
  if (!m) return { dx: 0, dy: 0, dw: W, dh: g.ph };
  const sc = Math.min(W / m.w, g.ph / m.h), dw = m.w * sc, dh = m.h * sc;
  let dx = (W - dw) / 2;
  if (c.half === 'right') dx -= g.pw;
  return { dx, dy: (g.ph - dh) / 2, dw, dh };
}
function setupLeafFaces(tr) {
  const g = S.geo, pw = g.pw, w = pw / N_STRIPS, right = leafSide() === 'right';
  const fr = tr.front != null ? fitRect(tr.front) : null, br = tr.back != null ? fitRect(tr.back) : null;
  const fUrl = tr.front != null ? `url("${S.pages[tr.front.p].url}")` : '';
  const bUrl = tr.back != null ? `url("${S.pages[tr.back.p].url}")` : '';
  const gutF = `linear-gradient(${right ? 'to right' : 'to left'}, rgba(0,0,0,.28), rgba(0,0,0,.07) 2.2%, transparent 8%)`;
  const gutB = `linear-gradient(${right ? 'to left' : 'to right'}, rgba(0,0,0,.28), rgba(0,0,0,.07) 2.2%, transparent 8%)`;
  strips.forEach((s, i) => {
    const offF = right ? i * w : pw - (i + 1) * w;
    const offB = right ? pw - (i + 1) * w : i * w;
    s.f.classList.toggle('blank', !fr); s.b.classList.toggle('blank', !br);
    if (fr) Object.assign(s.f.style, { backgroundImage: fUrl, backgroundSize: `${fr.dw}px ${fr.dh}px`, backgroundPosition: `${fr.dx - offF}px ${fr.dy}px` });
    if (br) Object.assign(s.b.style, { backgroundImage: bUrl, backgroundSize: `${br.dw}px ${br.dh}px`, backgroundPosition: `${br.dx - offB}px ${br.dy}px` });
    Object.assign(s.fgut.style, { backgroundImage: `var(--noise), ${gutF}`, backgroundSize: `auto, ${pw}px 100%`, backgroundPosition: `0 0, ${-offF}px 0` });
    Object.assign(s.bgut.style, { backgroundImage: `var(--noise), ${gutB}`, backgroundSize: `auto, ${pw}px 100%`, backgroundPosition: `0 0, ${-offB}px 0` });
    s.f.style.opacity = s.b.style.opacity = 1;
  });
}
/* ------------------------------------------------------------------------------------------------
 * Física da folha: cada tira é um oscilador (ângulo + velocidade) acoplado às vizinhas por uma
 * "rigidez de flexão". Uma mola puxa a folha para o alvo (lado de destino, ponteiro do mouse ou
 * canto levantado), o ar freia mais a borda externa (que por isso fica para trás e curva), uma
 * turbulência gera uma onda que corre ao longo do papel, e ao chegar a folha bate na página,
 * quica e balança até assentar. Tudo integrado a 240 Hz (Euler semi-implícito, subpassos).
 * ---------------------------------------------------------------------------------------------- */
const PHYS = {
  dt: 1 / 240,
  bend: 1500,        // rigidez de flexão entre tiras vizinhas
  kFlip: 50,         // mola do "empurrão" automático (tecla/clique/soltar)
  kDrag: 330,        // mola que prende a folha ao mouse
  kPeek: 150,        // mola do canto levantado
  restitution: 0.34, // quique ao bater na página
  flutter: 5.5,      // intensidade da onda/tremulação do ar
  maxStep: 0.085,    // curvatura máxima entre duas tiras (fração de 180°)
};
const fIdx = Array.from({ length: N_STRIPS }, (_, i) => i / (N_STRIPS - 1));
/** forma "estática" de referência para um progresso t (borda externa adiantada) */
function shapeU(t, out = new Float64Array(N_STRIPS)) {
  const bend = Math.sin(Math.PI * t) * BEND / 180;
  for (let i = 0; i < N_STRIPS; i++) out[i] = clamp(t + bend * (Math.pow(fIdx[i], 1.6) - 0.35), 0, 1);
  return out;
}
/** inicia transição entre a vista k0 e k0+1 (t=0 → k0, t=1 → k0+1) */
function beginTransition(k0, t, kind) {
  const v0 = view(k0), v1 = view(k0 + 1);
  const tr = {
    k0, t, kind, front: sideContent(v0, 'b'), back: isDouble() ? sideContent(v1, 'a') : null, single: !isDouble(),
    u: shapeU(t), w: new Float64Array(N_STRIPS), tmp: new Float64Array(N_STRIPS),
    target: t, dragT: t, peekFwd: k0 === S.k, closing: false, time: 0,
    lift: 0, liftV: 0, landed: false, thud: false,
  };
  S.trans = tr;
  setSlot(slotFor('b'), sideContent(v1, 'b'), v1.blank);
  if (isDouble()) setSlot(slotFor('a'), sideContent(v0, 'a'));
  book.classList.add('flipping');
  setHalfVisible('a', true); setHalfVisible('b', true);
  setupLeafFaces(tr);
  leaf.classList.add('on');
  drawLeaf();
  ensure(v1.b); ensure(v1.a); ensure(v1.s);
  return tr;
}
/** posiciona a folha numa forma estática (usado no redimensionamento e nos testes) */
function renderLeaf(t) {
  const tr = S.trans; if (!tr) return;
  shapeU(t, tr.u); tr.w.fill(0);
  drawLeaf();
}
function drawLeaf() {
  const tr = S.trans; if (!tr) return;
  const g = S.geo, w = g.pw / N_STRIPS, right = leafSide() === 'right', sign = right ? -1 : 1;
  const single = !isDouble();
  let mean = 0; for (let i = 0; i < N_STRIPS; i++) mean += tr.u[i]; mean /= N_STRIPS;
  const A = mean * 180;
  const fade = single && A > 95 ? clamp(1 - (A - 95) / 55, 0, 1) : 1;
  const phis = Array.from(tr.u, (x) => x * 180);
  const fOp = (phi) => (phi < 90 ? 0.45 * Math.pow(phi / 90, 1.4) : 0.45);
  const bOp = (phi) => (phi > 90 ? 0.40 * Math.pow((180 - phi) / 90, 1.4) : 0.40);
  const dirF = right ? 'to right' : 'to left', dirB = right ? 'to left' : 'to right';
  let prev = 0, xe = 0;
  for (let i = 0; i < N_STRIPS; i++) {
    const phi = phis[i], pv = i > 0 ? phis[i - 1] : phi, nxt = i < N_STRIPS - 1 ? phis[i + 1] : phi;
    const s = strips[i];
    s.el.style.transform = `rotateY(${(sign * (phi - prev)).toFixed(3)}deg)`;
    prev = phi;
    xe += w * Math.cos(phi * Math.PI / 180);
    // luz contínua entre tiras vizinhas: segue o ângulo de cada trecho da curva
    const a0 = fOp((pv + phi) / 2), a1 = fOp((phi + nxt) / 2);
    const b0 = bOp((pv + phi) / 2), b1 = bOp((phi + nxt) / 2);
    s.fsh.style.background = `linear-gradient(${dirF}, rgba(0,0,0,${a0.toFixed(3)}), rgba(0,0,0,${a1.toFixed(3)}))`;
    s.bsh.style.background = `linear-gradient(${dirB}, rgba(0,0,0,${b0.toFixed(3)}), rgba(0,0,0,${b1.toFixed(3)}))`;
    if (single) s.f.style.opacity = s.b.style.opacity = fade;
  }
  // sombra projetada pela folha
  const strength = Math.sin(Math.PI * clamp(mean, 0, 1));
  const sw = g.pw * (0.06 + 0.22 * strength);
  const sSlot = slotFor('b'), oSlot = isDouble() ? slotFor('a') : null;
  const castS = sSlot.querySelector('.cast'), castO = oSlot && oSlot.querySelector('.cast');
  const place = (cast, slot, d, op) => {
    const spineAtLeft = isDouble() ? slot === slotEls.right : right;
    cast.style.width = sw + 'px';
    cast.style.left = spineAtLeft ? d + 'px' : 'auto';
    cast.style.right = spineAtLeft ? 'auto' : d + 'px';
    cast.style.background = `linear-gradient(${spineAtLeft ? 'to right' : 'to left'}, rgba(0,0,0,${(0.5 * op).toFixed(3)}), transparent)`;
    cast.style.opacity = 1;
  };
  if (xe >= 0) { place(castS, sSlot, Math.max(0, xe), strength * fade); if (castO) castO.style.opacity = 0; }
  else { castS.style.opacity = 0; if (castO) place(castO, oSlot, -xe, strength); }
  // a página de baixo "respira" com o ar deslocado pela folha
  if (Math.abs(tr.lift) > 0.01) {
    sSlot.style.transformOrigin = (isDouble() ? sSlot === slotEls.right : right) ? '0 50%' : '100% 50%';
    sSlot.style.transform = `perspective(${Math.round(g.pw * 3)}px) rotateY(${(sign * tr.lift).toFixed(2)}deg)`;
  } else sSlot.style.transform = '';
  tr.t = mean; tr.edge = xe;
}

function physStep(tr, dt) {
  const u = tr.u, w = tr.w, n = N_STRIPS;
  let K, targetOf, weightOf, drag0, drag1;
  if (tr.kind === 'drag') {
    shapeU(clamp(tr.dragT, 0, 1), tr.tmp);
    K = PHYS.kDrag; targetOf = (i) => tr.tmp[i]; weightOf = (i) => 0.12 + 0.88 * Math.pow(fIdx[i], 1.5); drag0 = 6; drag1 = 5;
  } else if (tr.kind === 'peek' && !tr.closing) {
    K = PHYS.kPeek;
    targetOf = (i) => { const v = 0.012 + 0.10 * fIdx[i] * fIdx[i]; return tr.peekFwd ? v : 1 - v; };
    weightOf = (i) => 0.3 + 0.7 * fIdx[i]; drag0 = 9; drag1 = 4;
  } else {
    K = PHYS.kFlip; targetOf = () => tr.target; weightOf = (i) => 1 - 0.55 * fIdx[i]; drag0 = 3.5; drag1 = 9;
  }
  let speed = 0; for (let i = 0; i < n; i++) speed += Math.abs(w[i]); speed /= n;
  const flutterOn = tr.kind !== 'peek' || tr.closing;
  const ph = 2 * Math.PI * 3.1 * tr.time;
  for (let i = 0; i < n; i++) {
    const um = i > 0 ? u[i - 1] : u[i], up = i < n - 1 ? u[i + 1] : u[i];
    let acc = PHYS.bend * (um - 2 * u[i] + up)
      + K * weightOf(i) * (targetOf(i) - u[i])
      - (drag0 + drag1 * fIdx[i]) * w[i];
    if (flutterOn) acc += PHYS.flutter * Math.min(speed, 4) * Math.sin(ph - i * 0.8) * Math.pow(fIdx[i], 1.2);
    w[i] += acc * dt;
  }
  let impact = 0;
  for (let i = 0; i < n; i++) {
    u[i] += w[i] * dt;
    if (u[i] < 0) { u[i] = 0; if (w[i] < 0) { impact = Math.max(impact, -w[i]); w[i] = -w[i] * PHYS.restitution; } }
    else if (u[i] > 1) { u[i] = 1; if (w[i] > 0) { impact = Math.max(impact, w[i]); w[i] = -w[i] * PHYS.restitution; } }
  }
  // o papel não dobra além de um limite entre tiras vizinhas
  for (let i = 1; i < n; i++) {
    const d = u[i] - u[i - 1];
    if (d > PHYS.maxStep) { u[i] = u[i - 1] + PHYS.maxStep; w[i] = Math.min(w[i], w[i - 1]); }
    else if (d < -PHYS.maxStep) { u[i] = u[i - 1] - PHYS.maxStep; w[i] = Math.max(w[i], w[i - 1]); }
  }
  // página de baixo levanta um pouquinho enquanto a folha sai
  let mean = 0; for (let i = 0; i < n; i++) mean += u[i]; mean /= n;
  const leaving = tr.kind !== 'peek' && mean > 0.02 && mean < 0.6 ? Math.min(3.2, speed * 1.3) : 0;
  tr.liftV += (130 * (leaving - tr.lift) - 11 * tr.liftV) * dt;
  tr.lift += tr.liftV * dt;
  tr.time += dt;
  return impact;
}

let simRaf = 0, simLast = 0;
function runSim() {
  if (simRaf) return;
  simLast = performance.now();
  simRaf = requestAnimationFrame(simFrame);
}
function simFrame(now) {
  simRaf = 0;
  const tr = S.trans;
  if (!tr) return;
  if (S.simPaused) { simLast = now; simRaf = requestAnimationFrame(simFrame); return; }
  let dt = Math.min(0.05, (now - simLast) / 1000) / (S.flipSpeed || 1);
  simLast = now;
  let impact = 0;
  while (dt > 1e-6) { const h = Math.min(PHYS.dt, dt); impact = Math.max(impact, physStep(tr, h)); dt -= h; }
  if (impact > 1.1 && !tr.thud && tr.kind === 'flip') { tr.thud = true; landSound(Math.min(1, impact / 3)); }
  drawLeaf();
  // terminou?
  if (tr.kind === 'flip' || (tr.kind === 'peek' && tr.closing)) {
    const T = tr.target;
    let maxDev = 0, maxW = 0;
    for (let i = 0; i < N_STRIPS; i++) { maxDev = Math.max(maxDev, Math.abs(tr.u[i] - T)); maxW = Math.max(maxW, Math.abs(tr.w[i])); }
    tr.landed = maxDev < 0.03;
    const settled = maxDev < 0.004 && maxW < 0.06 && Math.abs(tr.lift) < 0.05;
    if (settled || (tr.landed && S.queue.length) || tr.time > 4) {
      return endTransition(T >= 1 ? tr.k0 + 1 : tr.k0);
    }
  } else if (tr.kind === 'peek') {
    let maxW = 0; for (let i = 0; i < N_STRIPS; i++) maxW = Math.max(maxW, Math.abs(tr.w[i]));
    if (maxW < 0.01 && tr.time > 0.3) return; // parado: economiza CPU até o próximo movimento
  }
  simRaf = requestAnimationFrame(simFrame);
}
/** solta a folha rumo a T (0 ou 1), mantendo a velocidade atual (momento) e com um "peteleco" opcional */
function flipTo(T, kick = 0) {
  const tr = S.trans; if (!tr) return;
  tr.kind = 'flip'; tr.target = T; tr.closing = false; tr.time = Math.min(tr.time, 0.5);
  if (kick) {
    const dirn = T >= 1 ? 1 : -1;
    for (let i = 0; i < N_STRIPS; i++) tr.w[i] += dirn * kick * (1 - 0.55 * fIdx[i]); // a lombada sai primeiro; a borda vem atrasada
  }
  runSim();
}
function closePeek() {
  const tr = S.trans; if (!tr || tr.kind !== 'peek' || tr.closing) return;
  tr.closing = true; tr.target = tr.peekFwd ? 0 : 1; tr.time = 0;
  runSim();
}
function endTransition(newK) {
  S.trans = null;
  leaf.classList.remove('on');
  for (const el of Object.values(slotEls)) el.style.transform = '';
  const changed = newK !== S.k;
  S.k = newK;
  renderStatic();
  if (changed) saveProgress();
  if (S.queue.length) { const d = S.queue.shift(); requestAnimationFrame(() => go(d, true)); }
}
const isFlying = (tr) => tr && (tr.kind === 'flip' || tr.kind === 'drag');

// ------------------------------------------------------------ navegação
function canGo(d) { return d > 0 ? S.k < viewCount() - 1 : S.k > 0; }
function go(d, fast) {
  if (!S.n) return;
  const tr = S.trans;
  if (isFlying(tr)) { if (S.queue.length < 3) S.queue.push(d); return; }
  if (tr && tr.kind === 'peek') {
    const fwd = tr.peekFwd;
    if ((d > 0) === fwd) { flipSound(); return flipTo(fwd ? 1 : 0, 2.4); }
    endTransition(S.k);
  }
  if (!canGo(d)) return bump(d);
  flipSound();
  const kick = fast ? 3.2 : 2.1;
  if (d > 0) { beginTransition(S.k, 0, 'flip'); flipTo(1, kick); }
  else { beginTransition(S.k - 1, 1, 'flip'); flipTo(0, kick); }
}
function jumpTo(k) {
  k = clamp(k, 0, viewCount() - 1);
  S.queue = [];
  if (S.trans) { S.trans = null; leaf.classList.remove('on'); }
  if (k === S.k) return renderStatic();
  S.k = k;
  book.classList.remove('jump'); void book.offsetWidth; book.classList.add('jump');
  renderStatic(); saveProgress();
}
let bumpAt = 0;
function bump(d) {
  const now = performance.now(); if (now - bumpAt < 600) return; bumpAt = now;
  const dx = (d > 0 ? -1 : 1) * (S.dir === 'ltr' ? 1 : -1) * 8;
  book.animate([{ translate: '0 0' }, { translate: `${dx}px 0` }, { translate: `${-dx / 2}px 0` }, { translate: '0 0' }], { duration: 320, easing: 'ease-out' });
  if (d > 0) toast(t('rd.end')); else toast(t('rd.isCover'));
}

let saveTimer;
function saveProgress() {
  updateUI();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => S.folder && api.setProgress(S.folder, maxVisible(), S.n), 250);
}

// ------------------------------------------------------------ interface
function updateUI() {
  const v = view(S.k);
  const nums = [v.a, v.b, v.s].filter((x) => x != null).sort((a, b) => a - b).map((x) => x + 1);
  let txt = nums.length === 2 ? `${nums[0]}–${nums[1]}` : String(nums[0] || 1);
  if (S.k === 0 && (v.b === 0 || v.s === 0)) txt = t('rd.cover');
  $('#counter').textContent = `${txt} / ${S.n}`;
  const sl = $('#slider');
  sl.max = Math.max(0, S.n - 1);
  sl.value = maxVisible();
  sl.dir = S.dir === 'rtl' ? 'rtl' : 'ltr';
  sl.style.setProperty('--fill', (S.n > 1 ? (maxVisible() / (S.n - 1)) * 100 : 100) + '%');
  $('#dirLabel').textContent = t(S.dir === 'rtl' ? 'rd.manga' : 'rd.western');
  $('#btnDir').classList.toggle('ltr', S.dir === 'ltr');
  $('#btnDir').title = t(S.dir === 'rtl' ? 'rd.dirRtlLong' : 'rd.dirLtrLong') + ' — ' + t('rd.clickSwitch');
  $('#modeLabel').textContent = t(isDouble() ? 'set.double' : 'set.single');
  $('#modeIcon').innerHTML = isDouble()
    ? '<rect x="3" y="5" width="8" height="14" rx="1"/><rect x="13" y="5" width="8" height="14" rx="1"/>'
    : '<rect x="7" y="4" width="10" height="16" rx="1"/>';
  $('#btnSound').classList.toggle('off', !S.sound);
}
let toastTimer;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('on');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('on'), 1300);
}

function setDirection(dir, silent) {
  if (dir === S.dir) return;
  const anchor = anchorPage();
  S.dir = dir; S.queue = [];
  if (S.trans) { S.trans = null; leaf.classList.remove('on'); }
  S.k = viewOfPage(anchor);
  layout(); renderStatic();
  api.setSettings({ direction: dir });
  if (!silent) toast(t(dir === 'rtl' ? 'rd.toastRtl' : 'rd.toastLtr'));
}
function setMode(mode) {
  if (mode === S.mode) return;
  const anchor = anchorPage();
  S.mode = mode; S.queue = [];
  if (S.trans) { S.trans = null; leaf.classList.remove('on'); }
  buildViews();
  S.k = viewOfPage(anchor);
  layout(); renderStatic();
  api.setSettings({ pageMode: mode });
  toast(t(mode === 'double' ? 'rd.toastDouble' : 'rd.toastSingle'));
  fitWindow();
}
function setDetectSpreads(on) {
  const anchor = anchorPage();
  S.detectSpreads = on; S.queue = [];
  if (S.trans) { S.trans = null; leaf.classList.remove('on'); for (const el of Object.values(slotEls)) el.style.transform = ''; }
  buildViews();
  S.k = viewOfPage(anchor);
  layout(); renderStatic();
}
function fitWindow() {
  // largura ideal da janela para a altura atual (sem sobra transparente dos lados)
  if (S.fs || !S.n) return;
  const p = pads(), a = pageAspect(), BR = 0.02, SR = 0.02;
  const ph = (innerHeight - p.t - p.b) / (1 + 2 * BR);
  const bw = (isDouble() ? 2 : 1) * ph * a + 2 * ph * (BR + SR);
  api.fitBook(Math.round(bw + 2 * p.x + 4));
}

// ------------------------------------------------------------ som de papel (Web Audio)
let actx = null, noiseBuf = null;
function flipSound() {
  if (!S.sound) return;
  try {
    if (!actx) {
      actx = new AudioContext();
      noiseBuf = actx.createBuffer(1, actx.sampleRate * 0.6, actx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      let last = 0;
      for (let i = 0; i < d.length; i++) { const w = Math.random() * 2 - 1; last = (last + 0.04 * w) / 1.04; d[i] = w * 0.6 + last * 3; }
    }
    const t0 = actx.currentTime, r = 0.9 + Math.random() * 0.2;
    const src = actx.createBufferSource(); src.buffer = noiseBuf; src.playbackRate.value = r;
    const bp = actx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 0.7;
    bp.frequency.setValueAtTime(3200 * r, t0); bp.frequency.exponentialRampToValueAtTime(700, t0 + 0.38);
    const hp = actx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 350;
    const g = actx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.16, t0 + 0.05);
    g.gain.setValueAtTime(0.12, t0 + 0.16);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.42);
    src.connect(bp).connect(hp).connect(g).connect(actx.destination);
    src.start(t0); src.stop(t0 + 0.5);
  } catch (e) { /* sem áudio */ }
}
/** "toque" da folha batendo na página — tocado pela física no momento real do impacto */
function landSound(strength) {
  if (!S.sound || !actx) return;
  try {
    const t1 = actx.currentTime;
    const s2 = actx.createBufferSource(); s2.buffer = noiseBuf;
    const lp = actx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 700 + 500 * strength;
    const g2 = actx.createGain();
    g2.gain.setValueAtTime(0.0001, t1); g2.gain.exponentialRampToValueAtTime(0.08 + 0.2 * strength, t1 + 0.01); g2.gain.exponentialRampToValueAtTime(0.0001, t1 + 0.1);
    s2.connect(lp).connect(g2).connect(actx.destination); s2.start(t1, 0.1); s2.stop(t1 + 0.12);
  } catch (e) { /* sem áudio */ }
}

// ------------------------------------------------------------ mouse: clique, arrastar canto, roda, zoom
const stage = $('#stage');
let ptr = null, clickTimer = null, lastUp = 0;
function spineScreenX() {
  const g = S.geo, r = book.getBoundingClientRect(), sc = r.width / g.bw;
  if (isDouble()) return r.left + g.spineX * sc;
  return leafSide() === 'right' ? r.left + (g.b + g.sMax) * sc : r.left + (g.b + g.sMax + g.pw) * sc;
}
function bookScale() { return book.getBoundingClientRect().width / S.geo.bw; }
/** distância assinada a partir da lombada; positivo = lado que vira para frente */
function signedFromSpine(x) { const d = (x - spineScreenX()) / bookScale(); return leafSide() === 'right' ? d : -d; }
function inPages(x, y) {
  const g = S.geo, r = book.getBoundingClientRect(), sc = r.width / g.bw;
  const top = r.top + g.b * sc, bot = top + g.ph * sc;
  if (y < top || y > bot) return false;
  const d = signedFromSpine(x);
  const v = view(S.k);
  if (isDouble()) return (d >= 0 && d <= g.pw && hasSide(v, 'b')) || (d < 0 && d >= -g.pw && hasSide(v, 'a'));
  return d >= 0 && d <= g.pw;
}

// ------------------------------------------------------------ mover a janela manualmente (alça ⠿, título, borda da capa)
// Não usamos -webkit-app-region: no Windows a região nativa captura o mouse por cima das páginas.
let mv = null;
function startWindowDrag(e) {
  if (e.button !== 0 || S.fs) return false;
  e.preventDefault(); e.stopPropagation();
  const el = e.currentTarget;
  try { el.setPointerCapture(e.pointerId); } catch {}
  mv = { el, id: e.pointerId, sx: e.screenX, sy: e.screenY, b: null, nx: e.screenX, ny: e.screenY, raf: 0, moved: false };
  api.getBounds().then((b) => { if (mv) mv.b = b; });
  document.body.classList.add('moving');
  return true;
}
function moveWindowDrag(e) {
  if (!mv || e.pointerId !== mv.id) return;
  mv.nx = e.screenX; mv.ny = e.screenY;
  if (Math.abs(mv.nx - mv.sx) + Math.abs(mv.ny - mv.sy) > 2) mv.moved = true;
  if (!mv.raf) mv.raf = requestAnimationFrame(() => {
    if (!mv) return; mv.raf = 0;
    if (mv.b) api.moveTo({ x: mv.b.x + mv.nx - mv.sx, y: mv.b.y + mv.ny - mv.sy, width: mv.b.width, height: mv.b.height });
  });
}
function endWindowDrag(e) {
  if (!mv || e.pointerId !== mv.id) return;
  try { mv.el.releasePointerCapture(e.pointerId); } catch {}
  if (mv.raf) cancelAnimationFrame(mv.raf);
  if (mv.b && mv.moved) api.moveTo({ x: mv.b.x + mv.nx - mv.sx, y: mv.b.y + mv.ny - mv.sy, width: mv.b.width, height: mv.b.height });
  mv = null;
  document.body.classList.remove('moving');
}
for (const el of [$('.grip'), $('.title-wrap'), ...Object.values(boards)]) {
  el.addEventListener('pointerdown', startWindowDrag);
  el.addEventListener('pointermove', moveWindowDrag);
  el.addEventListener('pointerup', endWindowDrag);
  el.addEventListener('pointercancel', endWindowDrag);
}
$('.title-wrap').addEventListener('dblclick', () => api.toggleFullscreen());
$('.grip').addEventListener('dblclick', () => api.toggleFullscreen());

// ------------------------------------------------------------ páginas: clique, arrastar a folha (com física), canto levantado
stage.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || !S.geo || mv) return;
  if (S.zoom > 1.001) {
    ptr = { pan: true, x: e.clientX, y: e.clientY, px: S.panX, py: S.panY, moved: false, id: e.pointerId };
    document.body.classList.add('panning'); stage.setPointerCapture(e.pointerId); return;
  }
  if (!inPages(e.clientX, e.clientY)) return;
  e.preventDefault();
  const d = signedFromSpine(e.clientX);
  ptr = { x: e.clientX, y: e.clientY, d0: d, t: performance.now(), drag: false, id: e.pointerId, hist: [] };
  stage.setPointerCapture(e.pointerId);
});
stage.addEventListener('pointermove', (e) => {
  showUI();
  if (!S.geo || mv) return;
  if (ptr && ptr.pan) {
    S.panX = ptr.px + (e.clientX - ptr.x); S.panY = ptr.py + (e.clientY - ptr.y);
    if (Math.abs(e.clientX - ptr.x) + Math.abs(e.clientY - ptr.y) > 4) ptr.moved = true;
    applyZoom(false); return;
  }
  if (!ptr) return hoverPeek(e);
  const d = signedFromSpine(e.clientX);
  ptr.hist.push({ d, t: performance.now() }); if (ptr.hist.length > 8) ptr.hist.shift();
  if (!ptr.drag) {
    if (Math.abs(e.clientX - ptr.x) < 6) return;
    const tr = S.trans;
    if (tr) {
      // pega a folha onde ela estiver (até no ar, durante uma virada)
      S.queue = [];
    } else {
      const fwd = isDouble() ? ptr.d0 >= 0 : ptr.d0 > S.geo.pw / 2;
      if (!canGo(fwd ? 1 : -1)) { ptr.blocked = true; return; }
      beginTransition(fwd ? S.k : S.k - 1, fwd ? 0 : 1, 'drag');
    }
    const t = S.trans;
    t.kind = 'drag'; t.closing = false; t.dragT = t.t;
    ptr.drag = true;
    ptr.edge0 = t.edge != null ? t.edge : Math.cos(Math.PI * t.t) * S.geo.pw;
    ptr.d0 = d;
  }
  const pw = S.geo.pw;
  const edge = clamp(ptr.edge0 + (d - ptr.d0), -pw, pw);
  S.trans.dragT = Math.acos(edge / pw) / Math.PI; // a folha persegue o mouse pela mola (com atraso e inércia)
  runSim();
});
function endPointer(e) {
  if (!ptr || (e.pointerId !== ptr.id)) return;
  const p = ptr; ptr = null;
  try { stage.releasePointerCapture(e.pointerId); } catch {}
  document.body.classList.remove('panning');
  if (p.pan) return;
  if (p.drag && S.trans) {
    // velocidade do mouse só dos últimos ~90 ms (soltar depois de parar = sem "arremesso")
    const now = performance.now(), h = p.hist.filter((x) => now - x.t < 90); let v = 0;
    if (h.length > 1) { const a = h[0], b = h[h.length - 1]; v = (b.d - a.d) / Math.max(1, b.t - a.t); }
    const tr = S.trans;
    let meanW = 0; for (let i = 0; i < N_STRIPS; i++) meanW += tr.w[i]; meanW /= N_STRIPS;
    const projected = tr.dragT * 0.5 + tr.t * 0.5 + meanW * 0.12;
    let target = projected > 0.5 ? 1 : 0;
    if (v < -0.45) target = 1; else if (v > 0.45) target = 0;
    const newK = target === 1 ? tr.k0 + 1 : tr.k0;
    if (newK !== S.k) flipSound();
    // continua com o momento atual + o "arremesso" do mouse
    const fling = clamp(Math.abs(v) * 1.6, 0, 3);
    flipTo(target, (target === 1) === (v < 0) ? fling : 0);
    return;
  }
  if (e.type === 'pointercancel' || p.blocked) return;
  // clique simples (com detecção de duplo clique para tela cheia)
  const now = performance.now();
  if (now - lastUp < 260 && clickTimer) {
    clearTimeout(clickTimer); clickTimer = null; lastUp = 0;
    api.toggleFullscreen(); return;
  }
  lastUp = now;
  const fwd = isDouble() ? p.d0 >= 0 : p.d0 > S.geo.pw / 2;
  clearTimeout(clickTimer);
  clickTimer = setTimeout(() => { clickTimer = null; go(fwd ? 1 : -1); }, 200);
}
stage.addEventListener('pointerup', endPointer);
stage.addEventListener('pointercancel', endPointer);

// levantar o canto ao passar o mouse perto da borda externa
function hoverPeek(e) {
  if (S.zoom > 1.001) return;
  const tr = S.trans;
  if (tr && tr.kind !== 'peek') return;
  const g = S.geo, d = signedFromSpine(e.clientX);
  const r = book.getBoundingClientRect(), sc = r.width / g.bw, top = r.top + g.b * sc, bot = top + g.ph * sc;
  const band = g.pw * 0.11, inY = e.clientY > top && e.clientY < bot;
  let want = 0;
  if (inY && d > g.pw - band && d <= g.pw + 4 && canGo(1)) want = 1;
  else if (isDouble() && inY && d < -(g.pw - band) && d >= -g.pw - 4 && canGo(-1)) want = -1;
  if (tr) {
    if (want === (tr.peekFwd ? 1 : -1)) { if (tr.closing) { tr.closing = false; runSim(); } return; }
    closePeek();
    return;
  }
  if (!want) return;
  beginTransition(want > 0 ? S.k : S.k - 1, want > 0 ? 0 : 1, 'peek');
  runSim();
}
stage.addEventListener('pointerleave', () => closePeek());

let wheelAcc = 0, wheelAt = 0;
addEventListener('wheel', (e) => {
  e.preventDefault();
  if (e.ctrlKey) { zoomAt(S.zoom * Math.exp(-e.deltaY * 0.0022), e.clientX, e.clientY); return; }
  if (S.zoom > 1.001) { S.panX -= e.deltaX; S.panY -= e.deltaY; applyZoom(false); return; }
  const horiz = Math.abs(e.deltaX) > Math.abs(e.deltaY);
  let dlt = horiz ? e.deltaX * (S.dir === 'ltr' ? 1 : -1) : e.deltaY;
  wheelAcc += dlt;
  const now = performance.now();
  if (Math.abs(wheelAcc) >= 50 && now - wheelAt > 260) { go(wheelAcc > 0 ? 1 : -1); wheelAcc = 0; wheelAt = now; }
  setTimeout(() => { if (performance.now() - wheelAt > 300) wheelAcc *= 0.5; }, 320);
}, { passive: false });

// zoom
function zoomAt(z, cx, cy) {
  z = clamp(z, 1, 5);
  const k = z / S.zoom;
  S.panX = cx - (cx - S.panX) * k; S.panY = cy - (cy - S.panY) * k;
  S.zoom = z;
  if (S.trans && S.trans.kind === 'peek') endTransition(S.k);
  applyZoom(false);
}
function applyZoom(anim) {
  if (S.zoom <= 1.001) { S.zoom = 1; S.panX = 0; S.panY = 0; }
  else {
    const W = innerWidth, H = innerHeight;
    S.panX = clamp(S.panX, W - W * S.zoom - W * 0.2, W * 0.2);
    S.panY = clamp(S.panY, H - H * S.zoom - H * 0.2, H * 0.2);
  }
  zoomer.classList.toggle('anim', !!anim);
  zoomer.style.transform = S.zoom === 1 ? '' : `translate(${S.panX}px, ${S.panY}px) scale(${S.zoom})`;
  document.body.classList.toggle('zoomed', S.zoom > 1);
  $('#zoomVal').textContent = Math.round(S.zoom * 100) + '%';
}
$('#btnZoomIn').onclick = () => zoomAt(S.zoom * 1.25, innerWidth / 2, innerHeight / 2);
$('#btnZoomOut').onclick = () => zoomAt(S.zoom / 1.25, innerWidth / 2, innerHeight / 2);
$('#zoomVal').onclick = () => { S.zoom = 1; applyZoom(true); };

// ------------------------------------------------------------ teclado
addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' && e.key !== 'Escape') { if (!e.key.startsWith('Arrow')) return; e.target.blur(); }
  const help = !$('#help').classList.contains('hidden');
  const k = e.key;
  const rtl = S.dir === 'rtl';
  if (help && k !== 'F11') { if (k === 'Escape' || k === '?' || k === 'F1') toggleHelp(false); return; }
  if (e.ctrlKey && (k === '=' || k === '+')) return zoomAt(S.zoom * 1.25, innerWidth / 2, innerHeight / 2);
  if (e.ctrlKey && k === '-') return zoomAt(S.zoom / 1.25, innerWidth / 2, innerHeight / 2);
  if (e.ctrlKey && k.toLowerCase() === 'w') return api.close();
  switch (k) {
    case 'ArrowRight': e.preventDefault(); go(rtl ? -1 : 1); break;
    case 'ArrowLeft': e.preventDefault(); go(rtl ? 1 : -1); break;
    case 'ArrowDown': case 'PageDown': e.preventDefault(); go(1); break;
    case 'ArrowUp': case 'PageUp': e.preventDefault(); go(-1); break;
    case ' ': e.preventDefault(); go(e.shiftKey ? -1 : 1); break;
    case 'Home': e.preventDefault(); jumpTo(0); break;
    case 'End': e.preventDefault(); jumpTo(viewCount() - 1); break;
    case 'F11': case 'f': case 'F': e.preventDefault(); api.toggleFullscreen(); break;
    case 'Escape':
      if (S.zoom > 1) { S.zoom = 1; applyZoom(true); }
      else if (S.fs) api.setFullscreen(false);
      break;
    case 'd': case 'D': setDirection(rtl ? 'ltr' : 'rtl'); break;
    case 'm': case 'M': setMode(isDouble() ? 'single' : 'double'); break;
    case 's': case 'S': toggleSound(); break;
    case 'b': case 'B': api.showLibrary(); break;
    case '+': case '=': zoomAt(S.zoom * 1.25, innerWidth / 2, innerHeight / 2); break;
    case '-': zoomAt(S.zoom / 1.25, innerWidth / 2, innerHeight / 2); break;
    case '0': S.zoom = 1; applyZoom(true); break;
    case '?': case 'F1': e.preventDefault(); toggleHelp(true); break;
    default: return;
  }
  showUI();
});

// ------------------------------------------------------------ barras, botões, deslizador
function toggleHelp(v) { $('#help').classList.toggle('hidden', !v); }
function toggleSound() { S.sound = !S.sound; api.setSettings({ sound: S.sound }); updateUI(); toast(t(S.sound ? 'rd.soundOn' : 'rd.soundOff')); }
$('#help').addEventListener('click', () => toggleHelp(false));
// botões não roubam o foco (senão Espaço/Enter "clicariam" o último botão usado)
document.querySelectorAll('.tb, .zoom-val').forEach((b) => b.addEventListener('mousedown', (e) => e.preventDefault()));
$('#btnLibrary').onclick = () => api.showLibrary();
$('#btnDir').onclick = () => setDirection(S.dir === 'rtl' ? 'ltr' : 'rtl');
$('#btnMode').onclick = () => setMode(isDouble() ? 'single' : 'double');
$('#btnSound').onclick = toggleSound;
$('#btnHelp').onclick = () => toggleHelp(true);
$('#btnFull').onclick = () => api.toggleFullscreen();
$('#btnMin').onclick = () => api.minimize();
$('#btnClose').onclick = () => api.close();

const slider = $('#slider'), preview = $('#preview');
function previewAt(p) {
  if (!S.n) return;
  const sl = slider.getBoundingClientRect();
  let frac = S.n > 1 ? p / (S.n - 1) : 0;
  if (S.dir === 'rtl') frac = 1 - frac;
  preview.style.left = 7 + frac * (sl.width - 14) + 'px';
  $('#previewImg').src = S.pages[p].url.replace('manga://page/', 'manga://thumb/');
  $('#previewNum').textContent = p === 0 ? t('rd.cover') : t('rd.pageShort', { n: p + 1 });
}
slider.addEventListener('input', () => { const p = +slider.value; previewAt(p); preview.classList.add('on'); });
slider.addEventListener('change', () => { preview.classList.remove('on'); jumpTo(viewOfPage(+slider.value)); slider.blur(); });
slider.addEventListener('pointerleave', () => preview.classList.remove('on'));
slider.addEventListener('pointermove', (e) => {
  const r = slider.getBoundingClientRect();
  let frac = clamp((e.clientX - r.left) / r.width, 0, 1); if (S.dir === 'rtl') frac = 1 - frac;
  const p = Math.round(frac * (S.n - 1)); previewAt(p); preview.classList.add('on');
});

let uiTimer;
function showUI() {
  document.body.classList.remove('ui-hidden');
  clearTimeout(uiTimer);
  uiTimer = setTimeout(() => {
    if (document.querySelector('.bar-top:hover, .bar-bottom:hover, #resizer:hover') || ptr) return showUI();
    if (!$('#help').classList.contains('hidden')) return;
    document.body.classList.add('ui-hidden');
  }, 2400);
}
addEventListener('mousemove', showUI);

// ------------------------------------------------------------ redimensionar janela (sem bordas)
const resizer = $('#resizer');
let rs = null;
resizer.addEventListener('pointerdown', async (e) => {
  e.preventDefault(); e.stopPropagation();
  resizer.setPointerCapture(e.pointerId);
  rs = { x: e.screenX, y: e.screenY, b: await api.getBounds(), pending: null };
});
resizer.addEventListener('pointermove', (e) => {
  if (!rs || !rs.b) return;
  const nb = { x: rs.b.x, y: rs.b.y, width: rs.b.width + (e.screenX - rs.x), height: rs.b.height + (e.screenY - rs.y) };
  if (!rs.pending) { rs.pending = true; requestAnimationFrame(() => { if (rs) { api.setBounds(rs.next); rs.pending = false; } }); }
  rs.next = nb;
});
resizer.addEventListener('pointerup', () => { rs = null; });

// ------------------------------------------------------------ eventos da janela
let resizeRaf;
addEventListener('resize', () => { cancelAnimationFrame(resizeRaf); resizeRaf = requestAnimationFrame(layout); });
api.onFullscreen((v) => { S.fs = v; document.body.classList.toggle('fs', v); layout(); if (v) toast(t('rd.fsToast')); });
// aparência: tema, fundo atrás do livro e papel envelhecido (ao vivo, vindo das configurações da biblioteca)
let winTransparent = true;
function applyLook(s) {
  if (!s) return;
  YTheme.set(s.theme);
  const bd = s.backdrop || 'default', custom = /^#[0-9a-f]{6}$/i.test(bd), root = document.documentElement;
  document.body.classList.toggle('bd-custom', custom);
  document.body.classList.toggle('bd-transparent', bd === 'transparent' && winTransparent);
  if (custom) root.style.setProperty('--bd-color', bd);
  root.style.setProperty('--page-filter', s.sepia ? YTheme.sepiaFilter(s.sepiaLevel) : 'none');
}
api.onSystemTheme((dark) => YTheme.setSystem(dark));
api.getConfig().then((c) => { winTransparent = !!c.transparentActive; applyLook(c.settings); });
api.onSettingsChanged((s) => {
  applyLook(s);
  if (s.sound !== S.sound) { S.sound = s.sound; updateUI(); }
  if (S.n && s.direction !== S.dir) setDirection(s.direction, true);
  if (S.n && (s.detectSpreads !== false) !== S.detectSpreads) setDetectSpreads(s.detectSpreads !== false);
});
addEventListener('beforeunload', () => { if (S.folder) api.setProgress(S.folder, maxVisible(), S.n); });

api.onReaderLoad(async (p) => {
  if (S.folder) { clearTimeout(saveTimer); api.setProgress(S.folder, maxVisible(), S.n); }
  S.trans = null; S.queue = []; leaf.classList.remove('on');
  book.classList.add('hidden-book');
  $('#loading').classList.remove('done');
  cache.clear();
  Object.assign(S, { folder: p.folder, title: p.title, pages: p.pages, n: p.pages.length, transparent: p.transparent });
  S.dir = p.settings.direction || 'rtl';
  S.mode = p.settings.pageMode || 'double';
  S.sound = p.settings.sound !== false;
  S.flipSpeed = p.settings.flipSpeed || 1;
  S.detectSpreads = p.settings.detectSpreads !== false;
  winTransparent = !!p.transparent; applyLook(p.settings);
  S.zoom = 1;
  buildViews();
  document.body.classList.toggle('opaque', !p.transparent);
  $('#titleName').textContent = p.title;
  $('#seriesName').textContent = p.series || '';
  document.title = `${p.title} — Yomuchu`;
  await Promise.all([ensure(0), ensure(1)]);
  if (S.pages.some((pg) => !pg.w)) buildViews(); // sem dimensões do cabeçalho: usa as já carregadas
  const start = clamp(p.startPage || 0, 0, S.n - 1);
  S.k = viewOfPage(start);
  await Promise.all([ensure(anchorPage()), ensure(maxVisible())]);
  layout(); renderStatic();
  fitWindow();
  requestAnimationFrame(() => { book.classList.remove('hidden-book'); $('#loading').classList.add('done'); });
  showUI();
  if (start > 0) toast(t('rd.resume', { n: start + 1 }));
});

Object.assign(window.__readerTest, { buildViews, view, viewOfPage, setDetectSpreads, beginTransition, renderLeaf, endTransition, flipTo, go, PHYS, pause: (v) => { S.simPaused = !!v; } });
// ------------------------------------------------------------ idioma
// só as barras, a ajuda e os avisos espelham em RTL; o livro segue a direção de leitura
const I18N_TARGETS = ['#topbar', '#bottombar', '#help', '#toast'].map((q) => $(q));
function applyI18n(p) {
  I18N.set(p); I18N.apply(document, I18N_TARGETS);
  if (S.folder && S.title) $('#titleName').textContent = S.title; // o título do livro tem data-i18n ("Carregando…"): não deixa a troca de idioma apagá-lo
  if (S.folder) document.title = `${S.title} — Yomuchu`; else $('#titleName').textContent = t('rd.loading');
  if (S.n) updateUI(); else { $('#dirLabel').textContent = t('rd.manga'); $('#modeLabel').textContent = t('set.double'); }
}
api.getI18n().then(applyI18n);
api.onI18nChanged(applyI18n);
api.isFullscreen().then((v) => { S.fs = v; document.body.classList.toggle('fs', v); });
