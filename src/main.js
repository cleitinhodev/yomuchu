'use strict';
/*
 * Yomuchu — processo principal (Electron)
 * - Janela "Biblioteca" (normal) + janela "Leitor" (sem bordas, fundo transparente)
 * - Imagens locais servidas pelo protocolo seguro manga://
 * - Configurações, progresso e posição das janelas em userData/config.json
 */
const { app, BrowserWindow, ipcMain, dialog, protocol, net, nativeImage, screen, shell, Menu, nativeTheme } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const crypto = require('crypto');
const { pathToFileURL } = require('url');

// ---------------------------------------------------------------- caminhos
if (process.env.MANGA_READER_USERDATA) app.setPath('userData', path.resolve(process.env.MANGA_READER_USERDATA));
const USER_DATA = app.getPath('userData');
const CONFIG_FILE = path.join(USER_DATA, 'config.json');
const THUMB_DIR = path.join(USER_DATA, 'miniaturas');
const LOCALES_DIR = path.join(__dirname, 'locales');
const DL_DIR = path.join(USER_DATA, 'baixados'); // capítulos baixados de links ("Abrir link")
const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
const naturalCompare = (a, b) => collator.compare(a, b);

// ---------------------------------------------------------------- configuração
const DEFAULT_CONFIG = {
  version: 1,
  libraryRoot: null,
  settings: {
    direction: 'rtl',        // 'rtl' (mangá) | 'ltr'
    pageMode: 'double',      // 'double' | 'single'
    sound: true,
    transparent: true,       // fundo transparente no leitor
    disableGpu: false,       // ajuda a transparência em alguns Linux
    librarySort: 'name',
    flipSpeed: 1,
    language: null,          // null = idioma do sistema
    detectSpreads: true,     // páginas deitadas (largura > altura) ocupam o livro aberto inteiro
    theme: 'dark',           // 'dark' (padrão) | 'light' | 'system'
    backdrop: 'default',     // fundo atrás do livro: 'default' | 'transparent' | '#rrggbb'
    sepia: false,            // papel envelhecido
    sepiaLevel: 50,          // intensidade 0–100
  },
  progress: {},              // { [pastaAbsoluta]: { page, total, updated, title } }
  bounds: {},                // { library: {...}, reader: {...} }
  recentFolders: [],
};

function loadConfig() {
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    return { ...DEFAULT_CONFIG, ...raw, settings: { ...DEFAULT_CONFIG.settings, ...(raw.settings || {}) },
      progress: raw.progress || {}, bounds: raw.bounds || {}, recentFolders: raw.recentFolders || [] };
  } catch {
    return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  }
}
let config = loadConfig();
// valida as configurações de aparência (o renderer não é confiável): valores inválidos voltam ao padrão
const THEMES = ['dark', 'light', 'system'];
function sanitizeLook(st) {
  if (!THEMES.includes(st.theme)) st.theme = 'dark';
  if (!(st.backdrop === 'default' || st.backdrop === 'transparent' || (typeof st.backdrop === 'string' && /^#[0-9a-f]{6}$/i.test(st.backdrop)))) st.backdrop = 'default';
  else if (st.backdrop[0] === '#') st.backdrop = st.backdrop.toLowerCase();
  st.sepia = st.sepia === true;
  const lv = Number(st.sepiaLevel);
  st.sepiaLevel = Number.isFinite(lv) ? Math.round(Math.min(100, Math.max(0, lv))) : 50;
  return st;
}
sanitizeLook(config.settings);
function applyNativeTheme() { nativeTheme.themeSource = config.settings.theme; }
applyNativeTheme();
const themeQuery = () => ({ theme: config.settings.theme, sys: nativeTheme.shouldUseDarkColors ? 'dark' : 'light' });
function pushSystemTheme() { for (const w of [libraryWin, readerWin]) if (w && !w.isDestroyed()) w.webContents.send('theme:system', nativeTheme.shouldUseDarkColors); }
nativeTheme.on('updated', pushSystemTheme);
const themeBg = () => (config.settings.theme === 'light' || (config.settings.theme === 'system' && !nativeTheme.shouldUseDarkColors) ? '#f5f0fb' : '#0f0a18');
let saveTimer = null;
function saveConfigSoon(delay = 300) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveConfigNow, delay);
}
function saveConfigNow() {
  clearTimeout(saveTimer); saveTimer = null;
  try {
    fs.mkdirSync(USER_DATA, { recursive: true });
    const tmp = CONFIG_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(config, null, 2));
    fs.renameSync(tmp, CONFIG_FILE);
  } catch (e) { console.error('Falha ao salvar configuração:', e); }
}

