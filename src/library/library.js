'use strict';
const api = window.mangaAPI;
const $ = (s) => document.querySelector(s);
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const PLAY = '<svg viewBox="0 0 24 24"><path d="M7 4v16l13-8z"/></svg>';

const state = { cfg: null, data: null, series: null, query: '', sort: 'name' };
window.__libState = state; // usado pelos testes automatizados

// ------------------------------------------------------------ util
let toastTimer;
function toast(msg, err) {
  const t = $('#toast');
  t.textContent = msg; t.classList.toggle('err', !!err); t.classList.add('on');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('on'), 2800);
}
function pct(p) { return p ? Math.round(((p.page + 1) / p.total) * 100) : 0; }
function relTime(ts) {
  if (!ts) return '';
  const s = (Date.now() - ts) / 1000;
  if (s < 60) return t('time.now');
  if (s < 3600) return t('time.min', { n: Math.floor(s / 60) });
  if (s < 86400) return t('time.hour', { n: Math.floor(s / 3600) });
  const d = Math.floor(s / 86400);
  return d === 1 ? t('time.yesterday') : t('time.days', { n: d });
}
function imgLoaded(img) { img.addEventListener('load', () => img.classList.add('ok')); img.addEventListener('error', () => img.classList.add('ok')); }

// ------------------------------------------------------------ dados
async function load(spin) {
  if (spin) { const b = $('#btnRefresh'); b.classList.remove('spin'); void b.offsetWidth; b.classList.add('spin'); }
  state.cfg = await api.getConfig();
  applyLook();
  state.sort = state.cfg.settings.librarySort || 'name';
  $('#sort').value = state.sort;
  state.data = await api.scanLibrary();
  if (state.series) state.series = state.data.items.find((i) => i.type === 'series' && i.path === state.series.path) || null;
  render();
}

function render() {
  const { cfg, data } = state;
  $('#rootPath').textContent = cfg.libraryRoot || t('lib.noRootClick');
  for (const it of data.items) if (it.isLinks) it.title = t('links.series');
  if (state.series && state.series.isLinks) state.series.title = t('links.series');
  const hasRoot = data.items.length > 0;
  const cont = data.continueReading || [];
  $('#empty').classList.toggle('hidden', hasRoot || cont.length > 0);
  $('#empty h2').textContent = cfg.libraryRoot && !data.items.length
    ? t(data.error ? 'empty.notFound' : 'empty.noVolumes') : t('empty.title');
  renderContinue(cont);
  renderGrid();
}

function renderContinue(list) {
  const sec = $('#continueSec');
  sec.classList.toggle('hidden', !list.length || !!state.series || !!state.query);
  const row = $('#continueRow');
  row.textContent = '';
  for (const v of list) {
    const c = el('div', 'cont');
    c.tabIndex = 0;
    c.innerHTML = `<img alt="" src="${esc(v.cover)}"><div class="info">
      <div class="series">${esc(v.series || t('card.loose'))}</div>
      <div class="title" title="${esc(v.title)}">${esc(v.title)}</div>
      <div class="meta">${esc(t('card.pageOf', { p: v.progress.page + 1, t: v.progress.total }))} · ${esc(relTime(v.progress.updated))}</div>
      <div class="bar"><i style="width:${pct(v.progress)}%"></i></div></div><div class="play">${PLAY}</div>`;
    c.addEventListener('click', () => open(v));
    c.addEventListener('keydown', (e) => { if (e.key === 'Enter') open(v); });
    c.addEventListener('contextmenu', (e) => showMenu(e, v));
    row.appendChild(c);
  }
}

function sortItems(items) {
  const by = state.sort;
  const prog = (it) => it.type === 'series'
    ? it.volumes.reduce((s, v) => s + (v.progress ? v.progress.page + 1 : 0), 0) / it.pages
    : (it.progress ? (it.progress.page + 1) / it.progress.total : 0);
  const recent = (it) => (it.type === 'series' ? it.lastRead : it.progress ? it.progress.updated : 0);
  const name = (a, b) => a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: 'base' });
  const arr = [...items];
  if (by === 'name') arr.sort(name);
  else if (by === 'recent') arr.sort((a, b) => recent(b) - recent(a) || name(a, b));
  else if (by === 'progress') arr.sort((a, b) => prog(b) - prog(a) || name(a, b));
  else if (by === 'pages') arr.sort((a, b) => b.pages - a.pages || name(a, b));
  return arr;
}

