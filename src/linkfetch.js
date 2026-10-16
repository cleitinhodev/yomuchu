'use strict';
/*
 * Yomuchu — "Abrir link": baixa um capítulo a partir do endereço de uma página da web.
 *
 * Fluxo: (1) lê o HTML · (2) junta as URLs candidatas na ordem do documento (src, data-src, srcset,
 * <noscript>, <picture>…) · (3) lê só o CABEÇALHO de cada candidata (Range) para saber largura/altura ·
 * (4) filtra pelo PERFIL DE PÁGINA DE MANGÁ (tamanho mínimo, proporção, grupo de resolução dominante, duplas)
 * · (5) baixa só as escolhidas, em paralelo, com repetição, para uma pasta temporária · (6) renomeia 001.jpg…
 * Se o HTML simples render menos de 3 páginas, a página é renderizada numa janela oculta (JavaScript, rolagem
 * para carregar as imagens preguiçosas) e as dimensões vêm dos <img> já carregados.
 * Não tenta burlar login, paywall, captcha ou DRM: se o site bloquear, o erro é mostrado.
 */
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const crypto = require('crypto');

// ============================================================== AJUSTES (perfil de página de mangá)
const PROFILE = {
  minShort: 500,          // lado menor mínimo (px)
  minLong: 700,           // lado maior mínimo (px)
  portraitMin: 1.2,       // altura/largura de uma página em pé: de ...
  portraitMax: 2.2,       // ... até
  spreadMax: 2.4,         // largura/altura máxima de uma dupla deitada
  clusterTol: 0.15,       // largura dentro de ±15% da mediana do maior grupo de resolução
  spreadWidthTol: 0.18,   // dupla: largura ≈ 2× a mediana, com essa tolerância
  spreadHeightTol: 0.25,  // dupla: altura parecida com a das páginas, com essa tolerância
  minBytes: 10 * 1024,    // arquivos menores que isso não são página
};
const LIMITS = {
  maxPages: 400,                    // máximo de páginas por capítulo
  maxCandidates: 800,               // máximo de imagens candidatas analisadas
  maxImageBytes: 60 * 1024 * 1024,  // por imagem
  maxTotalBytes: 800 * 1024 * 1024, // por capítulo
  maxHtmlBytes: 6 * 1024 * 1024,
  concurrency: 4,                   // downloads em paralelo
  probeConcurrency: 8,              // leituras de cabeçalho em paralelo
  retries: 2,                       // novas tentativas por imagem
  probeBytes: 128 * 1024,           // bytes lidos para descobrir as dimensões
  htmlTimeoutMs: 30000,
  probeTimeoutMs: 20000,
  imageTimeoutMs: 120000,
  minPagesBeforeRender: 3,          // abaixo disso usa a janela oculta
  minPages: 2,                      // menos que isso = "nenhuma página encontrada" (uma capa solta não é capítulo)
  renderTimeoutMs: 60000,
  maxRedirects: 5,
};
const USER_AGENT = 'Mozilla/5.0 (compatible; Yomuchu/0.3; leitor pessoal; +https://www.bugzinho.com/)';

class LinkError extends Error {
  constructor(code, detail) { super(code + (detail ? ': ' + detail : '')); this.code = code; this.detail = detail || ''; }
}