// ---------------------------------------------------------------- flags de linha de comando
const argv = process.argv.slice(1);
const hasFlag = (...names) => names.some((n) => argv.includes(n));
const forceOpaque = hasFlag('--sem-transparencia', '--no-transparency');
const useTransparency = !forceOpaque && config.settings.transparent !== false;
if (hasFlag('--disable-gpu') || config.settings.disableGpu) app.disableHardwareAcceleration();
if (process.platform === 'linux' && useTransparency) {
  // necessário para visuais ARGB no X11 (requer um compositor: picom, KWin, Mutter...)
  app.commandLine.appendSwitch('enable-transparent-visuals');
}
// pasta passada na linha de comando: yomuchu /caminho/da/pasta
const cliFolder = argv.find((a) => !a.startsWith('-') && a !== '.' && safeIsDir(a));
function safeIsDir(p) { try { return fs.statSync(p).isDirectory(); } catch { return false; } }

// ---------------------------------------------------------------- protocolo manga://
protocol.registerSchemesAsPrivileged([
  { scheme: 'manga', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } },
]);

// Só servimos imagens que estão dentro de pastas que o usuário escolheu.
const allowedRoots = new Set();
function allowRoot(p) { if (p) allowedRoots.add(path.resolve(p)); }
function isAllowed(p) {
  const abs = path.resolve(p);
  if (!IMAGE_EXT.has(path.extname(abs).toLowerCase())) return false;
  for (const r of allowedRoots) {
    if (abs === r || abs.startsWith(r.endsWith(path.sep) ? r : r + path.sep)) return true;
  }
  return false;
}
const toMangaUrl = (kind, p) => `manga://${kind}/?p=${encodeURIComponent(p)}`;

async function thumbnailFor(file) {
  const st = await fsp.stat(file);
  const key = crypto.createHash('sha1').update(`${file}|${st.size}|${st.mtimeMs}`).digest('hex');
  const out = path.join(THUMB_DIR, key + '.jpg');
  if (fs.existsSync(out)) return out;
  const img = nativeImage.createFromPath(file);
  if (img.isEmpty()) return null; // formato não suportado pelo nativeImage (ex.: webp) -> usa original
  const { width, height } = img.getSize();
  const targetW = Math.min(420, width);
  const resized = img.resize({ width: targetW, height: Math.round(height * targetW / width), quality: 'good' });
  await fsp.mkdir(THUMB_DIR, { recursive: true });
  await fsp.writeFile(out, resized.toJPEG(84));
  return out;
}

function registerProtocol() {
  protocol.handle('manga', async (request) => {
    try {
      const u = new URL(request.url);
      const p = u.searchParams.get('p');
      if (!p || !isAllowed(p)) return new Response('Proibido', { status: 403 });
      let file = p;
      if (u.hostname === 'thumb') {
        try { file = (await thumbnailFor(p)) || p; } catch { file = p; }
      }
      const res = await net.fetch(pathToFileURL(file).toString());
      const headers = new Headers(res.headers);
      headers.set('Cache-Control', 'max-age=31536000, immutable');
      return new Response(res.body, { status: res.status, headers });
    } catch (e) {
      return new Response('Erro: ' + e.message, { status: 500 });
    }
  });
}