function renderGrid() {
  const { data } = state;
  const grid = $('#grid');
  grid.textContent = '';
  const sec = $('#gridSec');
  let items = state.series ? state.series.volumes : data.items;
  sec.classList.toggle('hidden', !items.length && !state.series);
  const q = state.query.trim().toLowerCase();
  if (q) {
    // a busca também procura dentro das séries
    const pool = state.series ? state.series.volumes : data.items.flatMap((i) => (i.type === 'series' ? [i, ...i.volumes] : [i]));
    items = pool.filter((i) => i.title.toLowerCase().includes(q) || (i.series || '').toLowerCase().includes(q));
  }
  items = state.series && state.sort === 'name' ? items : sortItems(items);

  const crumbs = $('#crumbs');
  crumbs.innerHTML = state.series
    ? `<a id="crumbHome">${esc(t('lib.title'))}</a><span class="crumb-sep">›</span><span class="cur"><bdi>${esc(state.series.title)}</bdi></span>`
    : `<span class="cur">${esc(t(q ? 'crumb.results' : 'crumb.all'))}</span>`;
  const home = $('#crumbHome');
  if (home) home.onclick = () => { state.series = null; render(); };
  $('#btnClearLinks2').classList.toggle('hidden', !(state.series && state.series.isLinks));
  $('#btnOpenDl2').classList.toggle('hidden', !(state.series && state.series.isLinks));
  const nVol = items.filter((i) => i.type === 'volume').length;
  const nSer = items.length - nVol;
  $('#count').textContent = [nSer ? t('count.series', { n: nSer }) : '', nVol ? t('count.volumes', { n: nVol }) : ''].filter(Boolean).join(' · ');
  $('#noResults').classList.toggle('hidden', items.length > 0);

  items.forEach((it, idx) => {
    const card = el('div', 'card' + (it.type === 'series' ? ' series' : ''));
    card.tabIndex = 0;
    card.style.animationDelay = Math.min(idx * 28, 500) + 'ms';
    card.dataset.path = it.path;
    let badge = '', bar = '', sub;
    if (it.type === 'series') {
      badge = `<span class="badge">${esc(t('card.vol', { n: it.volumes.length }))}</span>`;
      sub = esc(t('card.seriesSub', { v: it.volumes.length, p: it.pages }));
    } else {
      const p = it.progress;
      if (p && p.page >= p.total - 1) badge = `<span class="badge done">${esc(t('card.read'))}</span>`;
      else if (p) { badge = `<span class="badge">${pct(p)}%</span>`; bar = `<div class="bar"><i style="width:${pct(p)}%"></i></div>`; }
      sub = esc(t('card.pages', { n: it.pages })) + (q && it.series ? ` · ${esc(it.series)}` : '');
    }
    card.innerHTML = `<div class="cover"><img alt="" loading="lazy" src="${esc(it.cover)}">${badge}${bar}</div>
      <div class="t" title="${esc(it.title)}">${esc(it.title)}</div><div class="s">${sub}</div>`;
    imgLoaded(card.querySelector('img'));
    const act = () => (it.type === 'series' ? openSeries(it) : open(it));
    card.addEventListener('click', act);
    card.addEventListener('keydown', (e) => { if (e.key === 'Enter') act(); });
    card.addEventListener('contextmenu', (e) => showMenu(e, it));
    grid.appendChild(card);
  });
}

function openSeries(s) {
  state.series = s; state.query = ''; $('#search').value = '';
  render();
  $('#main').scrollTop = 0;
}

async function open(v, opts) {
  const r = await api.openReader(v.path, { series: v.series, ...(opts || {}) });
  if (!r.ok) toast(r.error, true);
}

// ------------------------------------------------------------ menu de contexto
function showMenu(e, it) {
  e.preventDefault();
  const m = $('#menu');
  m.textContent = '';
  const add = (label, fn) => { const b = el('button', '', label); b.onclick = () => { hideMenu(); fn(); }; m.appendChild(b); };
  if (it.type === 'series') {
    add('📚 ' + esc(t('menu.viewVolumes')), () => openSeries(it));
  } else {
    add('▶ ' + esc(t(it.progress ? 'menu.continue' : 'menu.read')), () => open(it));
    add('⏮ ' + esc(t('menu.fromStart')), () => open(it, { page: 0 }));
    if (it.progress) add('↺ ' + esc(t('menu.unread')), async () => { await api.clearProgress(it.path); load(); });
  }
  add('📂 ' + esc(t('menu.reveal')), () => api.revealFolder(it.path));
  if (it.downloaded) add('🗑 ' + esc(t('links.deleteOne')), () => deleteDownload(it));
  m.classList.remove('hidden');
  const r = m.getBoundingClientRect();
  m.style.left = Math.min(e.clientX, innerWidth - r.width - 8) + 'px';
  m.style.top = Math.min(e.clientY, innerHeight - r.height - 8) + 'px';
}
function hideMenu() { $('#menu').classList.add('hidden'); }
addEventListener('click', (e) => { if (!e.target.closest('#menu')) hideMenu(); });
addEventListener('blur', hideMenu);

