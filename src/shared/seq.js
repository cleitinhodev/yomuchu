'use strict';
/*
 * Yomuchu — "Download em lote": lista de links e sequências de endereços (1…29, 01…29, a…z).
 * Usado pela interface (pré-visualização ao vivo) e pelo processo principal (que confere tudo de novo).
 * Sem dependências: funciona no navegador (window.YSeq) e no Node (require).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.YSeq = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  // ============================================================== AJUSTES
  const BATCH = {
    maxLinks: 500,        // máximo de links por lote (acima disso é recusado)
    confirmAbove: 100,    // acima disso a interface pede confirmação
    maxStep: 1000,
    maxDigits: 9,         // dígitos máximos de um número da sequência
    maxLetters: 4,        // letras máximas de uma sequência alfabética (a…zzzz)
    placeholder: /\{n\}/gi,
  };

  /** "www.site.com/x" -> "https://www.site.com/x" (só quando não há esquema); "//h/x" -> "https://h/x" */
  function fixScheme(s) {
    s = String(s || '').trim();
    if (!s) return s;
    if (/^\/\//.test(s)) return 'https:' + s;
    if (/^[a-z][a-z0-9+.-]*:/i.test(s) && !/^[^\/?#]*\.[^\/?#]*:\d+(\/|$)/i.test(s) && !/^localhost:\d+/i.test(s)) return s; // já tem esquema (ou é perigoso: o principal recusa)
    return 'https://' + s;
  }
  const validUrl = (u) => { try { const p = new URL(u); return (p.protocol === 'http:' || p.protocol === 'https:') && !/[\u0000-\u001f\s]/.test(u) && u.length <= 2048; } catch { return false; } };

  /** texto -> { urls, invalid:[texto], dup } separando por ponto e vírgula, quebra de linha ou espaço */
  function parseList(text) {
    const urls = [], invalid = [], seen = new Set();
    let dup = 0;
    for (const part of String(text || '').split(/[;\r\n\s]+/)) {
      const raw = part.trim();
      if (!raw) continue;
      const u = fixScheme(raw);
      if (!validUrl(u)) { invalid.push(raw); continue; }
      const key = new URL(u).toString();
      if (seen.has(key)) { dup++; continue; }
      seen.add(key); urls.push(key);
    }
    return { urls, invalid, dup };
  }

  // letras: a=1 … z=26, aa=27 … (estilo planilha)
  const alphaToNum = (s) => { let n = 0; for (const ch of s.toLowerCase()) n = n * 26 + (ch.charCodeAt(0) - 96); return n; };
  function numToAlpha(n, upper) {
    let s = '';
    while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(97 + r) + s; n = Math.floor((n - 1) / 26); }
    return upper ? s.toUpperCase() : s;
  }

  /**
   * spec: { pattern, kind:'num'|'alpha', start, end, step, pad:'auto'|número de dígitos }
   * -> { ok, error?, count, urls, first, last, width }  (error: noPattern | badRange | badAlpha | badStep | tooMany | badUrl)
   */
  function buildSequence(spec) {
    const out = { ok: false, count: 0, urls: [], first: '', last: '', width: 0 };
    const pattern = String((spec && spec.pattern) || '').trim();
    if (!pattern || !(BATCH.placeholder.lastIndex = 0, BATCH.placeholder.test(pattern))) { out.error = 'noPattern'; return out; }
    BATCH.placeholder.lastIndex = 0;
    const kind = spec.kind === 'alpha' ? 'alpha' : 'num';
    let step = spec.step === '' || spec.step == null ? 1 : Number(spec.step);
    if (!Number.isInteger(step) || step < 1 || step > BATCH.maxStep) { out.error = 'badStep'; return out; }
    const start = String(spec.start == null ? '' : spec.start).trim(), end = String(spec.end == null ? '' : spec.end).trim();
    let values = [], fmt;
    let a, b;
    if (kind === 'num') {
      if (!/^\d+$/.test(start) || !/^\d+$/.test(end) || start.length > BATCH.maxDigits || end.length > BATCH.maxDigits) { out.error = 'badRange'; return out; }
      a = parseInt(start, 10); b = parseInt(end, 10);
      let width = 0;
      if (spec.pad === 'auto' || spec.pad == null || spec.pad === '') {
        if ((start.length > 1 && start[0] === '0') || (end.length > 1 && end[0] === '0')) width = Math.max(start.length, end.length); // "01" até "29" -> 2 dígitos
      } else width = Math.max(0, Math.min(BATCH.maxDigits, parseInt(spec.pad, 10) || 0));
      out.width = width;
      fmt = (n) => String(n).padStart(width, '0');
    } else {
      const okCase = (s) => /^[a-z]+$/.test(s) || /^[A-Z]+$/.test(s);
      if (!okCase(start) || !okCase(end) || start.length > BATCH.maxLetters || end.length > BATCH.maxLetters || (start === start.toUpperCase()) !== (end === end.toUpperCase())) { out.error = 'badAlpha'; return out; }
      a = alphaToNum(start); b = alphaToNum(end);
      const upper = start === start.toUpperCase();
      fmt = (n) => numToAlpha(n, upper);
    }
    const count = Math.floor(Math.abs(b - a) / step) + 1;
    out.count = count;
    if (count > BATCH.maxLinks) { out.error = 'tooMany'; return out; }
    const dir = b >= a ? 1 : -1;
    for (let i = 0; i < count; i++) values.push(fmt(a + dir * step * i));
    const urls = [];
    for (const v of values) {
      const u = fixScheme(pattern.replace(BATCH.placeholder, () => v));
      if (!validUrl(u)) { out.error = 'badUrl'; out.detail = u.slice(0, 120); return out; }
      urls.push(new URL(u).toString());
    }
    out.ok = true; out.urls = urls; out.first = urls[0]; out.last = urls[urls.length - 1];
    return out;
  }

  /** especificação vinda da interface -> { ok, urls, error?, detail?, dup? } (usado também pelo processo principal) */
  function resolveSpec(spec) {
    if (!spec || typeof spec !== 'object') return { ok: false, error: 'empty' };
    if (spec.mode === 'seq') return buildSequence(spec);
    const p = parseList(spec.text);
    if (p.invalid.length) return { ok: false, error: 'badUrl', detail: p.invalid[0].slice(0, 120), urls: [], count: p.urls.length };
    if (!p.urls.length) return { ok: false, error: 'empty', urls: [], count: 0 };
    if (p.urls.length > BATCH.maxLinks) return { ok: false, error: 'tooMany', urls: [], count: p.urls.length };
    return { ok: true, urls: p.urls, count: p.urls.length, dup: p.dup, first: p.urls[0], last: p.urls[p.urls.length - 1] };
  }

  return { BATCH, fixScheme, parseList, buildSequence, resolveSpec, alphaToNum, numToAlpha };
});