// ---------------------------------------------------------------- dimensões das imagens (só o cabeçalho)
/** lê largura/altura de JPEG, PNG ou WebP sem decodificar a imagem; null se não reconhecer */
async function imageSize(file) {
  let fh;
  try {
    fh = await fsp.open(file, 'r');
    const buf = Buffer.alloc(256 * 1024);
    const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
    return parseImageSize(buf.subarray(0, bytesRead));
  } catch { return null; } finally { if (fh) await fh.close().catch(() => {}); }
}
const linkfetch = require('./linkfetch');
const { parseImageSize } = linkfetch;

// ---------------------------------------------------------------- leitura de pastas
async function listImages(dir) {
  let entries;
  try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return []; }
  return entries
    .filter((e) => e.isFile() && IMAGE_EXT.has(path.extname(e.name).toLowerCase()) && !e.name.startsWith('.'))
    .map((e) => e.name)
    .sort(naturalCompare)
    .map((n) => path.join(dir, n));
}
async function listSubdirs(dir) {
  let entries;
  try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return []; }
  return entries.filter((e) => e.isDirectory() && !e.name.startsWith('.')).map((e) => e.name).sort(naturalCompare)
    .map((n) => path.join(dir, n));
}

async function volumeInfo(dir, images, series) {
  const prog = config.progress[dir];
  return {
    type: 'volume',
    path: dir,
    title: path.basename(dir),
    series: series || null,
    pages: images.length,
    cover: toMangaUrl('thumb', images[0]),
    progress: prog ? { page: prog.page, total: prog.total || images.length, updated: prog.updated } : null,
  };
}

/** Varre a raiz da biblioteca: subpastas com imagens = volumes; subpastas só com pastas = séries. */
async function scanLibrary(root) {
  if (!root || !safeIsDir(root)) return { root, items: [], error: root ? 'notfound' : null };
  allowRoot(root);
  const items = [];
  const rootImages = await listImages(root);
  if (rootImages.length) items.push(await volumeInfo(root, rootImages, null));
  for (const sub of await listSubdirs(root)) {
    const imgs = await listImages(sub);
    if (imgs.length) { items.push(await volumeInfo(sub, imgs, null)); continue; }
    // série: procura volumes (até 2 níveis abaixo)
    const volumes = [];
    const walk = async (d, depth, prefix) => {
      for (const v of await listSubdirs(d)) {
        const vi = await listImages(v);
        if (vi.length) {
          const info = await volumeInfo(v, vi, path.basename(sub));
          if (prefix) info.title = prefix + ' › ' + info.title;
          volumes.push(info);
        } else if (depth < 2) await walk(v, depth + 1, (prefix ? prefix + ' › ' : '') + path.basename(v));
      }
    };
    await walk(sub, 1, '');
    if (volumes.length) {
      const read = volumes.filter((v) => v.progress).sort((a, b) => b.progress.updated - a.progress.updated);
      items.push({
        type: 'series', path: sub, title: path.basename(sub), volumes,
        cover: volumes[0].cover, pages: volumes.reduce((s, v) => s + v.pages, 0),
        lastRead: read[0] ? read[0].progress.updated : 0,
      });
    }
  }
  return { root, items };
}