// ------------------------------------------------------------ ações
async function chooseRoot() {
  const r = await api.chooseLibraryRoot();
  if (r) { state.series = null; await load(); toast(t('toast.libUpdated')); syncSettings(); }
}
async function openLoose() {
  const f = await api.chooseFolder();
  if (f) open({ path: f });
}
$('#btnChooseRoot').onclick = chooseRoot;
$('#rootChip').onclick = chooseRoot;
$('#btnOpenFolder').onclick = openLoose;
$('#btnOpenFolder2').onclick = openLoose;
$('#btnRefresh').onclick = () => load(true);
let searchTimer;
$('#search').addEventListener('input', (e) => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { state.query = e.target.value; render(); }, 120); });
$('#sort').addEventListener('change', (e) => { state.sort = e.target.value; api.setSettings({ librarySort: state.sort }); renderGrid(); });

addEventListener('keydown', (e) => {
  if (!$('#confirm').classList.contains('hidden')) { if (e.key === 'Escape') closeConfirm(false); return; }
  if (!$('#linkDlg').classList.contains('hidden')) { if (e.key === 'Escape') linkClose(); return; }
  if (e.ctrlKey && e.key.toLowerCase() === 'l') { e.preventDefault(); openLinkDlg(); return; }
  if (e.key === 'F5') { e.preventDefault(); load(true); }
  else if (e.ctrlKey && e.key.toLowerCase() === 'o') { e.preventDefault(); openLoose(); }
  else if (e.ctrlKey && e.key.toLowerCase() === 'f') { e.preventDefault(); $('#search').focus(); }
  else if (e.key === 'Escape') {
    if (!$('#settings').classList.contains('hidden')) closeSettings();
    else if (state.query) { $('#search').value = ''; state.query = ''; render(); }
    else if (state.series) { state.series = null; render(); }
  } else if (e.key === 'Backspace' && state.series && document.activeElement.tagName !== 'INPUT') { state.series = null; render(); }
});

// ------------------------------------------------------------ arrastar e soltar pasta
let dragDepth = 0;
addEventListener('dragenter', (e) => { e.preventDefault(); dragDepth++; $('#dropOverlay').classList.add('on'); });
addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; $('#dropOverlay').classList.remove('on'); } });
addEventListener('dragover', (e) => e.preventDefault());
addEventListener('drop', async (e) => {
  e.preventDefault(); dragDepth = 0; $('#dropOverlay').classList.remove('on');
  const f = e.dataTransfer.files[0];
  if (!f) return;
  const p = api.pathForFile(f);
  if (!p || !(await api.isDir(p))) return toast(t('toast.dropFolder'), true);
  const pages = await api.listPages(p);
  if (pages.length) open({ path: p });
  else { await api.setLibraryRoot(p); state.series = null; await load(); toast(t('toast.setAsLib')); }
});

