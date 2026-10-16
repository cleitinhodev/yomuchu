'use strict';
/* Aplica o tema (data-theme em <html>) antes da primeira pintura.
   A preferência vem na URL (?theme=dark|light|system) escolhida pelo processo principal; depois é trocada ao vivo com YTheme.set(). */
(function () {
  const VALID = ['dark', 'light', 'system'];
  const mq = matchMedia('(prefers-color-scheme: light)');
  const qs = new URLSearchParams(location.search);
  let pref = qs.get('theme');
  if (!VALID.includes(pref)) pref = 'dark';
  // claro/escuro do sistema: o processo principal informa (nativeTheme); matchMedia é só o plano B
  let sys = qs.get('sys') === 'dark' || qs.get('sys') === 'light' ? qs.get('sys') : (mq.matches ? 'light' : 'dark');
  let native = qs.has('sys');
  const resolve = () => (pref === 'light' || (pref === 'system' && sys === 'light') ? 'light' : 'dark');
  function apply() {
    const r = resolve(), h = document.documentElement;
    h.dataset.theme = r; h.dataset.themePref = pref; h.style.colorScheme = r;
  }
  mq.addEventListener('change', () => { if (!native) { sys = mq.matches ? 'light' : 'dark'; if (pref === 'system') apply(); } });
  // "papel envelhecido": filtro CSS barato (uma matriz de cor na GPU). level 0–100; 0 = sem efeito
  function sepiaFilter(level) {
    const k = Math.min(100, Math.max(0, Number(level) || 0)) / 100;
    if (k === 0) return 'none';
    return `sepia(${(k * 0.85).toFixed(3)}) saturate(${(1 + k * 0.2).toFixed(3)}) contrast(${(1 - k * 0.1).toFixed(3)}) brightness(${(1 - k * 0.04).toFixed(3)})`;
  }
  window.YTheme = { sepiaFilter, set(p) { pref = VALID.includes(p) ? p : 'dark'; apply(); },
    setSystem(isDark) { native = true; sys = isDark ? 'dark' : 'light'; apply(); }, get pref() { return pref; }, get resolved() { return resolve(); } };
  apply();
})();