/** série especial "Baixados de links": cada capítulo baixado vira um volume */
async function scanDownloads() {
  if (!safeIsDir(DL_DIR)) return null;
  allowRoot(DL_DIR);
  const volumes = [];
  for (const sub of await listSubdirs(DL_DIR)) {
    if (path.basename(sub).startsWith('.')) continue;
    const imgs = await listImages(sub);
    if (!imgs.length) continue;
    const info = await volumeInfo(sub, imgs, t('links.series'));
    info.downloaded = true;
    try { info.sourceUrl = JSON.parse(await fsp.readFile(path.join(sub, '.yomuchu-link.json'), 'utf8')).url; } catch { /* sem metadados */ }
    volumes.push(info);
  }
  if (!volumes.length) return null;
  const read = volumes.filter((v) => v.progress).sort((a, b) => b.progress.updated - a.progress.updated);
  return { type: 'series', isLinks: true, path: DL_DIR, title: t('links.series'), volumes, cover: volumes[0].cover,
    pages: volumes.reduce((n, v) => n + v.pages, 0), lastRead: read[0] ? read[0].progress.updated : 0 };
}
const underDl = (p) => { const r = path.resolve(p), d = path.resolve(DL_DIR); return r !== d && r.startsWith(d + path.sep); };
async function dirSize(dir) {
  let total = 0;
  for (const e of await fsp.readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) total += await dirSize(f); else total += (await fsp.stat(f).catch(() => ({ size: 0 }))).size;
  }
  return total;
}

// ---------------------------------------------------------------- janelas
let libraryWin = null;
let readerWin = null;
let readerFolder = null;

function boundsOk(b) {
  if (!b || !b.width || !b.height) return false;
  return screen.getAllDisplays().some((d) => {
    const a = d.workArea;
    return b.x < a.x + a.width - 80 && b.x + b.width > a.x + 80 && b.y < a.y + a.height - 80 && b.y + b.height > a.y;
  });
}
function trackBounds(win, key) {
  const save = () => {
    if (win.isDestroyed() || win.isFullScreen() || win.isMinimized()) return;
    config.bounds[key] = { ...win.getBounds(), maximized: win.isMaximized() };
    saveConfigSoon(600);
  };
  win.on('resize', save); win.on('move', save);
}

const ICON = path.join(__dirname, '..', 'build', process.platform === 'win32' ? 'icon.ico' : 'icon.png');

// ---------------------------------------------------------------- idiomas
const LANGS = fs.readdirSync(LOCALES_DIR).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5));
const langCache = {};
function readLang(code) {
  if (!langCache[code]) { try { langCache[code] = JSON.parse(fs.readFileSync(path.join(LOCALES_DIR, code + '.json'), 'utf8')); } catch { langCache[code] = {}; } }
  return langCache[code];
}
/** 'pt-BR' -> 'pt-BR'; 'pt-PT' -> 'pt-BR'; 'zh-TW' -> 'zh-CN'; 'en-GB' -> 'en'; desconhecido -> null */
function matchLang(tag) {
  if (!tag) return null;
  const t = String(tag).replace('_', '-').toLowerCase();
  const exact = LANGS.find((l) => l.toLowerCase() === t);
  if (exact) return exact;
  const base = t.split('-')[0];
  return LANGS.find((l) => l.toLowerCase() === base) || LANGS.find((l) => l.toLowerCase().split('-')[0] === base) || null;
}
function systemLang() {
  let prefs = [];
  try { prefs = app.getPreferredSystemLanguages(); } catch {}
  for (const tag of [process.env.YOMUCHU_LANG, ...prefs, app.getLocale()]) { const m = matchLang(tag); if (m) return m; }
  return 'en';
}
function currentLang() { return (config.settings.language && LANGS.includes(config.settings.language)) ? config.settings.language : systemLang(); }
function t(key, vars) {
  let s = readLang(currentLang())[key];
  if (s == null) s = readLang('en')[key];
  if (s == null) s = key;
  return vars ? s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m)) : s;
}
function i18nPayload() {
  const lang = currentLang();
  const langs = LANGS.map((code) => ({ code, name: readLang(code)['lang.name'] || code })).sort((a, b) => a.code.localeCompare(b.code));
  return { lang, dir: readLang(lang)['lang.dir'] === 'rtl' ? 'rtl' : 'ltr', strings: readLang(lang), fallback: readLang('en'), languages: langs, auto: !config.settings.language };
}