// ------------------------------------------------------------ configurações
// ------------------------------------------------------------ aparência (tema, fundo do leitor, papel envelhecido)
const BACKDROPS = [
  { v: 'default', k: 'set.bd.default', cls: 'sw-default' },
  { v: 'transparent', k: 'set.bd.transparent', cls: 'sw-transparent', needsTransparent: true },
  { v: '#c210ef', k: 'set.bd.lilac' }, { v: '#5623ab', k: 'set.bd.purple' }, { v: '#4ffff0', k: 'set.bd.aqua' },
  { v: '#000000', k: 'set.bd.black' }, { v: '#2b2a30', k: 'set.bd.grey' }, { v: '#1a0f2e', k: 'set.bd.dpurple' },
  { v: '#0e1a30', k: 'set.bd.dblue' }, { v: '#2a1d14', k: 'set.bd.brown' }, { v: '#ece6f2', k: 'set.bd.light' },
];
function applyLook() {
  const s = state.cfg.settings;
  YTheme.set(s.theme);
  document.documentElement.style.setProperty('--sepia-filter', s.sepia ? YTheme.sepiaFilter(s.sepiaLevel) : 'none');
}
function renderLook() {
  const s = state.cfg.settings, canTrans = state.cfg.transparentActive;
  const cur = s.backdrop === 'transparent' && !canTrans ? 'default' : s.backdrop;
  for (const b of $('#setTheme').children) b.classList.toggle('on', b.dataset.v === s.theme);
  const box = $('#bdSwatches'); box.textContent = '';
  let name = '';
  for (const o of BACKDROPS) {
    if (o.needsTransparent && !canTrans) continue;
    const b = el('button', 'sw' + (o.cls ? ' ' + o.cls : '') + (o.v === cur ? ' on' : ''));
    b.type = 'button'; b.dataset.v = o.v; b.title = t(o.k); b.setAttribute('role', 'radio'); b.setAttribute('aria-label', t(o.k)); b.setAttribute('aria-checked', o.v === cur ? 'true' : 'false');
    if (o.v[0] === '#') b.style.setProperty('--c', o.v);
    if (o.v === cur) name = t(o.k);
    box.appendChild(b);
  }
  const isPreset = BACKDROPS.some((o) => o.v === cur);
  const ci = $('#setBdColor');
  ci.classList.toggle('on', !isPreset);
  if (!isPreset) { ci.value = cur; name = t('set.bd.custom') + ' ' + cur.toUpperCase(); }
  $('#bdName').textContent = name;
  $('#setSepia').checked = !!s.sepia;
  const lv = $('#setSepiaLevel'); lv.value = s.sepiaLevel; lv.disabled = !s.sepia; lv.style.setProperty('--fill', s.sepiaLevel + '%');
  $('#sepiaVal').textContent = s.sepiaLevel + '%';
}
$('#setTheme').onclick = (e) => { const v = e.target.dataset.v; if (v) patch({ theme: v }); };
$('#bdSwatches').onclick = (e) => { const b = e.target.closest('.sw'); if (b) patch({ backdrop: b.dataset.v }); };
let bdRaf = 0;
$('#setBdColor').oninput = (e) => { const v = e.target.value; cancelAnimationFrame(bdRaf); bdRaf = requestAnimationFrame(() => patch({ backdrop: v })); };
$('#setSepia').onchange = (e) => patch({ sepia: e.target.checked });
$('#setSepiaLevel').oninput = (e) => patch({ sepiaLevel: +e.target.value });

function syncSettings() {
  const s = state.cfg.settings;
  renderLook();
  $('#setRoot').textContent = state.cfg.libraryRoot || t('set.none');
  for (const b of $('#setDirection').children) b.classList.toggle('on', b.dataset.v === s.direction);
  for (const b of $('#setMode').children) b.classList.toggle('on', b.dataset.v === s.pageMode);
  $('#setSound').checked = !!s.sound;
  $('#setSpreads').checked = s.detectSpreads !== false;
  $('#setTransparent').checked = s.transparent !== false;
  $('#setGpu').checked = !!s.disableGpu;
  $('#gpuField').classList.toggle('hidden', state.cfg.platform !== 'linux');
}
async function patch(p) {
  const r = await api.setSettings(p);
  state.cfg.settings = r.settings;
  applyLook();
  syncSettings();
  if (r.needsRestart) $('#restartBar').classList.remove('hidden');
}
function openSettings(tab) { syncSettings(); refreshLinkCache(); showTab(tab || 'general'); $('#settings').classList.remove('hidden'); }
function showTab(tab) {
  for (const b of $('#setTabs').children) b.classList.toggle('on', b.dataset.tab === tab);
  $('#paneGeneral').classList.toggle('hidden', tab !== 'general');
  $('#paneLook').classList.toggle('hidden', tab !== 'look');
  $('#paneDonate').classList.toggle('hidden', tab !== 'donate');
}
$('#setTabs').onclick = (e) => { const b = e.target.closest('[data-tab]'); if (b) showTab(b.dataset.tab); };
document.querySelectorAll('[data-link]').forEach((b) => { b.onclick = () => api.openLink(b.dataset.link); });
function closeSettings() { $('#settings').classList.add('hidden'); }
$('#btnSettings').onclick = () => openSettings();
$('#settings').addEventListener('click', (e) => { if (e.target.id === 'settings' || e.target.closest('[data-close]')) closeSettings(); });
$('#setChangeRoot').onclick = chooseRoot;
$('#setDirection').onclick = (e) => { const v = e.target.dataset.v; if (v) patch({ direction: v }); };
$('#setMode').onclick = (e) => { const v = e.target.dataset.v; if (v) patch({ pageMode: v }); };
$('#setSound').onchange = (e) => patch({ sound: e.target.checked });
$('#setSpreads').onchange = (e) => patch({ detectSpreads: e.target.checked });
$('#setTransparent').onchange = (e) => patch({ transparent: e.target.checked });
$('#setGpu').onchange = (e) => patch({ disableGpu: e.target.checked });
$('#btnRestart').onclick = () => api.relaunch();