// ============================================================== util
const isHttpUrl = (u) => { try { const p = new URL(u).protocol; return p === 'http:' || p === 'https:'; } catch { return false; } };
function normalizeInput(raw) {
  if (typeof raw !== 'string') throw new LinkError('badUrl');
  const s = raw.trim();
  if (!s || s.length > 2048 || /[\u0000-\u001f\s]/.test(s)) throw new LinkError('badUrl');
  let u; try { u = new URL(s); } catch { throw new LinkError('badUrl'); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new LinkError('badUrl');
  u.hash = '';
  return u.toString();
}
function sanitizeName(s, fallback = 'capitulo') {
  s = String(s || '').normalize('NFC')
    .replace(/[\u0000-\u001f\u007f<>:"\/\\|?*]/g, ' ').replace(/\s+/g, ' ').trim().replace(/^[.\s]+|[.\s]+$/g, '');
  if (/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(s)) s = '_' + s;
  s = s.slice(0, 80).trim().replace(/[.\s]+$/g, '');
  return s || fallback;
}
function decodeEntities(s) {
  return String(s).replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#0*39;|&apos;/gi, "'").replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&#x([0-9a-f]+);/gi, (m, n) => String.fromCodePoint(parseInt(n, 16))).replace(/&#(\d+);/g, (m, n) => String.fromCodePoint(+n));
}
const sleep = (ms, signal) => new Promise((res, rej) => {
  const t = setTimeout(res, ms);
  if (signal) signal.addEventListener('abort', () => { clearTimeout(t); rej(new LinkError('cancelled')); }, { once: true });
});
async function mapLimit(items, limit, fn, signal) {
  let next = 0; const out = new Array(items.length);
  const worker = async () => {
    while (true) {
      if (signal && signal.aborted) throw new LinkError('cancelled');
      const i = next++; if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

// ============================================================== dimensões (só o cabeçalho)
function sniffType(b) {
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) return 'jpeg';
  if (b.length > 8 && b.readUInt32BE(0) === 0x89504e47) return 'png';
  if (b.length > 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  if (b.length > 4 && b.toString('ascii', 0, 3) === 'GIF') return 'gif';
  const head = b.toString('utf8', 0, 256).trimStart().toLowerCase();
  if (head.startsWith('<svg') || head.startsWith('<?xml')) return 'svg';
  if (b.length > 12 && b.toString('ascii', 4, 8) === 'ftyp') return 'avif';
  return null;
}
/** lê largura/altura de JPEG, PNG ou WebP sem decodificar a imagem; null se não reconhecer */
function parseImageSize(b) {
  if (b.length > 24 && b.readUInt32BE(0) === 0x89504e47) return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
  if (b.length > 30 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') {
    const t = b.toString('ascii', 12, 16);
    if (t === 'VP8 ') return { w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff };
    if (t === 'VP8L') { const v = b.readUInt32LE(21); return { w: (v & 0x3fff) + 1, h: ((v >> 14) & 0x3fff) + 1 }; }
    if (t === 'VP8X') return { w: 1 + b.readUIntLE(24, 3), h: 1 + b.readUIntLE(27, 3) };
  }
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const m = b[i + 1];
      if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7) || m === 0xff) { i += m === 0xff ? 1 : 2; continue; }
      const len = b.readUInt16BE(i + 2);
      if ((m >= 0xc0 && m <= 0xcf) && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7) };
      i += 2 + len;
    }
  }
  return null;
}

// ============================================================== HTML -> URLs candidatas (ordem do documento)
const PLACEHOLDER = /(^|[\/_.-])(blank|placeholder|loading|loader|spacer|pixel|transparent|lazy|grey|gray|dot)[\w.-]*\.(gif|png|jpe?g|svg|webp)(\?|$)/i;
const LAZY_ATTRS = ['data-src', 'data-original', 'data-lazy-src', 'data-lazy', 'data-url', 'data-echo', 'data-lazyload', 'data-full-src', 'data-hi-res-src', 'data-large-file', 'data-orig-file'];
function parseAttrs(tag) {
  const attrs = {};
  const re = /([^\s"'<>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  const body = tag.replace(/^<\w+/, '').replace(/\/?>$/, '');
  let m;
  while ((m = re.exec(body))) attrs[m[1].toLowerCase()] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? '');
  return attrs;
}
function bestFromSrcset(v) {
  if (!v) return null;
  let best = null, bestScore = -1;
  for (const part of v.split(/,\s+(?=\S)|,(?=\s*https?:|\s*\/)/)) {
    const bits = part.trim().split(/\s+/);
    if (!bits[0]) continue;
    const d = bits[1] || '';
    const score = /w$/i.test(d) ? parseFloat(d) : /x$/i.test(d) ? parseFloat(d) * 1000 : 1;
    if (score > bestScore) { best = bits[0]; bestScore = score; }
  }
  return best;
}
function pickUrl(a) {
  const ok = (u) => u && !/^data:/i.test(u) && !/^(javascript|blob|about):/i.test(u) && !PLACEHOLDER.test(u);
  for (const k of LAZY_ATTRS) if (ok(a[k])) return a[k];
  const ss = bestFromSrcset(a['data-srcset']) || bestFromSrcset(a.srcset);
  if (ok(ss)) return ss;
  if (ok(a.src)) return a.src;
  return null;
}
/** devolve as URLs absolutas (http/https) das imagens do HTML, sem repetir, na ordem do documento */
function extractCandidates(html, baseUrl) {
  let base = baseUrl;
  const bm = /<base\b[^>]*\bhref\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(html);
  if (bm) { try { base = new URL(decodeEntities(bm[2] ?? bm[3] ?? bm[4]), baseUrl).toString(); } catch { /* ignora */ } }
  const out = [], seen = new Set();
  const push = (raw) => {
    if (!raw) return;
    let u; try { u = new URL(raw.trim(), base); } catch { return; }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return;
    u.hash = ''; const s = u.toString();
    if (!seen.has(s)) { seen.add(s); out.push(s); }
  };
  const scan = (src) => {
    const re = /<picture\b[\s\S]*?<\/picture>|<noscript\b[\s\S]*?<\/noscript>|<img\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi;
    let m;
    while ((m = re.exec(src))) {
      const tok = m[0];
      if (/^<picture/i.test(tok)) {
        const im = /<img\b(?:[^>"']|"[^"]*"|'[^']*')*>/i.exec(tok);
        let u = im ? pickUrl(parseAttrs(im[0])) : null;
        if (!u) for (const sm of tok.matchAll(/<source\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi)) { const a = parseAttrs(sm[0]); u = bestFromSrcset(a['data-srcset']) || bestFromSrcset(a.srcset); if (u) break; }
        push(u);
      } else if (/^<noscript/i.test(tok)) scan(tok.replace(/^<noscript[^>]*>/i, '').replace(/<\/noscript>$/i, ''));
      else push(pickUrl(parseAttrs(tok)));
    }
  };
  // ignora o que está em comentários e scripts (mas mantém <noscript>)
  scan(html.replace(/<!--[\s\S]*?-->/g, '').replace(/<script\b[\s\S]*?<\/script>/gi, '').replace(/<style\b[\s\S]*?<\/style>/gi, ''));
  return out;
}
function pageTitle(html, url) {
  const og = /<meta[^>]+property\s*=\s*["']og:title["'][^>]*content\s*=\s*["']([^"']+)["']/i.exec(html) || /<meta[^>]+content\s*=\s*["']([^"']+)["'][^>]*property\s*=\s*["']og:title["']/i.exec(html);
  const ti = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const h1 = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
  const raw = decodeEntities(((ti && ti[1]) || (og && og[1]) || (h1 && h1[1]) || '').replace(/<[^>]+>/g, ' '));
  let host = 'link'; try { host = new URL(url).hostname.replace(/^www\./, ''); } catch { /* */ }
  return sanitizeName(raw, host);
}

// ============================================================== perfil de página de mangá
const median = (arr) => { const s = [...arr].sort((a, b) => a - b); const n = s.length; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; };
/** items: [{url,w,h,bytes?,type?}] na ordem do documento -> { kept, dropped:[{url,reason}], cluster:{w,h,n} } */
function filterByProfile(items, P = PROFILE) {
  const seen = new Set(), dropped = [], pool = [];
  for (const it of items) {
    const key = String(it.url).split('#')[0];
    if (seen.has(key)) { dropped.push({ url: it.url, reason: 'duplicada' }); continue; }
    seen.add(key);
    if (it.type && !['jpeg', 'png', 'webp'].includes(it.type)) { dropped.push({ url: it.url, reason: 'formato' }); continue; }
    if (!it.w || !it.h) { dropped.push({ url: it.url, reason: 'sem-dimensões' }); continue; }
    if (it.bytes != null && it.bytes < P.minBytes) { dropped.push({ url: it.url, reason: 'arquivo-pequeno' }); continue; }
    if (Math.min(it.w, it.h) < P.minShort || Math.max(it.w, it.h) < P.minLong) { dropped.push({ url: it.url, reason: 'pequena' }); continue; }
    pool.push(it);
  }
  const ratio = (i) => i.h / i.w;
  const portrait = pool.filter((i) => ratio(i) >= P.portraitMin && ratio(i) <= P.portraitMax);
  const isLand = (i) => i.w > i.h && i.w / i.h <= P.spreadMax;
  let best = [];
  for (const a of portrait) {
    const members = portrait.filter((b) => Math.abs(b.w - a.w) <= P.clusterTol * a.w);
    if (members.length > best.length) best = members;
  }
  if (!best.length) {
    for (const i of pool) dropped.push({ url: i.url, reason: 'proporção' });
    return { kept: [], dropped, cluster: null };
  }
  const mw = median(best.map((i) => i.w)), mh = median(best.map((i) => i.h));
  const kept = [];
  for (const i of pool) {
    if (portrait.includes(i)) {
      if (Math.abs(i.w - mw) <= P.clusterTol * mw) kept.push(i); else dropped.push({ url: i.url, reason: 'resolução-diferente' });
    } else if (isLand(i)) {
      if (Math.abs(i.w - 2 * mw) <= P.spreadWidthTol * 2 * mw && Math.abs(i.h - mh) <= P.spreadHeightTol * mh) kept.push(i);
      else dropped.push({ url: i.url, reason: 'dupla-fora-do-padrão' });
    } else dropped.push({ url: i.url, reason: 'proporção' });
  }
  return { kept, dropped, cluster: { w: mw, h: mh, n: best.length } };
}

// ============================================================== rede (só http/https, redirecionamentos validados)
function combineSignals(signal, ms) {
  const sigs = [AbortSignal.timeout(ms)];
  if (signal) sigs.push(signal);
  return AbortSignal.any(sigs);
}
async function httpGet(url, { headers = {}, signal, timeoutMs = 30000, cookies } = {}) {
  let cur = url;
  for (let hop = 0; hop <= LIMITS.maxRedirects; hop++) {
    if (!isHttpUrl(cur)) throw new LinkError('badUrl', 'redirecionamento para esquema não permitido');
    const h = { 'User-Agent': USER_AGENT, 'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8', ...headers };
    if (cookies) { const c = await cookies(cur); if (c) h.Cookie = c; }
    let res;
    try { res = await fetch(cur, { headers: h, redirect: 'manual', signal: combineSignals(signal, timeoutMs) }); }
    catch (e) {
      if (signal && signal.aborted) throw new LinkError('cancelled');
      if (e && (e.name === 'TimeoutError' || e.name === 'AbortError')) throw new LinkError('network', 'tempo esgotado');
      throw new LinkError('network', (e && e.cause && e.cause.code) || (e && e.message) || 'erro de rede');
    }
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      let next; try { next = new URL(res.headers.get('location'), cur).toString(); } catch { throw new LinkError('http', 'redirecionamento inválido'); }
      try { await res.body?.cancel(); } catch { /* */ }
      cur = next; continue;
    }
    return { res, finalUrl: cur };
  }
  throw new LinkError('http', 'redirecionamentos demais');
}
/** lê até `max` bytes do corpo e cancela o resto */
async function readUpTo(res, max, signal) {
  const chunks = []; let n = 0;
  const reader = res.body.getReader();
  try {
    while (n < max) {
      if (signal && signal.aborted) throw new LinkError('cancelled');
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(Buffer.from(value)); n += value.length;
    }
  } finally { try { await reader.cancel(); } catch { /* */ } }
  return Buffer.concat(chunks).subarray(0, max);
}
const BLOCK_STATUS = new Set([401, 403, 407, 429, 451, 503]);
const CHALLENGE = /cf-browser-verification|challenge-platform|Just a moment\.\.\.|g-recaptcha|hcaptcha|captcha-container|Attention Required/i;

async function fetchHtml(url, signal) {
  const { res, finalUrl } = await httpGet(url, { headers: { Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5' }, signal, timeoutMs: LIMITS.htmlTimeoutMs });
  if (BLOCK_STATUS.has(res.status)) { try { await res.body?.cancel(); } catch { /* */ } throw new LinkError('blocked', 'HTTP ' + res.status); }
  if (!res.ok) { try { await res.body?.cancel(); } catch { /* */ } throw new LinkError('http', 'HTTP ' + res.status); }
  const buf = await readUpTo(res, LIMITS.maxHtmlBytes, signal);
  const type = (res.headers.get('content-type') || '').toLowerCase();
  let html;
  const cs = /charset=([\w-]+)/i.exec(type);
  try { html = new TextDecoder(cs ? cs[1] : 'utf-8').decode(buf); } catch { html = buf.toString('utf8'); }
  return { html, finalUrl, isHtml: !type || /html|xml|text/.test(type), type };
}

/** cabeçalho de uma imagem candidata: { type, w, h, bytes } (ou null) */
async function probeImage(url, referer, signal, cookies) {
  try {
    const { res } = await httpGet(url, { headers: { Referer: referer, Accept: 'image/avif,image/webp,image/png,image/jpeg,*/*;q=0.5', Range: `bytes=0-${LIMITS.probeBytes - 1}` }, signal, timeoutMs: LIMITS.probeTimeoutMs, cookies });
    if (!res.ok && res.status !== 206) { try { await res.body?.cancel(); } catch { /* */ } return { error: res.status }; }
    let bytes = null;
    const cr = /\/(\d+)\s*$/.exec(res.headers.get('content-range') || '');
    if (cr) bytes = +cr[1]; else if (res.headers.get('content-length')) bytes = +res.headers.get('content-length');
    const buf = await readUpTo(res, LIMITS.probeBytes, signal);
    const type = sniffType(buf);
    const sz = parseImageSize(buf);
    return { type, w: sz ? sz.w : 0, h: sz ? sz.h : 0, bytes: bytes != null ? bytes : (buf.length < LIMITS.probeBytes ? buf.length : null) };
  } catch (e) { if (e instanceof LinkError && e.code === 'cancelled') throw e; return { error: e.message }; }
}

// ============================================================== página renderizada (JavaScript) numa janela oculta
const RENDER_SCRIPT = `(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const t0 = Date.now(); let lastH = 0, stable = 0;
  for (let i = 0; i < 120; i++) {
    window.scrollBy(0, Math.max(400, Math.round(innerHeight * 0.8))); await sleep(220);
    const h = document.documentElement.scrollHeight;
    if (scrollY + innerHeight >= h - 4) { stable = (h === lastH) ? stable + 1 : 0; if (stable >= 3) break; } else stable = 0;
    lastH = h;
    if (Date.now() - t0 > 25000) break;
  }
  const t1 = Date.now();
  while (Date.now() - t1 < 8000 && [...document.images].some((i) => !i.complete)) await sleep(150);
  window.scrollTo(0, 0);
  return { title: document.title, html: document.documentElement.outerHTML.length, imgs: [...document.images].map((i) => ({ url: i.currentSrc || i.src, w: i.naturalWidth, h: i.naturalHeight })) };
})()`;
async function renderPage(url, { signal, electron, onStatus }) {
  const { BrowserWindow, session } = electron;
  const ses = session.fromPartition('yomuchu-link-render'); // em memória, sem cookies persistentes
  ses.webRequest.onBeforeRequest((d, cb) => cb({ cancel: !/^(https?|data|blob|devtools):/i.test(d.url) || d.resourceType === 'media' }));
  const win = new BrowserWindow({ show: false, width: 1280, height: 1800, webPreferences: { session: ses, sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
  const wc = win.webContents;
  wc.setUserAgent(USER_AGENT);
  wc.setWindowOpenHandler(() => ({ action: 'deny' }));
  const guard = (e, u) => { if (!isHttpUrl(u)) e.preventDefault(); };
  wc.on('will-navigate', guard); wc.on('will-redirect', guard);
  let aborted = false;
  const onAbort = () => { aborted = true; if (!win.isDestroyed()) win.destroy(); };
  if (signal) signal.addEventListener('abort', onAbort, { once: true });
  try {
    if (signal && signal.aborted) throw new LinkError('cancelled');
    const loaded = new Promise((res, rej) => {
      wc.once('did-finish-load', res);
      wc.once('did-fail-load', (e, code, desc, u, isMain) => { if (isMain) rej(new LinkError('network', desc || String(code))); });
    });
    wc.loadURL(url, { userAgent: USER_AGENT, httpReferrer: new URL(url).origin + '/' }).catch(() => {});
    await Promise.race([loaded, sleep(LIMITS.renderTimeoutMs, signal).then(() => { throw new LinkError('network', 'tempo esgotado'); })]);
    if (onStatus) onStatus();
    const r = await Promise.race([wc.executeJavaScript(RENDER_SCRIPT, true), sleep(LIMITS.renderTimeoutMs, signal).then(() => { throw new LinkError('network', 'tempo esgotado'); })]);
    const items = [];
    const seen = new Set();
    for (const i of r.imgs || []) {
      if (!isHttpUrl(i.url)) continue;
      const u = new URL(i.url); u.hash = '';
      if (seen.has(u.toString())) continue; seen.add(u.toString());
      items.push({ url: u.toString(), w: i.w | 0, h: i.h | 0 });
    }
    const cookieCache = new Map();
    const cookies = async (u) => {
      const origin = new URL(u).origin;
      if (!cookieCache.has(origin)) {
        try { const cs = await ses.cookies.get({ url: u }); cookieCache.set(origin, cs.map((c) => `${c.name}=${c.value}`).join('; ')); } catch { cookieCache.set(origin, ''); }
      }
      return cookieCache.get(origin);
    };
    // pré-carrega os cookies das origens das imagens antes de fechar a janela
    for (const it of items) await cookies(it.url);
    return { items, title: r.title || '', cookies: (u) => cookieCache.get(new URL(u).origin) || '' };
  } catch (e) {
    if (aborted) throw new LinkError('cancelled');
    throw e;
  } finally {
    if (signal) signal.removeEventListener('abort', onAbort);
    if (!win.isDestroyed()) win.destroy();
  }
}

// ============================================================== download do capítulo
function extFor(type) { return type === 'png' ? '.png' : type === 'webp' ? '.webp' : '.jpg'; }
async function rmrf(p) { try { await fsp.rm(p, { recursive: true, force: true }); } catch { /* */ } }

async function downloadOne(it, referer, tmpFile, ctx) {
  let lastErr;
  for (let attempt = 0; attempt <= LIMITS.retries; attempt++) {
    if (ctx.signal.aborted) throw new LinkError('cancelled');
    try {
      const { res } = await httpGet(it.url, { headers: { Referer: referer, Accept: 'image/avif,image/webp,image/png,image/jpeg,*/*;q=0.5' }, signal: ctx.signal, timeoutMs: LIMITS.imageTimeoutMs, cookies: ctx.cookies });
      if (!res.ok) { try { await res.body?.cancel(); } catch { /* */ } throw new LinkError(BLOCK_STATUS.has(res.status) ? 'blocked' : 'http', 'HTTP ' + res.status); }
      const hash = crypto.createHash('sha1');
      let size = 0, head = null;
      const fh = await fsp.open(tmpFile, 'w');
      try {
        const reader = res.body.getReader();
        while (true) {
          if (ctx.signal.aborted) { try { await reader.cancel(); } catch { /* */ } throw new LinkError('cancelled'); }
          const { done, value } = await reader.read();
          if (done) break;
          size += value.length; ctx.total += value.length;
          if (size > LIMITS.maxImageBytes || ctx.total > LIMITS.maxTotalBytes) { try { await reader.cancel(); } catch { /* */ } throw new LinkError('tooBig', ctx.total > LIMITS.maxTotalBytes ? `${Math.round(LIMITS.maxTotalBytes / 1048576)} MB` : `${Math.round(LIMITS.maxImageBytes / 1048576)} MB/imagem`); }
          const b = Buffer.from(value);
          if (!head) head = b;
          hash.update(b); await fh.write(b);
        }
      } finally { await fh.close().catch(() => {}); }
      const type = head ? sniffType(head) : null;
      if (!['jpeg', 'png', 'webp'].includes(type)) throw new LinkError('http', 'não é uma imagem JPEG/PNG/WebP');
      return { type, sha: hash.digest('hex'), size };
    } catch (e) {
      lastErr = e;
      if (e instanceof LinkError && ['cancelled', 'tooBig'].includes(e.code)) throw e;
      if (attempt < LIMITS.retries) await sleep(400 * (attempt + 1), ctx.signal);
    }
  }
  throw lastErr;
}

/**
 * Baixa o capítulo de `rawUrl` para destRoot/<título>/001.jpg…
 * opts: { destRoot, signal, onProgress(p), electron }  ->  { folder, title, pages, failed, truncated, usedRender, stats }
 */
async function downloadChapter(rawUrl, opts) {
  const { destRoot, signal, electron } = opts;
  const progress = (phase, done = 0, total = 0, pct = null) => { if (opts.onProgress) opts.onProgress({ phase, done, total, pct }); };
  const url = normalizeInput(rawUrl);
  progress('page', 0, 0, 2);
  let html = '', finalUrl = url, htmlErr = null;
  try { ({ html, finalUrl } = await fetchHtml(url, signal)); } catch (e) { if (e instanceof LinkError && ['blocked', 'cancelled', 'badUrl'].includes(e.code)) throw e; htmlErr = e; }
  if (htmlErr) throw htmlErr; // erro de rede / HTTP: mostra a mensagem (a janela oculta não adiantaria)
  const referer = finalUrl;
  const title = html ? pageTitle(html, finalUrl) : sanitizeName('', new URL(url).hostname);
  let cookies = null, usedRender = false;
  let chosen = [], stats = { candidates: 0, kept: 0, dropped: 0 }, cluster = null;

  // ---- caminho 1: HTML simples
  if (html) {
    const cands = extractCandidates(html, finalUrl).slice(0, LIMITS.maxCandidates);
    stats.candidates = cands.length;
    let done = 0;
    const probed = await mapLimit(cands, LIMITS.probeConcurrency, async (u) => {
      const r = await probeImage(u, referer, signal, null);
      progress('probe', ++done, cands.length, 5 + 25 * done / Math.max(1, cands.length));
      return { url: u, ...(r.error ? {} : r) };
    }, signal);
    const f = filterByProfile(probed);
    chosen = f.kept; cluster = f.cluster; stats.dropped = f.dropped.length;
  }

  // ---- caminho 2: página renderizada (principal quando o HTML simples acha menos de 3 páginas)
  if (chosen.length < LIMITS.minPagesBeforeRender && electron) {
    progress('render', 0, 0, null);
    let rr = null;
    try { rr = await renderPage(finalUrl, { signal, electron }); }
    catch (e) { if (e instanceof LinkError && e.code === 'cancelled') throw e; if (!html) throw (htmlErr || e); }
    if (rr) {
      const unknown = rr.items.filter((i) => !i.w || !i.h);
      let done = 0;
      await mapLimit(unknown, LIMITS.probeConcurrency, async (it) => {
        const r = await probeImage(it.url, referer, signal, async (u) => rr.cookies(u));
        if (!r.error) Object.assign(it, r);
        progress('probe', ++done, unknown.length, 30);
      }, signal);
      // tipo/bytes de quem já tinha dimensões não é conhecido: o download confere o formato
      const f = filterByProfile(rr.items);
      if (f.kept.length > chosen.length) { chosen = f.kept; cluster = f.cluster; usedRender = true; stats = { candidates: rr.items.length, kept: f.kept.length, dropped: f.dropped.length }; cookies = async (u) => rr.cookies(u); }
    }
  }
  if (chosen.length < LIMITS.minPages) {
    if (html && CHALLENGE.test(html) && !stats.candidates) throw new LinkError('blocked', 'verificação anti-robô');
    throw new LinkError('noPages');
  }
  let truncated = false;
  if (chosen.length > LIMITS.maxPages) { chosen = chosen.slice(0, LIMITS.maxPages); truncated = true; }
  stats.kept = chosen.length;

  // ---- download
  await fsp.mkdir(destRoot, { recursive: true });
  const tmp = path.join(destRoot, '.tmp-' + crypto.randomBytes(5).toString('hex'));
  await fsp.mkdir(tmp, { recursive: true });
  const ctx = { signal, total: 0, cookies };
  const results = new Array(chosen.length);
  let finished = 0, failed = 0, firstErr = null;
  progress('download', 0, chosen.length, 30);
  try {
    await mapLimit(chosen, LIMITS.concurrency, async (it, i) => {
      const f = path.join(tmp, `p${i}.part`);
      try { results[i] = { ...(await downloadOne(it, referer, f, ctx)), file: f }; }
      catch (e) {
        if (e instanceof LinkError && ['cancelled', 'tooBig'].includes(e.code)) throw e;
        failed++; firstErr = firstErr || e; await fsp.rm(f, { force: true }).catch(() => {});
      }
      progress('download', ++finished, chosen.length, 30 + 68 * finished / chosen.length);
    }, signal);
    const ok = results.filter(Boolean);
    if (!ok.length) throw (firstErr && firstErr.code === 'blocked' ? firstErr : new LinkError('noPages', 'nenhuma imagem pôde ser baixada'));
    // duplicatas por conteúdo (mesmo hash), mantendo a primeira
    const seenHash = new Set(), finalList = [];
    for (const r of ok) { if (seenHash.has(r.sha)) { await fsp.rm(r.file, { force: true }); continue; } seenHash.add(r.sha); finalList.push(r); }
    progress('save', finalList.length, finalList.length, 99);
    const width = Math.max(3, String(finalList.length).length);
    finalList.forEach((r, i) => { r.name = String(i + 1).padStart(width, '0') + extFor(r.type); });
    for (const r of finalList) await fsp.rename(r.file, path.join(tmp, r.name));
    await fsp.writeFile(path.join(tmp, '.yomuchu-link.json'), JSON.stringify({ url, title, date: Date.now(), pages: finalList.length, usedRender, cluster }, null, 1));
    // pasta final: substitui um download anterior do mesmo link; nomes repetidos ganham " (2)"
    let slug = title, n = 2;
    const metaUrl = async (d) => { try { return JSON.parse(await fsp.readFile(path.join(d, '.yomuchu-link.json'), 'utf8')).url; } catch { return null; } };
    for (;;) {
      const dest = path.join(destRoot, slug);
      if (!fs.existsSync(dest)) break;
      if ((await metaUrl(dest)) === url) { await rmrf(dest); break; }
      slug = `${title} (${n++})`;
    }
    const folder = path.join(destRoot, slug);
    await fsp.rename(tmp, folder);
    return { folder, title: slug, pages: finalList.length, failed, truncated, usedRender, stats: { ...stats, dupHash: ok.length - finalList.length }, cluster };
  } catch (e) {
    await rmrf(tmp);
    throw e;
  }
}

module.exports = { PROFILE, LIMITS, USER_AGENT, LinkError, downloadChapter, extractCandidates, filterByProfile, parseImageSize, sniffType, sanitizeName, normalizeInput, isHttpUrl, pageTitle };