function createLibraryWindow() {
  const b = config.bounds.library;
  const useB = boundsOk(b);
  libraryWin = new BrowserWindow({
    width: useB ? b.width : 1200, height: useB ? b.height : 800,
    x: useB ? b.x : undefined, y: useB ? b.y : undefined,
    minWidth: 720, minHeight: 500,
    backgroundColor: themeBg(),
    title: 'Yomuchu — ' + t('lib.title'),
    icon: ICON,
    show: false,
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  if (useB && b.maximized) libraryWin.maximize();
  trackBounds(libraryWin, 'library');
  libraryWin.loadFile(path.join(__dirname, 'library', 'library.html'), { query: themeQuery() });
  libraryWin.once('ready-to-show', () => libraryWin.show());
  libraryWin.on('closed', () => {
    libraryWin = null;
    if (!readerWin) app.quit();
  });
  hardenContents(libraryWin.webContents);
}

function createReaderWindow() {
  const b = config.bounds.reader;
  const useB = boundsOk(b);
  const wa = screen.getPrimaryDisplay().workArea;
  const h = Math.round(wa.height * 0.9);
  const w = Math.min(wa.width - 40, Math.round(h * 1.42));
  readerWin = new BrowserWindow({
    width: useB ? b.width : w, height: useB ? b.height : h,
    x: useB ? b.x : undefined, y: useB ? b.y : undefined,
    minWidth: 420, minHeight: 320,
    frame: false,
    transparent: useTransparency,
    hasShadow: false,
    backgroundColor: useTransparency ? '#00000000' : themeBg(),
    resizable: true,
    title: 'Yomuchu',
    icon: ICON,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true,
    },
  });
  trackBounds(readerWin, 'reader');
  readerWin.loadFile(path.join(__dirname, 'reader', 'reader.html'), { query: themeQuery() });
  readerWin.once('ready-to-show', () => readerWin.show());
  readerWin.on('enter-full-screen', () => readerWin.webContents.send('reader:fullscreen', true));
  readerWin.on('leave-full-screen', () => readerWin.webContents.send('reader:fullscreen', false));
  readerWin.on('closed', () => {
    readerWin = null; readerFolder = null;
    if (libraryWin) { libraryWin.webContents.send('library:refresh'); if (libraryWin.isMinimized()) libraryWin.restore(); libraryWin.show(); libraryWin.focus(); }
    else app.quit();
  });
  hardenContents(readerWin.webContents);
  return readerWin;
}

function hardenContents(wc) {
  wc.setWindowOpenHandler(() => ({ action: 'deny' }));
  wc.on('will-navigate', (e, url) => { if (!url.startsWith('file://')) e.preventDefault(); });
}

async function openReader(folder, opts = {}) {
  folder = path.resolve(folder);
  const images = await listImages(folder);
  if (!images.length) return { ok: false, error: t('err.noImages') };
  allowRoot(folder);
  readerFolder = folder;
  // pastas avulsas recentes
  if (!underDl(folder) && (!config.libraryRoot || !folder.startsWith(path.resolve(config.libraryRoot) + path.sep))) {
    config.recentFolders = [folder, ...config.recentFolders.filter((f) => f !== folder)].slice(0, 12);
    saveConfigSoon();
  }
  const payload = {
    folder,
    title: path.basename(folder),
    series: underDl(folder) ? t('links.series') : opts.series || (config.libraryRoot && path.resolve(path.dirname(folder)) === path.resolve(config.libraryRoot) ? '' : path.basename(path.dirname(folder))),
    pages: await Promise.all(images.map(async (p) => { const sz = await imageSize(p); return { name: path.basename(p), url: toMangaUrl('page', p), w: sz ? sz.w : 0, h: sz ? sz.h : 0 }; })),
    startPage: opts.page != null ? opts.page : (config.progress[folder] ? config.progress[folder].page : 0),
    settings: config.settings,
    transparent: useTransparency,
  };
  // o livro fica sozinho na área de trabalho: a biblioteca vai para a barra de tarefas
  if (libraryWin && !libraryWin.isMinimized() && !opts.keepLibrary) libraryWin.minimize();
  if (!readerWin) {
    createReaderWindow();
    readerWin.webContents.once('did-finish-load', () => readerWin && readerWin.webContents.send('reader:load', payload));
  } else {
    readerWin.webContents.send('reader:load', payload);
    readerWin.show(); readerWin.focus();
  }
  return { ok: true, pages: images.length };
}

// ---------------------------------------------------------------- IPC
function senderWin(e) { return BrowserWindow.fromWebContents(e.sender); }

ipcMain.handle('config:get', () => ({
  libraryRoot: config.libraryRoot, settings: config.settings, recentFolders: config.recentFolders,
  transparentActive: useTransparency, platform: process.platform, version: app.getVersion(),
}));
ipcMain.handle('settings:set', (e, patch) => {
  const before = { ...config.settings };
  config.settings = sanitizeLook({ ...config.settings, ...patch });
  if ('theme' in patch) { applyNativeTheme(); pushSystemTheme(); }
  saveConfigSoon();
  const needsRestart = ['transparent', 'disableGpu'].some((k) => k in patch && patch[k] !== before[k]);
  for (const w of [libraryWin, readerWin]) if (w && w.webContents !== e.sender) w.webContents.send('settings:changed', config.settings);
  return { settings: config.settings, needsRestart };
});
ipcMain.handle('i18n:get', () => i18nPayload());
ipcMain.handle('i18n:set', (e, code) => {
  config.settings.language = code && LANGS.includes(code) ? code : null;
  saveConfigSoon();
  const p = i18nPayload();
  if (libraryWin) libraryWin.setTitle('Yomuchu — ' + t('lib.title'));
  for (const w of [libraryWin, readerWin]) if (w) w.webContents.send('i18n:changed', p);
  return p;
});
ipcMain.handle('history:clear', () => {
  // esvazia a lista "Continuar lendo": progresso salvo e pastas avulsas recentes
  config.progress = {}; config.recentFolders = [];
  saveConfigNow();
  return true;
});
const EXTERNAL_LINKS = new Set(['https://github.com/cleitinhodev/', 'https://www.bugzinho.com/', 'https://www.bugzinho.com/donate']);
ipcMain.handle('link:open', (e, url) => {
  if (!EXTERNAL_LINKS.has(url)) return false;
  if (process.env.YOMUCHU_TEST_LINKS) { (global.__openedLinks ||= []).push(url); return true; }
  shell.openExternal(url); return true;
});
ipcMain.handle('test:openedLinks', () => (process.env.YOMUCHU_TEST_LINKS ? global.__openedLinks || [] : null));
ipcMain.handle('app:relaunch', () => { saveConfigNow(); app.relaunch(); app.exit(0); });

ipcMain.handle('library:chooseRoot', async (e) => {
  const r = await dialog.showOpenDialog(senderWin(e), { title: t('dlg.chooseRoot'), properties: ['openDirectory'] });
  if (r.canceled || !r.filePaths[0]) return null;
  config.libraryRoot = r.filePaths[0]; saveConfigSoon();
  return config.libraryRoot;
});
ipcMain.handle('library:setRoot', async (e, root) => {
  if (!safeIsDir(root)) return null;
  config.libraryRoot = path.resolve(root); saveConfigSoon();
  return config.libraryRoot;
});
ipcMain.handle('library:scan', async () => {
  const res = await scanLibrary(config.libraryRoot);
  const dl = await scanDownloads();
  if (dl) res.items.push(dl);
  // "continuar lendo": volumes da biblioteca e pastas avulsas com progresso
  const cont = [];
  const seen = new Set();
  const flat = res.items.flatMap((it) => (it.type === 'series' ? it.volumes : [it]));
  for (const v of flat) if (v.progress) { cont.push(v); seen.add(v.path); }
  for (const f of config.recentFolders) {
    if (seen.has(f) || !config.progress[f] || !safeIsDir(f)) continue;
    const imgs = await listImages(f);
    if (!imgs.length) continue;
    allowRoot(f);
    cont.push(await volumeInfo(f, imgs, null));
  }
  cont.sort((a, b) => b.progress.updated - a.progress.updated);
  res.continueReading = cont.filter((v) => v.progress.page < v.progress.total - 1).slice(0, 12);
  return res;
});
// ---- Abrir link (baixar capítulo de uma URL)
let linkJob = null;
ipcMain.handle('link:start', async (e, url) => {
  if (linkJob) return { ok: false, code: 'busy' };
  const ac = new AbortController();
  linkJob = { ac };
  const sender = e.sender;
  try {
    const r = await linkfetch.downloadChapter(url, {
      destRoot: DL_DIR, signal: ac.signal, electron: require('electron'),
      onProgress: (p) => { if (!sender.isDestroyed()) sender.send('link:progress', p); },
    });
    allowRoot(DL_DIR);
    return { ok: true, folder: r.folder, title: r.title, pages: r.pages, failed: r.failed, truncated: r.truncated, usedRender: r.usedRender, stats: r.stats };
  } catch (err) {
    if (err instanceof linkfetch.LinkError) return { ok: false, code: err.code, detail: err.detail };
    return { ok: false, code: 'other', detail: String((err && err.message) || err).slice(0, 200) };
  } finally { linkJob = null; }
});
ipcMain.handle('link:cancel', () => { if (linkJob) { linkJob.ac.abort(); return true; } return false; });
ipcMain.handle('link:cacheInfo', async () => {
  const dl = await scanDownloads();
  return { count: dl ? dl.volumes.length : 0, bytes: dl ? await dirSize(DL_DIR) : 0 };
});
ipcMain.handle('link:delete', async (e, folder) => {
  if (typeof folder !== 'string' || !underDl(folder)) return false;
  const dir = path.resolve(folder);
  await fsp.rm(dir, { recursive: true, force: true });
  delete config.progress[dir]; saveConfigSoon();
  return true;
});
// Abrir pasta dos baixados (ou de um capítulo específico). O caminho precisa ficar dentro de DL_DIR.
ipcMain.handle('link:openDir', async (e, folder) => {
  try {
    await fsp.mkdir(DL_DIR, { recursive: true });
    const base = await fsp.realpath(DL_DIR);
    let target = base, mode = 'dir';
    if (typeof folder === 'string' && folder) {
      const real = await fsp.realpath(path.resolve(folder)).catch(() => null);
      if (!real || real === base || !real.startsWith(base + path.sep) || !(await fsp.stat(real)).isDirectory()) return { ok: false, error: 'outside' };
      target = real; mode = 'chapter';
    }
    if (process.env.YOMUCHU_TEST_LINKS) { (global.__openedDirs ||= []).push({ path: target, mode }); return { ok: true, mode }; }
    if (mode === 'chapter') shell.showItemInFolder(target);
    else { const err = await shell.openPath(target); if (err) return { ok: false, error: String(err).slice(0, 200) }; }
    return { ok: true, mode };
  } catch (err) { return { ok: false, error: String((err && err.message) || err).slice(0, 200) }; }
});
ipcMain.handle('test:openedDirs', () => (process.env.YOMUCHU_TEST_LINKS ? global.__openedDirs || [] : null));
ipcMain.handle('link:clear', async () => {
  if (linkJob) return false;
  for (const f of Object.keys(config.progress)) if (underDl(f)) delete config.progress[f];
  await fsp.rm(DL_DIR, { recursive: true, force: true });
  saveConfigNow();
  return true;
});

ipcMain.handle('folder:choose', async (e) => {
  const r = await dialog.showOpenDialog(senderWin(e), { title: t('dlg.openFolder'), properties: ['openDirectory'] });
  if (r.canceled || !r.filePaths[0]) return null;
  return r.filePaths[0];
});
ipcMain.handle('folder:isDir', (e, p) => safeIsDir(p));
ipcMain.handle('folder:listPages', async (e, folder) => (await listImages(folder)).map((p) => path.basename(p)));
ipcMain.handle('reader:open', (e, folder, opts) => openReader(folder, opts));
ipcMain.handle('progress:set', (e, folder, page, total) => {
  if (!folder) return;
  config.progress[folder] = { page, total, updated: Date.now() };
  saveConfigSoon(400);
  if (libraryWin) libraryWin.webContents.send('library:progress', { folder, page, total });
});
ipcMain.handle('progress:clear', (e, folder) => { delete config.progress[folder]; saveConfigSoon(); });
ipcMain.handle('folder:reveal', (e, folder) => { if (safeIsDir(folder)) shell.openPath(folder); });

// controles de janela do leitor
ipcMain.handle('win:toggleFullscreen', (e) => { const w = senderWin(e); w.setFullScreen(!w.isFullScreen()); return w.isFullScreen(); });
ipcMain.handle('win:setFullscreen', (e, v) => { const w = senderWin(e); w.setFullScreen(!!v); return w.isFullScreen(); });
ipcMain.handle('win:isFullscreen', (e) => senderWin(e).isFullScreen());
ipcMain.handle('win:minimize', (e) => senderWin(e).minimize());
ipcMain.handle('win:close', (e) => senderWin(e).close());
ipcMain.handle('win:getBounds', (e) => senderWin(e).getBounds());
ipcMain.handle('win:setBounds', (e, b) => {
  const w = senderWin(e);
  if (!w || w.isFullScreen()) return;
  const r = { x: Math.round(b.x), y: Math.round(b.y), width: Math.max(420, Math.round(b.width)), height: Math.max(320, Math.round(b.height)) };
  w.setBounds(r);
});
ipcMain.on('win:moveTo', (e, b) => {
  // movimento manual da janela (alça/borda da capa); mantém largura/altura fixas para evitar
  // o "crescimento" da janela em monitores com escala fracionária no Windows
  const w = senderWin(e);
  if (!w || w.isFullScreen() || w.isMaximized()) return;
  w.setBounds({ x: Math.round(b.x), y: Math.round(b.y), width: Math.round(b.width), height: Math.round(b.height) });
});
ipcMain.handle('win:fitBook', (e, width) => {
  // ajusta a largura da janela do leitor ao livro, mantendo o centro
  const w = senderWin(e);
  if (!w || w.isFullScreen() || w.isMaximized() || !width) return;
  const cur = w.getBounds();
  const wa = screen.getDisplayMatching(cur).workArea;
  const nw = Math.round(Math.max(420, Math.min(width, wa.width)));
  if (Math.abs(nw - cur.width) < 3) return;
  const x = Math.round(Math.min(Math.max(wa.x, cur.x + (cur.width - nw) / 2), wa.x + wa.width - nw));
  w.setBounds({ x, y: cur.y, width: nw, height: cur.height });
});
ipcMain.handle('library:show', () => {
  if (!libraryWin) createLibraryWindow();
  else { if (libraryWin.isMinimized()) libraryWin.restore(); libraryWin.show(); libraryWin.focus(); }
});

// ---------------------------------------------------------------- ciclo de vida
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();
app.on('second-instance', (e, args) => {
  const f = args.slice(1).find((a) => !a.startsWith('-') && safeIsDir(a));
  if (f) openReader(f);
  else if (libraryWin) { if (libraryWin.isMinimized()) libraryWin.restore(); libraryWin.focus(); }
});

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  if (config.libraryRoot) allowRoot(config.libraryRoot);
  for (const f of config.recentFolders) allowRoot(f);
  registerProtocol();
  createLibraryWindow();
  if (cliFolder) openReader(cliFolder);
});
app.on('window-all-closed', () => app.quit());
app.on('before-quit', saveConfigNow);