// ------------------------------------------------------------ idioma
function fillLangs() {
  const sel = $('#setLang');
  sel.textContent = '';
  const auto = el('option'); auto.value = ''; auto.textContent = t('set.langAuto'); sel.appendChild(auto);
  for (const l of I18N.languages) { const o = el('option'); o.value = l.code; o.textContent = l.name; sel.appendChild(o); }
  sel.value = I18N.auto ? '' : I18N.lang;
}
function applyI18n(p) {
  I18N.set(p); I18N.apply(); fillLangs();
  if (state.cfg) renderLook();
  document.title = 'Yomuchu — ' + t('lib.title');
  if (state.cfg && state.data) render();
  if (window.__linkRefreshI18n) window.__linkRefreshI18n();
}
$('#setLang').onchange = async (e) => applyI18n(await api.setLanguage(e.target.value || null));
api.onI18nChanged((p) => applyI18n(p));
api.onSystemTheme((dark) => YTheme.setSystem(dark));
api.onSettingsChanged((s) => { if (state.cfg) { state.cfg.settings = s; applyLook(); if (!$('#settings').classList.contains('hidden')) renderLook(); } });

// ------------------------------------------------------------ limpar histórico
let confirmResolve = null;
function askConfirm(txt) {
  const d = txt || { title: t('hist.confirmTitle'), text: t('hist.confirmText'), yes: t('hist.clear') };
  $('#confirmTitle').textContent = d.title; $('#confirmText').textContent = d.text; $('#confirmYes').textContent = d.yes;
  $('#confirmYes').classList.toggle('danger', d.danger !== false);
  $('#confirm').classList.remove('hidden'); $('#confirmNo').focus();
  return new Promise((r) => { confirmResolve = r; });
}
function closeConfirm(v) { $('#confirm').classList.add('hidden'); if (confirmResolve) { confirmResolve(v); confirmResolve = null; } }
$('#confirmYes').onclick = () => closeConfirm(true);
$('#confirmNo').onclick = () => closeConfirm(false);
$('#confirm').addEventListener('click', (e) => { if (e.target.id === 'confirm') closeConfirm(false); });
async function clearHistory() {
  if (!(await askConfirm())) return;
  await api.clearHistory();
  await load();
  toast(t('hist.cleared'));
}
$('#btnClearHistory').onclick = clearHistory;

