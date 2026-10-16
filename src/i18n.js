'use strict';
/* Yomuchu — tradução da interface (compartilhado pela biblioteca e pelo leitor).
 * Atributos no HTML:
 *   data-i18n="chave"        -> textContent
 *   data-i18n-html="chave"   -> innerHTML (textos com <b>, <kbd>...)
 *   data-i18n-title="chave"  -> title (dica do mouse)
 *   data-i18n-ph="chave"     -> placeholder
 *   data-i18n-aria="chave"   -> aria-label
 * Os textos ficam em src/locales/<idioma>.json (um arquivo pequeno por idioma). */
const I18N = {
  lang: 'en', dir: 'ltr', strings: {}, fallback: {}, languages: [], auto: true,
  t(key, vars) {
    let s = this.strings[key];
    if (s == null) s = this.fallback[key];
    if (s == null) s = key;
    return vars ? s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m)) : s;
  },
  set(p) { Object.assign(this, p); },
  /** aplica os textos ao documento; dirTargets = elementos que espelham em RTL (padrão: <html>) */
  apply(root = document, dirTargets) {
    document.documentElement.lang = this.lang;
    const targets = dirTargets || [document.documentElement];
    for (const el of targets) el.dir = this.dir;
    document.body.classList.toggle('rtl-ui', this.dir === 'rtl');
    root.querySelectorAll('[data-i18n]').forEach((e) => { e.textContent = this.t(e.dataset.i18n); });
    root.querySelectorAll('[data-i18n-html]').forEach((e) => { e.innerHTML = this.t(e.dataset.i18nHtml); });
    root.querySelectorAll('[data-i18n-title]').forEach((e) => { e.title = this.t(e.dataset.i18nTitle); });
    root.querySelectorAll('[data-i18n-ph]').forEach((e) => { e.placeholder = this.t(e.dataset.i18nPh); });
    root.querySelectorAll('[data-i18n-aria]').forEach((e) => { e.setAttribute('aria-label', this.t(e.dataset.i18nAria)); });
  },
};
window.I18N = I18N;
const t = (k, v) => I18N.t(k, v);