// ------------------------------------------------------------ abrir link (baixar capítulo de uma URL)
const link = { busy: false, tab: 'single', mode: 'list' };
const fmtSize = (b) => (b >= 1048576 ? (b / 1048576).toFixed(b >= 10485760 ? 0 : 1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB');
function linkMsg(text, info, ok) { const m = $('#linkMsg'); m.textContent = text || ''; m.classList.toggle('hidden', !text); m.classList.toggle('info', !!info); m.classList.toggle('ok', !!ok); }
// depois de um download: lembra a pasta do capítulo (botão de pasta) e troca Cancelar por Fechar; "Baixar e abrir" nunca muda
function linkSetDone(folder) {
  if (folder) link.lastFolder = folder;
  $('#linkClose').textContent = t(folder ? 'common.close' : 'common.cancel');
  linkFolderBtn();
}
/** botão de pasta: abre a pasta do último capítulo baixado; sem nenhum, a pasta "Baixados de links" se existir; senão fica desativado */
async function linkFolderBtn() {
  let exists = false;
  try { exists = !!(await api.linkCacheInfo()).exists; } catch { /* */ }
  $('#linkOpenDir').disabled = !(link.lastFolder || exists);
}
const LINK_FIELDS = '#linkUrl, #batchList, #seqPattern, #seqInsert, #seqKind, #seqStart, #seqEnd, #seqStep, #seqPad, #batchName, #linkTabs button, #batchModes button';
function linkLock(b) { document.querySelectorAll(LINK_FIELDS).forEach((e) => { e.disabled = b; }); }
function linkSetBusy(b) {
  link.busy = b;
  linkLock(b);
  if (b) linkFails(null);
  $('#linkGo').classList.toggle('hidden', b); $('#linkClose').classList.toggle('hidden', b); $('#linkAbort').classList.toggle('hidden', !b);
  $('#linkProg').classList.toggle('hidden', !b);
  if (b) linkMsg('');
}
function linkProgress(p) {
  const bar = $('#linkBar');
  const known = p.pct != null;
  bar.classList.toggle('indet', !known);
  const v = known ? Math.max(0, Math.min(100, Math.round(p.pct))) : 0;
  bar.firstElementChild.style.width = known ? v + '%' : '';
  bar.setAttribute('aria-valuenow', String(v));
  $('#linkPct').textContent = known ? v + '%' : '';
  $('#linkStatus').textContent = p.phase === 'batch' ? t(p.failed ? 'link.p.batchFail' : 'link.p.batch', { done: p.done, total: p.total, failed: p.failed || 0 }) : t('link.p.' + p.phase, { done: p.done, total: p.total });
  bar.dataset.phase = p.phase;
}
function openLinkDlg() {
  if (link.busy) return;
  linkMsg(''); linkFails(null); $('#linkProg').classList.add('hidden'); linkSetDone(null);
  $('#linkDlg').classList.remove('hidden');
  linkFocus();
}
function linkFocus() {
  if (link.tab === 'single') { $('#linkUrl').focus(); $('#linkUrl').select(); }
  else if (link.mode === 'list') $('#batchList').focus();
  else $('#seqPattern').focus();
}
function linkClose() {
  if (link.busy) return;
  $('#linkDlg').classList.add('hidden');
}
async function startLink() {
  if (link.busy) return;
  if (link.tab === 'batch') return startBatch();
  const url = $('#linkUrl').value.trim();
  if (!/^https?:\/\/\S+$/i.test(url)) { linkMsg(t('link.e.badUrl')); $('#linkUrl').focus(); return; }
  linkSetDone(null); linkSetBusy(true); linkProgress({ phase: 'page', done: 0, total: 0, pct: 2 });
  const r = await api.startLink(url, { confirmDup: true });
  linkSetBusy(false);
  if (r.ok) {
    const doneText = r.failed ? t('link.doneSkip', { n: r.pages, f: r.failed }) : t('link.done', { n: r.pages });
    // o diálogo continua aberto no estado "concluído" (com o botão Abrir pasta) enquanto o leitor abre
    linkMsg('✔ ' + doneText, false, true); linkSetDone(r.folder);
    toast(doneText);
    await load();
    open({ path: r.folder, series: t('links.series') });
  } else if (r.code === 'cancelled') linkMsg(t('link.e.cancelled'), true);
  else linkMsg(t('link.e.' + (['badUrl', 'noPages', 'blocked', 'http', 'network', 'tooBig', 'busy'].includes(r.code) ? r.code : 'other'), { detail: r.detail || '' }));
}
// ---- Download em lote
function batchSpec() {
  if (link.mode === 'list') return { mode: 'list', text: $('#batchList').value, name: $('#batchName').value.trim() };
  return { mode: 'seq', pattern: $('#seqPattern').value.trim(), kind: $('#seqKind').value, start: $('#seqStart').value.trim(), end: $('#seqEnd').value.trim(), step: $('#seqStep').value, pad: $('#seqPad').value, name: $('#batchName').value.trim() };
}
const escH = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
/** atualiza a pré-visualização ao vivo e devolve o resultado da conferência */
function batchPreview() {
  const spec = batchSpec();
  const r = YSeq.resolveSpec(spec);
  const box = link.mode === 'list' ? $('#batchListInfo') : $('#seqInfo');
  const err = (key, vars) => { box.classList.add('err'); box.textContent = t(key, vars); };
  box.classList.remove('err');
  if (link.mode === 'list') {
    const p = YSeq.parseList(spec.text);
    if (!spec.text.trim()) { box.textContent = t('link.batch.listCount', { n: 0 }); return r; }
    if (p.invalid.length) { err('link.batch.e.badUrl', { detail: p.invalid[0].slice(0, 80) }); return r; }
    box.innerHTML = '<b>' + escH(t(p.dup ? 'link.batch.listDup' : 'link.batch.listCount', { n: p.urls.length, d: p.dup })) + '</b>' + (p.urls.length > YSeq.BATCH.maxLinks ? '<br>' + escH(t('link.batch.e.tooMany', { n: p.urls.length, max: YSeq.BATCH.maxLinks })) : '');
    if (p.urls.length > YSeq.BATCH.maxLinks) box.classList.add('err');
    return r;
  }
  if (!r.ok) {
    if (r.error === 'tooMany') err('link.batch.e.tooMany', { n: r.count, max: YSeq.BATCH.maxLinks });
    else if (r.error === 'badUrl') err('link.batch.e.badUrl', { detail: r.detail || '' });
    else err('link.batch.e.' + r.error);
    return r;
  }
  box.innerHTML = '<b>' + escH(t('link.batch.pvCount', { n: r.count })) + '</b><br>' + escH(t('link.batch.pvFirst')) + ' <code>' + escH(r.first) + '</code><br>' + escH(t('link.batch.pvLast')) + ' <code>' + escH(r.last) + '</code>'
    + (spec.kind === 'num' && r.width ? '<br>' + escH(t('link.batch.pvPad', { w: r.width })) : '');
  return r;
}
function linkFails(list, dupes) {
  const box = $('#linkFails');
  if (!list || !list.length) { box.classList.add('hidden'); $('#linkFailsList').textContent = ''; return; }
  $('#linkFailsTitle').textContent = t('link.batch.failTitle', { n: list.length });
  const ul = $('#linkFailsList'); ul.textContent = '';
  const known = ['http', 'blocked', 'noImage', 'network'];
  for (const f of list.slice(0, 50)) {
    const li = document.createElement('li');
    li.textContent = `#${f.n} ${f.url} — ` + t('link.batch.r.' + (known.includes(f.code) ? f.code : 'other'), { detail: f.detail || '' });
    ul.appendChild(li);
  }
  box.classList.remove('hidden');
}
function setLinkTab(tab) {
  link.tab = tab;
  const batch = tab === 'batch';
  $('#linkPanelSingle').classList.toggle('hidden', batch); $('#linkPanelBatch').classList.toggle('hidden', !batch);
  for (const b of document.querySelectorAll('#linkTabs button')) { const on = b.dataset.v === tab; b.classList.toggle('on', on); b.setAttribute('aria-selected', on); }
  const go = $('#linkGo'); go.dataset.i18n = batch ? 'link.batch.start' : 'link.start'; go.textContent = t(go.dataset.i18n);
  linkMsg(''); linkFails(null);
  if (batch) batchPreview();
  linkFocus();
}
function setBatchMode(mode) {
  link.mode = mode;
  $('#batchPanelList').classList.toggle('hidden', mode !== 'list'); $('#batchPanelSeq').classList.toggle('hidden', mode !== 'seq');
  for (const b of document.querySelectorAll('#batchModes button')) b.classList.toggle('on', b.dataset.v === mode);
  linkMsg('');
  batchPreview(); linkFocus();
}
function seqKindChanged() {
  const alpha = $('#seqKind').value === 'alpha';
  $('#seqPadWrap').classList.toggle('hidden', alpha);
  $('#seqPadWrap').parentElement.classList.toggle('alpha', alpha);
  const a = $('#seqStart'), b = $('#seqEnd');
  // troca os valores padrão ao mudar de tipo (só se ainda estão no valor padrão do outro tipo)
  if (alpha && /^\d*$/.test(a.value) && /^\d*$/.test(b.value)) { a.value = 'a'; b.value = 'z'; }
  if (!alpha && /^[a-zA-Z]*$/.test(a.value) && /^[a-zA-Z]*$/.test(b.value)) { a.value = '1'; b.value = '10'; }
  batchPreview();
}
async function startBatch() {
  const spec = batchSpec();
  const r0 = batchPreview();
  if (!r0.ok) {
    if (r0.error === 'empty') linkMsg(t('link.batch.e.empty'));
    else if (r0.error === 'tooMany') linkMsg(t('link.batch.e.tooMany', { n: r0.count, max: YSeq.BATCH.maxLinks }));
    else if (r0.error === 'badUrl') linkMsg(t('link.batch.e.badUrl', { detail: r0.detail || '' }));
    else linkMsg(t('link.batch.e.' + r0.error));
    return;
  }
  if (r0.count > YSeq.BATCH.confirmAbove && !(await askConfirm({ title: t('link.batch.confirmTitle'), text: t('link.batch.confirmText', { n: r0.count }), yes: t('link.batch.confirmYes'), danger: false }))) return;
  linkSetDone(null); linkSetBusy(true); linkProgress({ phase: 'batch', done: 0, total: r0.count, failed: 0, pct: 2 });
  const r = await api.startBatch(spec, { confirmDup: true });
  linkSetBusy(false);
  if (r.ok) {
    let doneText = r.failed ? t('link.doneSkip', { n: r.pages, f: r.failed }) : t('link.done', { n: r.pages });
    if (r.dupes) doneText += ' · ' + t('link.batch.dupes', { d: r.dupes });
    linkMsg('✔ ' + doneText, false, true); linkFails(r.failures); linkSetDone(r.folder);
    toast(doneText);
    await load();
    open({ path: r.folder, series: t('links.series') });
  } else if (r.code === 'cancelled') linkMsg(t('link.e.cancelled'), true);
  else if (r.code === 'noPages') linkMsg(t('link.batch.e.noPages', { detail: r.detail || '' }));
  else if (r.code === 'empty') linkMsg(t('link.batch.e.empty'));
  else if (r.code === 'tooMany') linkMsg(t('link.batch.e.tooMany', { n: String(r.detail || '').split(' / ')[0], max: YSeq.BATCH.maxLinks }));
  else if (r.code === 'badSpec') linkMsg(t('link.batch.e.badRange'));
  else linkMsg(t('link.e.' + (['badUrl', 'blocked', 'http', 'network', 'tooBig', 'busy'].includes(r.code) ? r.code : 'other'), { detail: r.detail || '' }));
}
for (const b of document.querySelectorAll('#linkTabs button')) b.onclick = () => { if (!link.busy) setLinkTab(b.dataset.v); };
for (const b of document.querySelectorAll('#batchModes button')) b.onclick = () => { if (!link.busy) setBatchMode(b.dataset.v); };
for (const id of ['#batchList', '#seqPattern', '#seqStart', '#seqEnd', '#seqStep', '#seqPad']) $(id).addEventListener('input', batchPreview);
$('#seqPad').addEventListener('change', batchPreview);
$('#seqKind').addEventListener('change', seqKindChanged);
$('#seqInsert').onclick = () => {
  const el = $('#seqPattern'); const a = el.selectionStart ?? el.value.length, b = el.selectionEnd ?? a;
  el.value = el.value.slice(0, a) + '{n}' + el.value.slice(b); el.focus(); el.setSelectionRange(a + 3, a + 3); batchPreview();
};
$('#seqPattern').addEventListener('keydown', (e) => { if (e.key === 'Enter') startLink(); });
async function openDlDir(folder) {
  let r = await api.openDownloadsDir(folder);
  if ((!r || !r.ok) && folder) r = await api.openDownloadsDir(); // a pasta do capítulo sumiu: abre "baixados"
  if (!r || !r.ok) toast(t('link.e.other', { detail: (r && r.error) || '' }), true);
}
$('#linkOpenDir').onclick = () => openDlDir(link.lastFolder);
$('#btnOpenDl').onclick = () => openDlDir();
$('#btnOpenDl2').onclick = () => openDlDir();
$('#btnOpenLink').onclick = openLinkDlg;
$('#linkGo').onclick = startLink;
$('#linkUrl').addEventListener('keydown', (e) => { if (e.key === 'Enter') startLink(); });
$('#linkAbort').onclick = () => api.cancelLink();
$('#linkClose').onclick = linkClose;
$('#linkX').onclick = () => { if (link.busy) api.cancelLink(); else linkClose(); };
api.onLinkProgress((p) => { if (link.busy) linkProgress(p); });
// já existe um capítulo com esse nome: avisa e só baixa uma cópia ("Nome (1)") se o usuário confirmar
api.onLinkDuplicate(async ({ title }) => {
  const yes = await askConfirm({ title: t('link.dup.title'), text: t('link.dup.text', { name: title }), yes: t('link.dup.yes'), danger: false });
  api.answerDuplicate(yes);
});
// ao trocar o idioma com o diálogo aberto, refaz a pré-visualização
window.__linkRefreshI18n = () => { if (link.tab === 'batch') batchPreview(); };

async function refreshLinkCache() {
  const i = await api.linkCacheInfo();
  $('#linkCacheInfo').textContent = i.count ? t('links.cacheInfo', { n: i.count, size: fmtSize(i.bytes) }) : t('links.cacheEmpty');
  $('#btnClearLinks').disabled = !i.count;
}
async function clearDownloads() {
  if (!(await askConfirm({ title: t('links.confirmTitle'), text: t('links.confirmText'), yes: t('links.clear') }))) return;
  await api.clearDownloads();
  link.lastFolder = null;
  state.series = null;
  await load(); refreshLinkCache();
  toast(t('links.cleared'));
}
async function deleteDownload(it) {
  if (!(await askConfirm({ title: t('links.confirmOneTitle'), text: it.title, yes: t('links.deleteOne') }))) return;
  await api.deleteDownload(it.path);
  if (link.lastFolder === it.path) link.lastFolder = null;
  await load(); refreshLinkCache();
  toast(t('links.cleared'));
}
$('#btnClearLinks').onclick = clearDownloads;
$('#btnClearLinks2').onclick = clearDownloads;

// ------------------------------------------------------------ eventos do processo principal
api.onLibraryRefresh(() => load());
let progTimer;
api.onLibraryProgress(() => { clearTimeout(progTimer); progTimer = setTimeout(() => load(), 800); });
api.onSettingsChanged((s) => { if (state.cfg) { state.cfg.settings = s; syncSettings(); } });

(async () => {
  applyI18n(await api.getI18n());
  await load();
  $('#appVersion').textContent = 'v' + state.cfg.version;
})();
