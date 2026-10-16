/*
 * Teste ponta a ponta (Playwright + Electron) — rode sob um display X (ex.: Xvfb + picom + xfwm4):
 *   DISPLAY=:99 node tests/e2e.js
 */
const { _electron } = require('playwright-core');
const path = require('path'), fs = require('fs'), { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const UD = '/tmp/yomuchu-e2e';
const SHOTS = path.join(ROOT, 'screenshots');
const LIB = path.join(ROOT, 'amostras', 'biblioteca');
const LOOSE = path.join(ROOT, 'amostras', 'avulso', 'Capitulo 01 - O Comeco');
const SPREAD = path.join(ROOT, 'amostras', 'avulso', 'Capitulo 02 - Paginas Duplas');
const results = [];
const errors = [];
const ok = (name, cond, extra = '') => { results.push({ name, pass: !!cond, extra }); console.log(`${cond ? '✔' : '✘'} ${name}${extra ? ' — ' + extra : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const grab = (file, box) => {
  const crop = box ? `.crop((${box.x},${box.y},${box.x + box.width},${box.y + box.height}))` : '';
  execSync(`python3 -c "from PIL import ImageGrab; ImageGrab.grab(xdisplay='${process.env.DISPLAY}')${crop}.save('${file}')"`);
};
const readCfg = () => JSON.parse(fs.readFileSync(path.join(UD, 'config.json'), 'utf8'));

async function launch() {
  const app = await _electron.launch({ executablePath: require('electron'), args: [ROOT, '--no-sandbox'], env: { ...process.env, MANGA_READER_USERDATA: UD, YOMUCHU_LANG: 'pt-BR', YOMUCHU_TEST_LINKS: '1' } });
  app.process().stderr.on('data', (d) => { const s = String(d); if (/error/i.test(s) && !/dbus|Debugger|gles|viz|GPU|vaapi|egl|gbm|DevTools/i.test(s)) errors.push('[main] ' + s.trim()); });
  return app;
}
function watch(page, tag) {
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${tag} ${m.type()}] ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`[${tag} pageerror] ${e.message}`));
}
async function readerWindow(app, lib) {
  for (let i = 0; i < 50; i++) {
    const w = app.windows().find((p) => p !== lib && p.url().includes('reader.html'));
    if (w) return w;
    await sleep(100);
  }
  throw new Error('janela do leitor não abriu');
}
const winBounds = (app, titleIncludes) => app.evaluate(({ BrowserWindow }, t) => {
  const w = BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().includes(t)); return w && { ...w.getBounds(), fs: w.isFullScreen() };
}, titleIncludes);
const rstate = (rd) => rd.evaluate(() => ({ k: __reader.k, n: __reader.n, dir: __reader.dir, mode: __reader.mode, trans: !!__reader.trans, folder: __reader.folder,
  left: document.querySelector('#slotL').dataset.page, right: document.querySelector('#slotR').dataset.page,
  leftHidden: document.querySelector('#slotL').classList.contains('half-hidden'), rightHidden: document.querySelector('#slotR').classList.contains('half-hidden'),
  counter: document.querySelector('#counter').textContent }));
const waitIdle = async (rd) => { for (let i = 0; i < 60; i++) { if (!(await rd.evaluate(() => !!__reader.trans || __reader.queue.length))) return; await sleep(50); } };

(async () => {
  fs.rmSync(UD, { recursive: true, force: true });
  fs.mkdirSync(SHOTS, { recursive: true });

  // ============================================================ 1ª execução
  let app = await launch();
  let lib = await app.firstWindow();
  watch(lib, 'biblioteca');
  await lib.waitForLoadState('domcontentloaded');
  await lib.waitForSelector('#empty:not(.hidden)');
  ok('Biblioteca vazia mostra tela inicial', await lib.isVisible('#btnChooseRoot'));

  // define a raiz (o diálogo nativo não é automatizável; usa a mesma IPC do arrastar-e-soltar)
  await lib.evaluate((p) => window.mangaAPI.setLibraryRoot(p), LIB);
  await lib.click('#btnRefresh');
  await lib.waitForSelector('.card');
  const items = await lib.evaluate(() => __libState.data.items.map((i) => ({ t: i.title, type: i.type, vols: i.volumes ? i.volumes.map((v) => v.title + ':' + v.pages) : null, pages: i.pages })));
  ok('Varredura encontrou 3 itens (2 séries + 1 volume)', items.length === 3 && items.filter((i) => i.type === 'series').length === 2, JSON.stringify(items));
  const kb = items.find((i) => i.t === 'Kitsune Blade');
  ok('Série aninhada Série/Volume com 3 volumes em ordem', kb && kb.vols.join() === 'Volume 1:16,Volume 2:18,Volume 3:20', kb && kb.vols.join());
  await sleep(1200);
  const covers = await lib.$$eval('.card img', (imgs) => imgs.map((i) => i.naturalWidth));
  ok('Capas (miniaturas) carregadas', covers.length === 3 && covers.every((w) => w > 0 && w <= 420), JSON.stringify(covers));
  const thumbs = fs.existsSync(path.join(UD, 'miniaturas')) ? fs.readdirSync(path.join(UD, 'miniaturas')).length : 0;
  ok('Miniaturas em cache no disco', thumbs >= 3, `${thumbs} arquivos`);
  // busca
  await lib.fill('#search', 'volume 2');
  await sleep(300);
  const found = await lib.$$eval('.card .t', (e) => e.map((x) => x.textContent));
  ok('Busca filtra (procura também dentro das séries)', found.length === 1 && found[0] === 'Volume 2', JSON.stringify(found));
  await lib.fill('#search', 'estrela'); await sleep(300);
  const found2 = await lib.$$eval('.card .t', (e) => e.map((x) => x.textContent));
  ok('Busca pelo nome da série mostra a série e seus volumes', found2.length === 3, JSON.stringify(found2));
  await lib.fill('#search', ''); await sleep(250);

  // ---- abre pasta avulsa: ordenação natural
  await lib.evaluate((p) => window.mangaAPI.openReader(p), LOOSE);
  let rd = await readerWindow(app, lib);
  watch(rd, 'leitor');
  await rd.waitForFunction(() => window.__reader && __reader.n > 0 && document.querySelector('#loading').classList.contains('done'));
  await sleep(900);
  const names = await rd.evaluate(() => __reader.pages.map((p) => p.name));
  const expected = Array.from({ length: 20 }, (_, i) => `pagina${i + 1}.jpg`);
  ok('Ordenação natural (pagina2 antes de pagina10)', JSON.stringify(names) === JSON.stringify(expected), names.slice(0, 12).join(','));
  const transp = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => w.webContents.getURL().split('/').pop()));
  let s = await rstate(rd);
  ok('Abre na capa sozinha (mangá: capa à esquerda da lombada, outra metade oculta)', s.k === 0 && s.left === '0' && s.rightHidden && s.dir === 'rtl', JSON.stringify(s));

  // teclado
  await rd.keyboard.press('ArrowLeft'); await waitIdle(rd);
  s = await rstate(rd);
  ok('Seta ← avança no modo mangá (páginas 2–3)', s.k === 1 && s.right === '1' && s.left === '2', JSON.stringify(s));
  await rd.keyboard.press('ArrowRight'); await waitIdle(rd);
  s = await rstate(rd); ok('Seta → volta no modo mangá', s.k === 0, s.counter);
  await rd.keyboard.press('PageDown'); await waitIdle(rd);
  await rd.keyboard.press('PageDown'); await waitIdle(rd);
  s = await rstate(rd); ok('PageDown avança', s.k === 2, s.counter);
  await rd.keyboard.press('End'); await waitIdle(rd);
  s = await rstate(rd); ok('End vai à última página', s.k === 10 && s.counter === '20 / 20', s.counter);
  await rd.keyboard.press('Home'); await waitIdle(rd);
  s = await rstate(rd); ok('Home volta à capa', s.k === 0 && s.counter.startsWith('Capa'), s.counter);

  // mouse: clique na metade que vira (esquerda no mangá)
  const geo = await rd.evaluate(() => { const r = document.querySelector('#book').getBoundingClientRect(); const g = __reader.geo; return { x: r.left, y: r.top, g }; });
  const leftPageX = geo.x + geo.g.b + geo.g.sMax + geo.g.pw * 0.5, midY = geo.y + geo.g.bh / 2;
  await rd.mouse.click(leftPageX, midY); await sleep(300); await waitIdle(rd);
  s = await rstate(rd); ok('Clique na página esquerda avança (mangá)', s.k === 1, s.counter);
  const rightPageX = geo.x + geo.g.spineX + geo.g.pw * 0.5;
  await rd.mouse.click(rightPageX, midY); await sleep(300); await waitIdle(rd);
  s = await rstate(rd); ok('Clique na página direita volta (mangá)', s.k === 0, s.counter);

  // arrastar o canto da página
  const outerL = geo.x + geo.g.b + geo.g.sMax + 12;
  await rd.mouse.move(outerL, midY + 200);
  await sleep(350);
  await rd.mouse.down();
  for (let i = 1; i <= 16; i++) { await rd.mouse.move(outerL + i * (geo.g.pw * 1.5 / 16), midY + 180 - i * 6); await sleep(16); }
  const midDrag = await rd.evaluate(() => __reader.trans && __reader.trans.t);
  await rd.mouse.up(); await sleep(150); await waitIdle(rd);
  s = await rstate(rd); ok('Arrastar o canto vira a página (com a folha seguindo o mouse)', s.k === 1 && midDrag > 0.4, `t durante arrasto=${midDrag && midDrag.toFixed(2)}, ${s.counter}`);
  // arrastar e soltar cedo cancela
  const outerL2 = outerL;
  await rd.mouse.move(outerL2, midY); await sleep(300); await rd.mouse.down();
  for (let i = 1; i <= 4; i++) { await rd.mouse.move(outerL2 + i * 25, midY); await sleep(16); }
  await sleep(120);
  await rd.mouse.up(); await sleep(100); await waitIdle(rd);
  s = await rstate(rd); ok('Arrasto curto e lento é cancelado (página volta)', s.k === 1, s.counter);
  await rd.mouse.move(geo.x + geo.g.bw / 2, midY);
  // roda do mouse
  await rd.mouse.wheel(0, 120); await sleep(100); await waitIdle(rd);
  s = await rstate(rd); ok('Roda do mouse avança', s.k === 2, s.counter);
  await rd.mouse.wheel(0, -120); await sleep(100); await waitIdle(rd);
  s = await rstate(rd); ok('Roda do mouse volta', s.k === 1, s.counter);

  // tela do leitor sobre a área de trabalho (transparência real via compositor)
  await rd.mouse.move(geo.x + geo.g.bw / 2, midY);
  await rd.keyboard.press('ArrowLeft'); await waitIdle(rd); // páginas 4–5
  await rd.mouse.move(geo.x + geo.g.bw / 2 + 3, 30); await sleep(500);
  let wb = await winBounds(app, 'reader.html');
  const pad = 70;
  const deskBox = { x: Math.max(0, wb.x - pad), y: Math.max(0, wb.y - pad), width: Math.min(1600 - Math.max(0, wb.x - pad), wb.width + 2 * pad), height: Math.min(1000 - Math.max(0, wb.y - pad), wb.height + 2 * pad) };
  grab(path.join(SHOTS, 'leitor.png'));
  grab('/tmp/leitor-crop.png', deskBox);
  // física da virada: 1) roda quadro a quadro, chega ao destino, quica e assenta
  const trace = await rd.evaluate(() => new Promise((res) => {
    const out = [];
    const tick = () => { const tr = __reader.trans; if (tr) out.push(Array.from(tr.u)); if (tr || out.length === 0) requestAnimationFrame(tick); else res(out); };
    __readerTest.go(1); requestAnimationFrame(tick);
  }));
  const means = trace.map((u) => u.reduce((a, b) => a + b, 0) / u.length);
  const outer = trace.map((u) => u[u.length - 1]);
  const lagged = trace.some((u) => u[0] - u[u.length - 1] > 0.12);            // borda externa atrasada (curvatura)
  // "balanço": depois de tocar a página, alguma parte da folha volta a subir antes de assentar
  let wobble = 0;
  for (let j = 0; j < trace[0].length; j++) {
    const first = trace.findIndex((u) => u[j] >= 0.985);
    if (first < 0) continue;
    for (let i = first; i < trace.length; i++) wobble = Math.max(wobble, 1 - trace[i][j]);
  }
  ok('Física: folha curva (borda atrasada), chega ao destino e balança antes de assentar',
    trace.length > 15 && Math.max(...means) > 0.97 && lagged && wobble > 0.012,
    `${trace.length} quadros, máx=${Math.max(...means).toFixed(3)}, curvatura=${lagged}, balanço após tocar a página=${(wobble * 180).toFixed(1)}°`);
  await waitIdle(rd);
  // 2) capturas reais da simulação congelada em instantes diferentes
  await rd.evaluate(() => { document.body.classList.add('ui-hidden'); });
  await sleep(500);
  const shoot = async (ms, file, dir = 1) => {
    await rd.evaluate(([ms, dir]) => new Promise((res) => { __readerTest.go(dir); setTimeout(() => { __readerTest.pause(true); res(); }, ms); }), [ms, dir]);
    await sleep(120);
    grab(path.join(SHOTS, file));
    const info = await rd.evaluate(() => __reader.trans && Array.from(__reader.trans.u, (x) => Math.round(x * 180)));
    await rd.evaluate(() => __readerTest.pause(false));
    await waitIdle(rd);
    return info;
  };
  const a1 = await shoot(150, 'fisica-1.png');
  const a2 = await shoot(260, 'virando.png');
  const a3 = await shoot(385, 'fisica-2.png');
  ok('Capturas da física (curvatura em voo e onda ao assentar)', a1 && a2 && a3, `ângulos: [${a1}] | [${a2}] | [${a3}]`);
  s = await rstate(rd);
  ok('Após as capturas a leitura continua normal', s.k === 6 && !s.trans, s.counter);
  await rd.keyboard.press('Home'); await waitIdle(rd);
  await rd.keyboard.press('PageDown'); await waitIdle(rd);
  await rd.keyboard.press('PageDown'); await waitIdle(rd);
  await rd.keyboard.press('PageDown'); await waitIdle(rd);
  await rd.keyboard.press('PageDown'); await waitIdle(rd);

  // 3) arrastar sobre a página NÃO move a janela (bug do Windows) e vira a página
  {
    const before = await winBounds(app, 'reader.html');
    const k0 = (await rstate(rd)).k;
    const gg = await rd.evaluate(() => { const r = document.querySelector('#book').getBoundingClientRect(); return { x: r.left, y: r.top, g: __reader.geo }; });
    const startX = gg.x + gg.g.b + gg.g.sMax + gg.g.pw * 0.45, y = gg.y + gg.g.bh * 0.6;   // meio da página esquerda
    await rd.mouse.move(startX, y); await rd.mouse.down();
    for (let i = 1; i <= 14; i++) { await rd.mouse.move(startX + i * gg.g.pw * 0.09, y - i * 3); await sleep(16); }
    const during = await winBounds(app, 'reader.html');
    await rd.mouse.up(); await sleep(100); await waitIdle(rd);
    const after = await winBounds(app, 'reader.html');
    const k1 = (await rstate(rd)).k;
    const still = (b) => b.x === before.x && b.y === before.y && b.width === before.width && b.height === before.height;
    ok('Arrastar no meio da página não move a janela e vira a folha', still(during) && still(after) && k1 === k0 + 1,
      `janela ${before.x},${before.y} → ${after.x},${after.y}; vista ${k0} → ${k1}`);
    // a alça ⠿ move a janela (movimento manual via IPC)
    const grip = await rd.evaluate(() => { const r = document.querySelector('.grip').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    await rd.mouse.move(grip.x, grip.y); await rd.mouse.down();
    await rd.mouse.move(grip.x + 60, grip.y + 40); await sleep(250);
    await rd.mouse.up(); await sleep(300);
    const moved = await winBounds(app, 'reader.html');
    ok('A alça ⠿ move a janela (sem mudar o tamanho)', (moved.x !== after.x || moved.y !== after.y) && moved.width === after.width && moved.height === after.height,
      `${after.x},${after.y} → ${moved.x},${moved.y}`);
    // devolve a janela ao lugar para o resto dos testes
    await app.evaluate(({ BrowserWindow }, b) => BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('reader')).setBounds(b), after);
    await sleep(300);
    const css = await rd.evaluate(() => [...document.querySelectorAll('*')].filter((e) => getComputedStyle(e).webkitAppRegion === 'drag').length);
    ok('Nenhum elemento usa a região de arrasto nativa (-webkit-app-region: drag)', css === 0, `${css} elementos`);
    await rd.keyboard.press('ArrowRight'); await waitIdle(rd);
  }

  // direção
  const before = await rstate(rd);
  await rd.keyboard.press('d'); await sleep(500);
  s = await rstate(rd);
  ok('Tecla D alterna para ocidental (esq.→dir.) mantendo a página', s.dir === 'ltr' && s.k === before.k && s.left === before.right, `${before.left}|${before.right} → ${s.left}|${s.right}`);
  await rd.keyboard.press('ArrowRight'); await waitIdle(rd);
  s = await rstate(rd); ok('No modo ocidental, seta → avança', s.k === before.k + 1, s.counter);
  await sleep(600);
  ok('Direção salva nas configurações', readCfg().settings.direction === 'ltr');
  await rd.click('#btnDir'); await sleep(400);
  s = await rstate(rd); ok('Botão de direção volta ao modo mangá', s.dir === 'rtl');
  // página única
  await rd.keyboard.press('m'); await sleep(700);
  s = await rstate(rd); ok('Tecla M alterna para página única', s.mode === 'single', s.counter);
  await rd.keyboard.press('ArrowLeft'); await waitIdle(rd);
  const s2 = await rstate(rd); ok('Virar no modo página única', s2.k === s.k + 1, `${s.counter} → ${s2.counter}`);
  await rd.keyboard.press('m'); await sleep(700);
  s = await rstate(rd); ok('Volta para página dupla', s.mode === 'double', s.counter);

  // zoom
  await rd.keyboard.down('Control'); await rd.mouse.move(geo.x + 300, midY); await rd.mouse.wheel(0, -300); await rd.keyboard.up('Control'); await sleep(300);
  const z = await rd.evaluate(() => __reader.zoom);
  await rd.keyboard.press('0'); await sleep(300);
  const z0 = await rd.evaluate(() => __reader.zoom);
  ok('Zoom com Ctrl+roda e reset com 0', z > 1.2 && z0 === 1, `zoom=${z.toFixed(2)}`);

  // tela cheia
  await rd.keyboard.press('F11'); await sleep(1500);
  wb = await winBounds(app, 'reader.html');
  const fsBody = await rd.evaluate(() => document.body.classList.contains('fs'));
  const g2 = await rd.evaluate(() => __reader.geo);
  ok('F11 entra em tela cheia e o livro ocupa a tela', wb.fs && fsBody && g2.bh > 900, `janela ${wb.width}x${wb.height}, livro ${g2.bw}x${g2.bh}`);
  await rd.mouse.move(800, 20); await sleep(400);
  grab(path.join(SHOTS, 'telacheia.png'));
  await rd.keyboard.press('Escape'); await sleep(1200);
  wb = await winBounds(app, 'reader.html');
  ok('Esc sai da tela cheia', !wb.fs);
  await rd.locator('#btnFull').click({ force: true }); await sleep(1200);
  wb = await winBounds(app, 'reader.html'); ok('Botão de tela cheia funciona', wb.fs);
  await rd.keyboard.press('Escape'); await sleep(1200);
  // duplo clique
  await rd.mouse.dblclick(geo.x + geo.g.spineX + geo.g.pw * 0.5, midY); await sleep(1300);
  wb = await winBounds(app, 'reader.html'); ok('Duplo clique alterna tela cheia', wb.fs);
  await rd.keyboard.press('Escape'); await sleep(1200);
  wb = await winBounds(app, 'reader.html');
  s = await rstate(rd);
  const savedK = s.k;

  // ajuda
  await rd.keyboard.press('?'); await sleep(250);
  ok('Atalho ? abre a ajuda', await rd.isVisible('#help'));
  await rd.keyboard.press('Escape'); await sleep(200);

  // abre volume da biblioteca pelo clique na capa (série → volume)
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().includes('library')); w.restore(); w.focus(); });
  await sleep(400);
  await lib.click('.card.series >> nth=1'); await sleep(500); // Kitsune Blade
  await lib.click('.card >> nth=1'); // Volume 2
  await rd.waitForFunction(() => __reader.folder && __reader.folder.includes('Volume 2'));
  await sleep(900);
  await rd.keyboard.press('ArrowLeft'); await waitIdle(rd);
  await rd.keyboard.press('ArrowLeft'); await waitIdle(rd);
  await rd.keyboard.press('ArrowLeft'); await waitIdle(rd);
  s = await rstate(rd);
  ok('Abrir volume pela biblioteca e ler', s.k === 3 && s.n === 18, `${s.folder.split('/').slice(-2).join('/')} ${s.counter}`);
  await sleep(800);
  const wbFinal = await winBounds(app, 'reader.html');
  const cfg = readCfg();
  ok('Progresso salvo em config.json (userData)', cfg.progress[LOOSE] && cfg.progress[LOOSE].page === savedK * 2 && cfg.progress[s.folder].page === 6,
    `avulso=${JSON.stringify(cfg.progress[LOOSE])}, vol2=${JSON.stringify(cfg.progress[s.folder])}`);
  await app.close();

  // ============================================================ 2ª execução (persistência)
  app = await launch();
  lib = await app.firstWindow();
  watch(lib, 'biblioteca#2');
  await lib.waitForSelector('.cont');
  await sleep(1300);
  const conts = await lib.$$eval('.cont .title', (e) => e.map((x) => x.textContent));
  ok('Após reiniciar: seção "Continuar lendo" lista os volumes lidos', conts.length === 2 && conts[0] === 'Volume 2', JSON.stringify(conts));
  ok('Após reiniciar: raiz da biblioteca lembrada', (await lib.textContent('#rootPath')) === LIB);
  await lib.screenshot({ path: path.join(SHOTS, 'biblioteca.png') });
  // série aberta (tela de volumes) para o relatório
  await lib.click('.card.series >> nth=1'); await sleep(900);
  await lib.screenshot({ path: path.join(SHOTS, 'biblioteca-serie.png') });
  await lib.click('#crumbHome'); await sleep(300);
  await lib.click('.cont >> nth=1'); // pasta avulsa
  rd = await readerWindow(app, lib);
  watch(rd, 'leitor#2');
  await rd.waitForFunction(() => window.__reader && __reader.n > 0 && document.querySelector('#loading').classList.contains('done'));
  await sleep(700);
  s = await rstate(rd);
  ok('Após reiniciar: volume reabre na página onde parou', s.k === savedK && s.dir === 'rtl', `${s.counter}`);
  const wb2 = await winBounds(app, 'reader.html');
  ok('Após reiniciar: tamanho/posição da janela lembrados', Math.abs(wb2.width - wbFinal.width) < 4 && Math.abs(wb2.height - wbFinal.height) < 4 && Math.abs(wb2.x - wbFinal.x) < 4, `${wbFinal.width}x${wbFinal.height}@${wbFinal.x},${wbFinal.y} → ${wb2.width}x${wb2.height}@${wb2.x},${wb2.y}`);
  // segurança: arquivo fora das pastas permitidas é bloqueado
  const errCount = errors.length;
  const probe = (p) => rd.evaluate((u) => new Promise((res) => { const i = new Image(); i.onload = () => res('carregou'); i.onerror = () => res('bloqueado'); i.src = 'manga://page/?p=' + encodeURIComponent(u); }), p);
  fs.copyFileSync(path.join(LOOSE, 'pagina3.jpg'), '/tmp/fora-da-biblioteca.jpg');
  const outside = await probe('/tmp/fora-da-biblioteca.jpg'), inside = await probe(path.join(LOOSE, 'pagina3.jpg'));
  ok('Protocolo manga:// só serve imagens das pastas escolhidas', outside === 'bloqueado' && inside === 'carregou', `fora: ${outside}, dentro: ${inside}`);
  const nodeOff = await rd.evaluate(() => typeof require === 'undefined' && typeof process === 'undefined');
  ok('Renderer isolado (sem Node: contextIsolation/sandbox)', nodeOff);
  // o 403 proposital do teste acima não conta como erro
  for (let i = errors.length - 1; i >= errCount; i--) if (/403/.test(errors[i])) errors.splice(i, 1);

  // ---- 0.2.1: páginas duplas (spreads)
  {
    await lib.evaluate((p) => window.mangaAPI.openReader(p), SPREAD);
    await rd.waitForFunction((p) => __reader.folder === p && document.querySelector('#loading').classList.contains('done'), SPREAD);
    await sleep(700);
    const views = () => rd.evaluate(() => __reader.views.map((v) => (v.s != null ? `S${v.s}` : `${v.a ?? '-'}|${v.b ?? (v.blank ? 'B' : '-')}`)).join(' '));
    const V = await views();
    ok('Duplas: paginação refeita (capa, pares, dupla, branco antes da 2ª dupla)', V === '-|0 1|2 S3 4|5 6|B S7 8|9 10|11', V);
    const slots = () => rd.evaluate(() => ['#slotL', '#slotR'].map((q) => { const e = document.querySelector(q); return { page: e.dataset.page, half: e.dataset.half || '', blank: e.classList.contains('blankpage'), hidden: e.classList.contains('half-hidden'), pos: e.firstElementChild.style.backgroundPosition }; }));
    await rd.keyboard.press('Home'); await waitIdle(rd);
    // vira até a dupla acompanhando a física quadro a quadro
    await rd.keyboard.press('ArrowLeft'); await waitIdle(rd);
    const tr = await rd.evaluate(() => new Promise((res) => {
      let back = null, frames = 0;
      const tick = () => { const t = __reader.trans; if (t) { frames++; back = back || t.back; requestAnimationFrame(tick); } else res({ frames, back, k: __reader.k }); };
      __readerTest.go(1); requestAnimationFrame(tick);
    }));
    ok('Duplas: a folha vira para a dupla com física (verso = metade da dupla)', tr.k === 2 && tr.frames > 15 && tr.back && tr.back.p === 3 && tr.back.half === 'right', JSON.stringify(tr));
    let sl = await slots(), st = await rstate(rd);
    const pw = await rd.evaluate(() => __reader.geo.pw);
    const xL = parseFloat(sl[0].pos), xR = parseFloat(sl[1].pos);
    ok('Duplas: a imagem ocupa as duas páginas (metade esquerda + direita)', sl[0].page === '3' && sl[1].page === '3' && sl[0].half === 'left' && sl[1].half === 'right' && !sl[0].hidden && !sl[1].hidden && Math.abs((xL - xR) - pw) < 1.5,
      `${JSON.stringify(sl)} pw=${pw}`);
    ok('Duplas: contador mostra a página dupla', st.counter === '4 / 12', st.counter);
    await rd.evaluate(() => document.body.classList.add('ui-hidden')); await sleep(400);
    wb = await winBounds(app, 'reader.html');
    grab(path.join(SHOTS, 'pagina-dupla.png'), { x: Math.max(0, wb.x), y: Math.max(0, wb.y), width: Math.min(1600 - Math.max(0, wb.x), wb.width), height: Math.min(1000 - Math.max(0, wb.y), wb.height) });
    // captura no meio da virada saindo da dupla
    await rd.evaluate(() => new Promise((res) => { __readerTest.go(1); setTimeout(() => { __readerTest.pause(true); res(); }, 230); }));
    const fr = await rd.evaluate(() => __reader.trans && __reader.trans.front);
    await sleep(120); grab(path.join(SHOTS, 'virando-dupla.png'), { x: Math.max(0, wb.x), y: Math.max(0, wb.y), width: Math.min(1600 - Math.max(0, wb.x), wb.width), height: Math.min(1000 - Math.max(0, wb.y), wb.height) });
    await rd.evaluate(() => __readerTest.pause(false)); await waitIdle(rd);
    ok('Duplas: ao sair, a frente da folha é a outra metade da dupla', fr && fr.p === 3 && fr.half === 'left', JSON.stringify(fr));
    st = await rstate(rd);
    ok('Duplas: depois da dupla os pares continuam certos (5–6)', st.k === 3 && st.left === '5' && st.right === '4', JSON.stringify(st));
    await rd.keyboard.press('ArrowLeft'); await waitIdle(rd);
    sl = await slots(); st = await rstate(rd);
    ok('Duplas: página sozinha antes de dupla ganha página em branco (não some)', st.counter === '7 / 12' && sl[1].page === '6' && sl[0].blank && !sl[0].hidden, `${st.counter} ${JSON.stringify(sl)}`);
    await rd.screenshot({ path: path.join(SHOTS, 'pagina-em-branco.png') });
    await rd.evaluate(() => document.body.classList.remove('ui-hidden'));
    // pular para página pela barra
    const jump = (p) => rd.evaluate((p) => { const sl = document.querySelector('#slider'); sl.value = p; sl.dispatchEvent(new Event('change')); }, p);
    await jump(7); await sleep(300); st = await rstate(rd);
    ok('Duplas: barra de páginas pula direto para a dupla', st.k === 5 && st.counter === '8 / 12', st.counter);
    await jump(9); await sleep(300); st = await rstate(rd);
    ok('Duplas: barra de páginas pula para um par depois das duplas', st.k === 6 && st.counter === '9–10 / 12', st.counter);
    // direção ocidental: a dupla não espelha; setas invertem
    await jump(3); await sleep(300);
    await rd.keyboard.press('d'); await sleep(500);
    sl = await slots(); st = await rstate(rd);
    ok('Duplas: no modo ocidental a dupla continua inteira e na mesma posição', st.dir === 'ltr' && st.k === 2 && sl[0].half === 'left' && sl[1].half === 'right', JSON.stringify(sl));
    await rd.keyboard.press('ArrowRight'); await waitIdle(rd);
    st = await rstate(rd);
    ok('Duplas: ocidental, seta → sai da dupla para 5–6', st.k === 3 && st.left === '4' && st.right === '5', JSON.stringify(st));
    await rd.keyboard.press('ArrowLeft'); await waitIdle(rd);
    await rd.keyboard.press('d'); await sleep(500);
    // página única
    await rd.keyboard.press('m'); await sleep(600);
    st = await rstate(rd); sl = await slots();
    const nv = await rd.evaluate(() => __reader.views.length);
    ok('Duplas: em página única cada imagem é uma vista e a dupla aparece inteira', nv === 12 && st.mode === 'single' && sl[1].page === '3' && sl[1].half === '', `${nv} vistas, ${st.counter}`);
    await rd.keyboard.press('m'); await sleep(600);
    // opção desligada: volta à paginação antiga
    await lib.evaluate(() => window.mangaAPI.setSettings({ detectSpreads: false })); await sleep(500);
    const Voff = await views();
    ok('Duplas: opção desligada volta à paginação comum', Voff === '-|0 1|2 3|4 5|6 7|8 9|10 11|-', Voff);
    await lib.evaluate(() => window.mangaAPI.setSettings({ detectSpreads: true })); await sleep(500);
    ok('Duplas: opção religada recalcula as vistas', (await views()) === V);
    await lib.click('#btnSettings'); await sleep(200);
    ok('Duplas: chave "Detectar páginas duplas" nas configurações (ligada por padrão)', (await lib.isChecked('#setSpreads')) && (await lib.textContent('.field b[data-i18n="set.spreads"]')) === 'Detectar páginas duplas automaticamente');
    await lib.keyboard.press('Escape');
    // tela cheia na dupla
    await jump(3); await sleep(300);
    await rd.keyboard.press('F11'); await sleep(1500);
    wb = await winBounds(app, 'reader.html'); sl = await slots();
    const gf = await rd.evaluate(() => __reader.geo);
    const xL2 = parseFloat(sl[0].pos), xR2 = parseFloat(sl[1].pos);
    ok('Duplas: em tela cheia a dupla ocupa o livro inteiro', wb.fs && sl[0].half === 'left' && Math.abs((xL2 - xR2) - gf.pw) < 1.5 && gf.bh > 900, `livro ${gf.bw}x${gf.bh}`);
    await rd.mouse.move(800, 500); await sleep(300);
    await rd.evaluate(() => document.body.classList.add('ui-hidden')); await sleep(300);
    grab(path.join(SHOTS, 'pagina-dupla-telacheia.png'));
    await rd.evaluate(() => document.body.classList.remove('ui-hidden'));
    await rd.keyboard.press('Escape'); await sleep(1200);
    // arrastar o canto também funciona saindo da dupla
    const gg = await rd.evaluate(() => { const r = document.querySelector('#book').getBoundingClientRect(); return { x: r.left, y: r.top, g: __reader.geo }; });
    const ox = gg.x + gg.g.b + gg.g.sMax + 12, oy = gg.y + gg.g.bh / 2;
    await rd.mouse.move(ox, oy + 150); await sleep(300); await rd.mouse.down();
    for (let i = 1; i <= 16; i++) { await rd.mouse.move(ox + i * (gg.g.pw * 1.5 / 16), oy + 130 - i * 6); await sleep(16); }
    await rd.mouse.up(); await sleep(150); await waitIdle(rd);
    st = await rstate(rd);
    ok('Duplas: arrastar o canto vira a página saindo da dupla', st.k === 3, st.counter);
    // devolve o estado da 2ª execução (a pasta de duplas não entra no "Continuar lendo")
    await lib.evaluate((p) => window.mangaAPI.openReader(p), LOOSE);
    await rd.waitForFunction((p) => __reader.folder === p, LOOSE); await sleep(800);
    await lib.evaluate((p) => window.mangaAPI.clearProgress(p), SPREAD);
    await lib.evaluate(() => load()); await sleep(1500);
  }

  // ---- 0.3.0: "Abrir link" (baixar capítulo de uma URL) com site falso local
  {
    const http = require('http'), crypto = require('crypto'), LF = require(path.join(ROOT, 'src', 'linkfetch.js'));
    const FAKE = '/tmp/yomuchu-fake';
    execSync(`python3 ${path.join(__dirname, 'fake_chapter.py')} ${FAKE}`);
    const sha = (f) => crypto.createHash('sha1').update(fs.readFileSync(f)).digest('hex');
    const DL = path.join(UD, 'baixados');

    // ---------- 1) núcleo: perfil de página, extração de URLs, segurança (sem rede)
    const it = (url, w, h, extra) => ({ url, w, h, ...(extra || {}) });
    const sample = [
      it('logo', 300, 100), it('btn', 32, 32), it('avatar', 128, 128), it('banner', 728, 90), it('thumb', 200, 280),
      it('a', 800, 1200), it('b', 780, 1170), it('c', 830, 1245), it('sp', 1600, 1200), it('related', 520, 740),
      it('d', 800, 1200), it('a', 800, 1200), it('wide', 1400, 500), it('sq', 800, 800), it('tiny', 800, 1200, { bytes: 3000 }),
      it('gif', 600, 900, { type: 'gif' }), it('e', 820, 1230, { bytes: 90000 }), it('huge', 2400, 3600), it('banner2', 1600, 800),
    ];
    const fr = LF.filterByProfile(sample);
    ok('Link (núcleo): só páginas do grupo de resolução dominante e a dupla são mantidas, na ordem', fr.kept.map((i) => i.url).join(',') === 'a,b,c,sp,d,e', fr.kept.map((i) => i.url).join(','));
    ok('Link (núcleo): isca pequena, logo, banner, avatar, miniatura, quadrada, larga, GIF e arquivo minúsculo caem', ['logo', 'btn', 'avatar', 'banner', 'thumb', 'wide', 'sq', 'tiny', 'gif', 'related', 'huge', 'banner2'].every((u) => fr.dropped.some((d) => d.url === u)) && fr.dropped.some((d) => d.reason === 'duplicada'), JSON.stringify(fr.dropped.map((d) => d.url + ':' + d.reason)));
    ok('Link (núcleo): sem nenhuma página em pé, nada é mantido', LF.filterByProfile([it('x', 300, 100), it('y', 1600, 1200)]).kept.length === 0);
    ok('Link (núcleo): limites ajustáveis no topo do arquivo (perfil e limites exportados)', LF.PROFILE.minShort === 500 && LF.PROFILE.minLong === 700 && LF.PROFILE.portraitMin === 1.2 && LF.PROFILE.portraitMax === 2.2 && LF.PROFILE.spreadMax === 2.4 && LF.LIMITS.maxPages > 0 && LF.LIMITS.maxTotalBytes > 0);
    const cand = LF.extractCandidates('<title>x</title><img src="/a.jpg"><img src="data:image/gif;base64,AA" data-src="b.jpg"><img src="blank.gif" data-original="//cdn.test/c.jpg"><img srcset="s1.jpg 400w, s2.jpg 800w"><noscript><img src="b.jpg"><img src="d.png"></noscript><picture><source srcset="p.webp"><img src="p.jpg"></picture><!-- <img src="no.jpg"> --><script>var s="<img src=zz.jpg>"</script><img src="javascript:alert(1)"><img src="file:///etc/passwd"><img src="ftp://h/x.jpg"><img src="/a.jpg#t">', 'http://h.test/cap/1');
    ok('Link (núcleo): extrai data-src, data-original, srcset (maior), noscript, picture, URLs relativas; ignora comentários, scripts, data:, javascript:, file:, ftp:, repetidas', cand.join(' ') === 'http://h.test/a.jpg http://h.test/cap/b.jpg http://cdn.test/c.jpg http://h.test/cap/s2.jpg http://h.test/cap/d.png http://h.test/cap/p.jpg', cand.join(' '));
    let bad = 0;
    for (const u of ['file:///etc/passwd', 'ftp://h/x', 'javascript:alert(1)', 'data:text/html,hi', '//h/x', 'http://', '', 'https://a b/']) { try { LF.normalizeInput(u); bad++; } catch (e) { if (e.code !== 'badUrl') bad++; } }
    ok('Link (segurança): só http/https; file:, ftp:, javascript:, data: e lixo são recusados', bad === 0 && LF.normalizeInput(' https://h.test/x#y ') === 'https://h.test/x');
    ok('Link (segurança): nomes de arquivo/pasta saneados (sem / \\ : * ? " < > |, sem nomes reservados, tamanho limitado)', LF.sanitizeName('a/b\\c:d*e?"f<g>h|i') === 'a b c d e f g h i' && LF.sanitizeName('CON') === '_CON' && LF.sanitizeName('../..') === 'capitulo' && LF.sanitizeName('x'.repeat(300)).length <= 80);

    // ---------- 2) site falso
    const log = [];
    const IMG = (n) => `/img/${n}`;
    const decoys = `<header><img src="/img/logo.png" class="logo"><a><img src="/img/btn.png"></a><a><img src="/img/btn.png"></a><img src="/img/avatar.jpg"></header><div class="ad"><img src="/img/banner.jpg"></div>
      <aside><img src="/img/thumb1.jpg"><img src="/img/thumb2.jpg"><img src="/img/thumb3.jpg"><img src="/img/related.jpg"></aside>`;
    const pagesOk = `<div class="reader">
      <img src="/img/p1.jpg">
      <img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" data-src="/img/p2.jpg" class="lazy">
      <img src="/img/p2.jpg">
      <img src="/img/blank.gif" data-original="http://HOST/img/p3.jpg">
      <img src="/img/p3_copia.jpg">
      <img srcset="/img/p4_small.jpg 400w, /img/p4.jpg 800w">
      <img src="/img/spread.jpg">
      <img data-src="/img/p5.jpg" src="/img/loading.gif"><noscript><img src="/img/p5.jpg"></noscript>
      <img src="../img/p6.jpg">
      <picture><source srcset="/img/p7.webp?x 800w"><img src="/img/p7.jpg"></picture>
      <img src="/img/p8.jpg"><img src="/img/p11.png"><img src="/img/p12.webp">
      <img src="/img/tiny.jpg"><img src="/img/square.jpg"><img src="/img/wide.jpg"><img src="/img/anim.gif"><img src="/img/icon.svg"><img src="/img/related.jpg">
    </div>`;
    const jsPages = ['p1', 'p2', 'p3', 'p4', 'spread', 'p5', 'p6'];
    const routes = {
      '/cap/ok': () => ({ html: `<html><head><title>Capítulo 12 &amp; teste – Site</title></head><body>${decoys}${pagesOk}<footer><img src="/img/thumb2.jpg"></footer></body></html>` }),
      '/cap/js': () => ({ html: `<html><head><title>Capítulo JS</title></head><body>${decoys}<div id="c"></div><script>setTimeout(function(){var c=document.getElementById('c');${JSON.stringify(jsPages)}.forEach(function(n,i){setTimeout(function(){var im=new Image();im.src='/img/'+n+'.jpg';c.appendChild(im);},i*60);});},300);</script></body></html>` }),
      '/cap/two': () => ({ html: `<html><head><title>Capítulo Curto</title></head><body>${decoys}<img src="/img/p1.jpg"><img src="/img/p2.jpg"></body></html>` }),
      '/cap/few': () => ({ html: `<html><head><title>Sem páginas</title></head><body>${decoys}<img src="/img/square.jpg"><img src="/img/wide.jpg"></body></html>` }),
      '/cap/blocked': () => ({ status: 403, html: '<html><title>Forbidden</title>Acesso negado</html>' }),
      '/cap/missing': () => ({ status: 404, html: 'nada' }),
      '/cap/redir': () => ({ status: 302, headers: { Location: 'file:///etc/passwd' }, html: '' }),
      '/cap/slow': () => ({ html: `<html><head><title>Capítulo Lento</title></head><body>${decoys}${['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8', 'p9', 'p10'].map((n) => `<img src="/slow/${n}.jpg">`).join('')}</body></html>` }),
    };
    let HOST = '';
    const server = http.createServer((req, res) => {
      const u = new URL(req.url, 'http://x');
      if (u.pathname.startsWith('/img/') || u.pathname.startsWith('/slow/')) {
        const name = path.basename(u.pathname), f = path.join(FAKE, name);
        const ent = { path: u.pathname, range: req.headers.range || null, referer: req.headers.referer || null, ua: req.headers['user-agent'] || '', t: Date.now() };
        log.push(ent);
        if (!fs.existsSync(f)) { res.writeHead(404); return res.end(); }
        if (!ent.referer || !ent.referer.startsWith(HOST + '/')) { res.writeHead(403); return res.end('sem referer'); }
        const send = () => {
          const buf = fs.readFileSync(f);
          const type = /\.png$/.test(f) ? 'image/png' : /\.webp$/.test(f) ? 'image/webp' : /\.gif$/.test(f) ? 'image/gif' : /\.svg$/.test(f) ? 'image/svg+xml' : 'image/jpeg';
          const m = /bytes=(\d+)-(\d+)?/.exec(req.headers.range || '');
          if (m && /^p\d+\.jpg$/.test(name)) { const a = +m[1], b = Math.min(buf.length - 1, m[2] ? +m[2] : buf.length - 1); res.writeHead(206, { 'Content-Type': type, 'Content-Range': `bytes ${a}-${b}/${buf.length}`, 'Content-Length': b - a + 1 }); return res.end(buf.subarray(a, b + 1)); }
          res.writeHead(200, { 'Content-Type': type, 'Content-Length': buf.length }); res.end(buf);
        };
        return u.pathname.startsWith('/slow/') ? setTimeout(send, 450) : send();
      }
      const r = routes[u.pathname];
      if (!r) { res.writeHead(404); return res.end('404'); }
      const o = r(); log.push({ path: u.pathname, page: true, ua: req.headers['user-agent'] || '' });
      res.writeHead(o.status || 200, { 'Content-Type': 'text/html; charset=utf-8', ...(o.headers || {}) }); res.end((o.html || '').replace(/HOST/g, HOST.replace('http://', '')));
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    HOST = 'http://127.0.0.1:' + server.address().port;
    const start = (p) => lib.evaluate((u) => window.mangaAPI.startLink(u), HOST + p);
    const dlDirs = () => (fs.existsSync(DL) ? fs.readdirSync(DL) : []);
    const files = (d) => fs.readdirSync(d).filter((x) => !x.startsWith('.')).sort();

    // ---------- 3) interface: diálogo, aviso legal, URL inválida
    await lib.click('#btnOpenLink'); await sleep(250);
    const dlg = await lib.evaluate(() => ({ vis: !document.querySelector('#linkDlg').classList.contains('hidden'), title: document.querySelector('#linkTitle').textContent, legal: document.querySelector('#linkLegal').textContent, ph: document.querySelector('#linkUrl').placeholder, go: document.querySelector('#linkGo').textContent, focus: document.activeElement.id }));
    ok('Link: botão "Abrir link" abre o diálogo com campo focado e aviso de direito de leitura', dlg.vis && dlg.title === 'Abrir link' && /direito de ler/.test(dlg.legal) && /login, paywall, captcha/.test(dlg.legal) && dlg.go === 'Baixar e abrir' && dlg.focus === 'linkUrl', JSON.stringify(dlg));
    await lib.screenshot({ path: path.join(SHOTS, 'link-dialogo.png') });
    await lib.fill('#linkUrl', 'file:///etc/passwd'); await lib.click('#linkGo'); await sleep(250);
    const badMsg = await lib.evaluate(() => ({ t: document.querySelector('#linkMsg').textContent, vis: !document.querySelector('#linkMsg').classList.contains('hidden'), prog: !document.querySelector('#linkProg').classList.contains('hidden') }));
    ok('Link (segurança): file:// é recusado na interface sem tentar baixar', badMsg.vis && /http:\/\/ ou https:\/\//.test(badMsg.t) && !badMsg.prog, JSON.stringify(badMsg));
    const direct = await lib.evaluate(() => window.mangaAPI.startLink('file:///etc/passwd'));
    ok('Link (segurança): o processo principal também recusa file:// (não confia na interface)', direct.ok === false && direct.code === 'badUrl');

    // ---------- 4) capítulo completo: iscas fora, ordem, nomes, Referer, leitor abre
    const nBefore = log.length;
    await lib.fill('#linkUrl', HOST + '/cap/ok');
    await lib.click('#linkGo');
    await rd.waitForFunction((d) => (window.__reader.folder || '').startsWith(d), DL, { timeout: 60000 });
    await sleep(800);
    await lib.keyboard.press('Escape'); await sleep(200); // o diálogo fica no estado concluído (0.3.1); Esc fecha
    const okDirs = dlDirs().filter((d) => !d.startsWith('.'));
    const chap = path.join(DL, okDirs[0] || 'x');
    const got = fs.existsSync(chap) ? files(chap) : [];
    const expectSrc = ['p1.jpg', 'p2.jpg', 'p3.jpg', 'p4.jpg', 'spread.jpg', 'p5.jpg', 'p6.jpg', 'p7.jpg', 'p8.jpg', 'p11.png', 'p12.webp'];
    ok('Link: pasta "Baixados de links" criada com o título da página (saneado)', okDirs.length === 1 && okDirs[0] === 'Capítulo 12 & teste – Site', okDirs.join('|'));
    ok('Link: só as 11 páginas reais ficam, nomeadas 001, 002… com a extensão pelo conteúdo (jpg/png/webp)', got.join(',') === '001.jpg,002.jpg,003.jpg,004.jpg,005.jpg,006.jpg,007.jpg,008.jpg,009.jpg,010.png,011.webp', got.join(','));
    const same = got.length === expectSrc.length && got.every((f, i) => sha(path.join(chap, f)) === sha(path.join(FAKE, expectSrc[i])));
    ok('Link: conteúdo e ordem do documento preservados (lazy data-src/data-original, srcset maior, noscript, picture, relativa, dupla no meio)', same);
    ok('Link: duplicadas (mesma URL e mesmo conteúdo) e iscas (logo, botões, avatar, banner, miniaturas, capa relacionada, quadrada, larga, minúscula, GIF, SVG) não entram', !got.some((f) => ['logo.png', 'thumb1.jpg', 'related.jpg', 'anim.gif'].includes(f)) && got.length === 11);
    const reqs = log.slice(nBefore).filter((e) => !e.page);
    ok('Link: Referer da página enviado em todas as imagens e User-Agent educado identificado', reqs.length > 20 && reqs.every((e) => e.referer === HOST + '/cap/ok') && reqs.every((e) => /Yomuchu/.test(e.ua)), `${reqs.length} pedidos`);
    ok('Link: primeiro lê só o cabeçalho (Range) de cada candidata e baixa inteiro apenas as escolhidas (+ a cópia idêntica que o hash descarta)', reqs.filter((e) => e.range).length >= 25 && reqs.filter((e) => !e.range).length === 12, `${reqs.filter((e) => e.range).length} com Range, ${reqs.filter((e) => !e.range).length} completos (11 páginas + 1 cópia idêntica descartada pelo hash)`);
    const st = await rstate(rd);
    const pg = await rd.evaluate(() => ({ n: __reader.n, w: __reader.pages[4].w, h: __reader.pages[4].h, title: document.querySelector('#titleName').textContent, series: document.querySelector('#seriesName').textContent }));
    ok('Link: o resultado abre no leitor como uma pasta local (11 páginas, dupla detectada, título e série)', st.n === 11 && st.folder === chap && pg.w === 1600 && pg.h === 1200 && pg.title === 'Capítulo 12 & teste – Site' && pg.series === 'Baixados de links', JSON.stringify(pg));
    const meta = JSON.parse(fs.readFileSync(path.join(chap, '.yomuchu-link.json'), 'utf8'));
    ok('Link: metadados guardam o endereço de origem (para reabrir/rebaixar)', meta.url === HOST + '/cap/ok' && meta.pages === 11);
    await rd.keyboard.press('Home'); await waitIdle(rd); await rd.keyboard.press('ArrowLeft'); await waitIdle(rd); await sleep(300);
    // biblioteca mostra o volume
    await lib.evaluate(() => load()); await sleep(1000);
    const libSeries = await lib.evaluate(() => { const s = __libState.data.items.find((i) => i.isLinks); return s && { title: s.title, vols: s.volumes.map((v) => v.title + '|' + v.pages + '|' + !!v.downloaded) }; });
    ok('Link: biblioteca ganha a série "Baixados de links" com o capítulo (para reabrir)', libSeries && libSeries.title === 'Baixados de links' && libSeries.vols.join() === 'Capítulo 12 & teste – Site|11|true', JSON.stringify(libSeries));
    await lib.bringToFront().catch(() => {});
    await lib.evaluate(() => { document.querySelector('.card.series').click(); }); await sleep(500);
    const inSeries = await lib.evaluate(() => ({ crumb: document.querySelector('#crumbs .cur').textContent, cards: document.querySelectorAll('#grid .card').length, clearBtn: !document.querySelector('#btnClearLinks2').classList.contains('hidden') }));
    await lib.screenshot({ path: path.join(SHOTS, 'link-biblioteca.png') });
    ok('Link: dentro da série aparece o botão "Apagar baixados" e o volume reabre pelo cartão', inSeries.crumb === 'Baixados de links' && inSeries.cards === 1 && inSeries.clearBtn, JSON.stringify(inSeries));
    await lib.evaluate(() => { __libState.series = null; render(); });
    // reabrir o volume baixado pela biblioteca
    await lib.evaluate((p) => window.mangaAPI.openReader(p), LOOSE);
    await rd.waitForFunction((p) => __reader.folder === p, LOOSE, { timeout: 10000 }); await sleep(500);
    const reopen = await lib.evaluate((p) => window.mangaAPI.openReader(p, {}), chap);
    await rd.waitForFunction((p) => __reader.folder === p, chap, { timeout: 10000 });
    ok('Link: capítulo baixado reabre sem a internet (arquivos locais)', reopen.ok && reopen.pages === 11);

    // ---------- 5) página renderizada por JavaScript, poucas páginas, bloqueio, 404, redirecionamento perigoso
    const js = await start('/cap/js');
    const jsDir = js.ok ? files(js.folder) : [];
    ok('Link: página que monta as imagens por JavaScript usa a janela oculta e acha as 7 páginas, em ordem', js.ok && js.usedRender === true && jsDir.length === 7 && jsDir.every((f, i) => sha(path.join(js.folder, f)) === sha(path.join(FAKE, jsPages[i] + '.jpg'))), JSON.stringify({ ...js, folder: undefined }));
    const two = await start('/cap/two');
    ok('Link: capítulo de só 2 páginas é aceito (tenta a janela oculta, mantém as 2)', two.ok && two.pages === 2 && files(two.folder).join() === '001.jpg,002.jpg', JSON.stringify(two));
    const few = await start('/cap/few');
    ok('Link: página sem nenhuma imagem de capítulo devolve o código noPages', few.ok === false && few.code === 'noPages', JSON.stringify(few));
    const blk = await start('/cap/blocked');
    ok('Link: site que responde 403 devolve "blocked" (não tenta burlar)', blk.ok === false && blk.code === 'blocked' && /403/.test(blk.detail), JSON.stringify(blk));
    const miss = await start('/cap/missing');
    ok('Link: 404 devolve erro http claro', miss.ok === false && miss.code === 'http' && /404/.test(miss.detail), JSON.stringify(miss));
    const logN = log.length;
    const rdr = await start('/cap/redir');
    ok('Link (segurança): redirecionamento para file:// é recusado', rdr.ok === false && rdr.code === 'badUrl' && log.length === logN + 1, JSON.stringify(rdr));
    ok('Link: nada de pasta temporária (.tmp-) sobra depois de erros', dlDirs().every((d) => !d.startsWith('.tmp-')), dlDirs().join('|'));
    // mensagem na interface para "nenhuma página" e "bloqueado"
    await lib.click('#btnOpenLink'); await sleep(200);
    await lib.fill('#linkUrl', HOST + '/cap/few'); await lib.click('#linkGo');
    await lib.waitForFunction(() => !document.querySelector('#linkMsg').classList.contains('hidden'), null, { timeout: 30000 });
    const fewMsg = await lib.textContent('#linkMsg');
    await lib.screenshot({ path: path.join(SHOTS, 'link-erro.png') });
    ok('Link: mensagem clara na interface quando nenhuma página é encontrada', /Nenhuma página de capítulo/.test(fewMsg) && (await lib.isVisible('#linkGo')), fewMsg);
    await lib.fill('#linkUrl', HOST + '/cap/blocked'); await lib.click('#linkGo');
    await lib.waitForFunction(() => /bloqueou/.test(document.querySelector('#linkMsg').textContent), null, { timeout: 30000 });
    ok('Link: mensagem clara quando o site bloqueia, avisando que o app não contorna login/captcha', /não contorna login, captcha/.test(await lib.textContent('#linkMsg')));
    await lib.keyboard.press('Escape'); await sleep(200);
    ok('Link: Esc fecha o diálogo quando não há download', await lib.evaluate(() => document.querySelector('#linkDlg').classList.contains('hidden')));

    // ---------- 6) barra de progresso e cancelar
    await lib.click('#btnOpenLink'); await sleep(200);
    await lib.fill('#linkUrl', HOST + '/cap/slow'); await lib.click('#linkGo');
    const samples = [];
    let shot = false;
    for (let i = 0; i < 400; i++) {
      const s = await lib.evaluate(() => { const b = document.querySelector('#linkBar'); return { v: +b.getAttribute('aria-valuenow'), ph: b.dataset.phase, txt: document.querySelector('#linkStatus').textContent, vis: !document.querySelector('#linkProg').classList.contains('hidden'), w: b.firstElementChild.style.width }; });
      samples.push(s);
      if (!shot && s.ph === 'download' && s.v >= 45) { shot = true; await lib.screenshot({ path: path.join(SHOTS, 'link-progresso.png') }); }
      if (!s.vis && samples.length > 3) break;
      await sleep(120);
    }
    await rd.waitForFunction((d) => (window.__reader.folder || '').includes('Lento'), null, { timeout: 30000 });
    const vals = samples.filter((s) => s.vis).map((s) => s.v);
    const mono = vals.every((v, i) => i === 0 || v >= vals[i - 1]);
    const phases = [...new Set(samples.filter((s) => s.vis).map((s) => s.ph))];
    ok('Link: barra de progresso sobe de forma contínua (fases leitura → análise → download) e o diálogo fecha ao terminar', mono && vals.length >= 5 && Math.max(...vals) >= 80 && phases.includes('probe') && phases.includes('download') && new Set(vals).size >= 5, `${vals.length} amostras, valores ${[...new Set(vals)].join(',')}, fases ${phases}`);
    ok('Link: texto de status mostra "Baixando páginas (n/10)" em português', samples.some((s) => /^Baixando páginas \(\d+\/10\)/.test(s.txt)), samples.find((s) => s.ph === 'download')?.txt);
    await rd.keyboard.press('Home'); await sleep(300);
    // ---------- 6b) 0.3.1: botão "Abrir pasta" (estado concluído do diálogo, configurações, série)
    {
      const openedDirs = () => lib.evaluate(() => window.mangaAPI.testOpenedDirs());
      const realDL = fs.realpathSync(DL);
      await lib.bringToFront().catch(() => {});
      const done = await lib.evaluate(() => ({ vis: !document.querySelector('#linkDlg').classList.contains('hidden'), open: !document.querySelector('#linkOpenDir').classList.contains('hidden'), openTxt: document.querySelector('#linkOpenDir').textContent, go: !document.querySelector('#linkGo').classList.contains('hidden'), msg: document.querySelector('#linkMsg').textContent, close: document.querySelector('#linkClose').textContent }));
      await lib.screenshot({ path: path.join(SHOTS, 'link-pasta.png') });
      ok('Abrir pasta: ao terminar o download o diálogo mostra "Abrir pasta" no estado concluído (e some o "Baixar e abrir")', done.vis && done.open && done.openTxt === 'Abrir pasta' && !done.go && /10 páginas baixadas/.test(done.msg) && done.close === 'Fechar', JSON.stringify(done));
      const before = (await openedDirs()).length;
      await lib.click('#linkOpenDir'); await sleep(300);
      const od = await openedDirs();
      const last = od[od.length - 1];
      ok('Abrir pasta (diálogo): abre a pasta do capítulo que acabou de ser baixado, dentro de "baixados"', od.length === before + 1 && last.mode === 'chapter' && last.path.startsWith(realDL + path.sep) && /Lento/.test(last.path) && fs.statSync(last.path).isDirectory(), JSON.stringify(last));
      await lib.keyboard.press('Escape'); await sleep(200);
      ok('Abrir pasta: Esc fecha o diálogo concluído e, ao reabrir, ele volta ao estado normal', await lib.evaluate(() => { const hid = document.querySelector('#linkDlg').classList.contains('hidden'); openLinkDlg(); const r = { hid, go: !document.querySelector('#linkGo').classList.contains('hidden'), open: document.querySelector('#linkOpenDir').classList.contains('hidden'), msg: document.querySelector('#linkMsg').classList.contains('hidden'), close: document.querySelector('#linkClose').textContent }; linkClose(); return r.hid && r.go && r.open && r.msg && r.close === 'Cancelar'; }));
      // configurações: ao lado de "Apagar baixados"
      await lib.click('#btnSettings'); await sleep(250);
      const adj = await lib.evaluate(() => { const a = document.querySelector('#btnOpenDl'), b = document.querySelector('#btnClearLinks'); return { same: a.parentElement === b.parentElement, vis: a.offsetWidth > 0, txt: a.textContent }; });
      await lib.click('#btnOpenDl'); await sleep(300);
      const od2 = await openedDirs(); const l2 = od2[od2.length - 1];
      ok('Abrir pasta (configurações): botão ao lado de "Apagar baixados" abre a pasta "baixados"', adj.same && adj.vis && adj.txt === 'Abrir pasta' && l2.mode === 'dir' && l2.path === realDL, JSON.stringify({ adj, l2 }));
      await lib.keyboard.press('Escape'); await sleep(200);
      // série "Baixados de links"
      await lib.evaluate(() => load()); await sleep(800);
      await lib.evaluate(() => { document.querySelector('.card.series').click(); }); await sleep(500);
      const hdr = await lib.evaluate(() => { const a = document.querySelector('#btnOpenDl2'), b = document.querySelector('#btnClearLinks2'); return { same: a.parentElement === b.parentElement, vis: a.offsetWidth > 0, txt: a.textContent }; });
      await lib.click('#btnOpenDl2'); await sleep(300);
      const od3 = await openedDirs(); const l3 = od3[od3.length - 1];
      ok('Abrir pasta (série "Baixados de links"): botão ao lado de "Apagar baixados" abre a pasta "baixados"', hdr.same && hdr.vis && hdr.txt === 'Abrir pasta' && l3.mode === 'dir' && l3.path === realDL && od3.length === before + 3, JSON.stringify({ hdr, l3 }));
      await lib.evaluate(() => { __libState.series = null; render(); });
      // segurança: caminhos fora de "baixados" são recusados e nada é aberto
      const nOpen = (await openedDirs()).length;
      const link = path.join(DL, 'atalho-fora'); try { fs.symlinkSync(path.dirname(LOOSE), link); } catch (e) {}
      const bad = await lib.evaluate(async (a) => { const r = {}; for (const [k, v] of Object.entries(a)) r[k] = (await window.mangaAPI.openDownloadsDir(v)).ok; return r; },
        { loose: LOOSE, etc: '/etc', up: path.join(DL, '..'), trav: path.join(DL, 'Lento', '..', '..'), self: DL, link, missing: path.join(DL, 'nao-existe'), file: path.join(DL, '.yomuchu-nada') });
      try { fs.unlinkSync(link); } catch (e) {}
      ok('Abrir pasta (segurança): fora de "baixados" (pasta avulsa, /etc, "..", atalho simbólico, inexistente) é recusado e nada abre', Object.values(bad).every((v) => v === false) && (await openedDirs()).length === nOpen, JSON.stringify(bad));
    }

    // cancelar
    const slowReqs0 = log.filter((e) => e.path.startsWith('/slow/') && !e.range).length;
    await lib.evaluate(() => { document.querySelector('#linkUrl').value = ''; });
    await lib.bringToFront().catch(() => {});
    await lib.click('#btnOpenLink'); await sleep(200);
    await lib.fill('#linkUrl', HOST + '/cap/slow'); await lib.click('#linkGo');
    await lib.waitForFunction(() => document.querySelector('#linkBar').dataset.phase === 'download', null, { timeout: 30000 });
    const busy = await lib.evaluate(() => window.mangaAPI.startLink('http://127.0.0.1:9/'));
    ok('Link: um segundo download simultâneo é recusado (busy)', busy.ok === false && busy.code === 'busy');
    await lib.screenshot({ path: path.join(SHOTS, 'link-cancelar.png') });
    await lib.click('#linkAbort');
    await lib.waitForFunction(() => !document.querySelector('#linkMsg').classList.contains('hidden'), null, { timeout: 10000 });
    await sleep(900);
    const cancelMsg = await lib.textContent('#linkMsg');
    const fullAfter = log.filter((e) => e.path.startsWith('/slow/') && !e.range).length - slowReqs0;
    ok('Link: Cancelar interrompe o download, mostra "Download cancelado." e libera o diálogo', /Download cancelado/.test(cancelMsg) && (await lib.isVisible('#linkGo')) && !(await lib.isVisible('#linkAbort')), cancelMsg);
    ok('Link: cancelar não baixa o capítulo todo e não deixa pasta temporária', fullAfter < 10 && dlDirs().every((d) => !d.startsWith('.tmp-')), `${fullAfter} downloads completos iniciados de 10; ${dlDirs().join('|')}`);
    const reLaunch = await start('/cap/two');
    ok('Link: depois de cancelar um novo download funciona (sem travar em "busy")', reLaunch.ok === true);
    await lib.keyboard.press('Escape'); await sleep(200);

    // ---------- 7) apagar cache, segurança da exclusão, traduções, README
    const outside = await lib.evaluate((p) => window.mangaAPI.deleteDownload(p), LOOSE);
    ok('Link (segurança): excluir só funciona dentro de "baixados" (pasta avulsa fica intacta)', outside === false && fs.existsSync(LOOSE));
    const info = await lib.evaluate(() => window.mangaAPI.linkCacheInfo());
    await lib.click('#btnSettings'); await sleep(300);
    const cacheTxt = await lib.textContent('#linkCacheInfo');
    ok('Link: Configurações mostram quantos capítulos e quanto espaço os baixados ocupam', info.count >= 3 && info.bytes > 100000 && new RegExp(`^${info.count} capítulos · `).test(cacheTxt), `${cacheTxt}`);
    await lib.keyboard.press('Escape'); await sleep(200);
    await lib.evaluate(() => load()); await sleep(800);
    const delOne = await lib.evaluate(async (p) => { const r = await window.mangaAPI.deleteDownload(p); return r; }, path.join(DL, 'Capítulo Curto'));
    ok('Link: apagar um capítulo baixado remove só ele', delOne === true && !fs.existsSync(path.join(DL, 'Capítulo Curto')) && fs.existsSync(chap));
    await lib.click('#btnSettings'); await sleep(250);
    await lib.click('#btnClearLinks'); await sleep(300);
    const conf = await lib.evaluate(() => ({ vis: !document.querySelector('#confirm').classList.contains('hidden'), t: document.querySelector('#confirmTitle').textContent }));
    await lib.click('#confirmNo'); await sleep(200);
    ok('Link: "Apagar baixados" pede confirmação e cancelar não apaga', conf.vis && conf.t === 'Apagar os downloads?' && fs.existsSync(chap));
    await lib.click('#btnClearLinks'); await sleep(250); await lib.click('#confirmYes'); await sleep(800);
    const left = dlDirs();
    const gone = await lib.evaluate(() => !__libState.data.items.some((i) => i.isLinks));
    ok('Link: "Apagar baixados" remove tudo, tira a série da biblioteca e o progresso dos capítulos', left.length === 0 && gone && !Object.keys(readCfg().progress).some((k) => k.includes('baixados')), left.join('|'));
    {
      const gone0 = !fs.existsSync(DL);
      const r0 = await lib.evaluate(() => window.mangaAPI.openDownloadsDir());
      const od = await lib.evaluate(() => window.mangaAPI.testOpenedDirs());
      ok('Abrir pasta: se "baixados" ainda não existe, a pasta é criada antes de abrir', gone0 && r0.ok && fs.existsSync(DL) && od[od.length - 1].mode === 'dir' && od[od.length - 1].path === fs.realpathSync(DL), JSON.stringify({ gone0, r0 }));
    }
    await lib.keyboard.press('Escape'); await sleep(200);
    // reabrir pasta avulsa para os próximos blocos
    await lib.evaluate((p) => window.mangaAPI.openReader(p), LOOSE);
    await rd.waitForFunction((p) => __reader.folder === p, LOOSE, { timeout: 10000 }); await sleep(800);
    await lib.evaluate(() => load()); await sleep(800);
    // traduções
    const LK = ['lib.openLink', 'lib.openLinkTip', 'link.title', 'link.text', 'link.ph', 'link.legal', 'link.start', 'link.abort', 'link.p.page', 'link.p.render', 'link.p.probe', 'link.p.download', 'link.p.save', 'link.e.badUrl', 'link.e.noPages', 'link.e.blocked', 'link.e.http', 'link.e.network', 'link.e.tooBig', 'link.e.cancelled', 'link.e.busy', 'link.e.other', 'link.done', 'link.doneSkip', 'links.series', 'links.clear', 'links.setTitle', 'links.cacheInfo', 'links.cacheEmpty', 'links.confirmTitle', 'links.confirmText', 'links.confirmOneTitle', 'links.deleteOne', 'links.cleared'];
    const LD = path.join(ROOT, 'src', 'locales');
    const locs = fs.readdirSync(LD).filter((f) => f.endsWith('.json')).map((f) => [f, JSON.parse(fs.readFileSync(path.join(LD, f), 'utf8'))]);
    const en = locs.find(([f]) => f === 'en.json')[1];
    const ph = (s) => (String(s).match(/\{\w+\}/g) || []).sort().join();
    const missK = locs.flatMap(([f, d]) => LK.filter((k) => !d[k] || ph(d[k]) !== ph(en[k])).map((k) => f + ':' + k));
    ok(`Link: ${LK.length} textos novos traduzidos nos 18 idiomas (com os mesmos {marcadores})`, locs.length === 18 && missK.length === 0 && new Set(locs.map(([, d]) => d['link.legal'])).size === 18, missK.slice(0, 5).join(','));
    ok('Abrir pasta: rótulo traduzido nos 18 idiomas e chaves iguais em todos os arquivos', locs.length === 18 && locs.every(([, d]) => d['links.openDir'] && Object.keys(d).length === Object.keys(en).length && Object.keys(en).every((k) => k in d)) && new Set(locs.map(([, d]) => d['links.openDir'])).size === 18 && en['links.openDir'] === 'Open folder', locs.filter(([, d]) => !d['links.openDir']).map(([f]) => f).join())
    ok('Link: aviso de direito de leitura no README', /direito de ler/.test(fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8')) && /Abrir link/.test(fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8')));
    server.close();
  }

  // ---- Yomuchu 0.2: nome, ícone, idiomas, RTL, doação, limpar histórico
  ok('Título da janela e do app é Yomuchu', /^Yomuchu/.test(await lib.title()) && (await app.evaluate(({ app }) => app.getName())) === 'Yomuchu', await lib.title());
  const fav = await lib.evaluate(() => new Promise((r) => { const i = new Image(); i.onload = () => r(i.naturalWidth); i.onerror = () => r(0); i.src = '../favicon.png'; }));
  ok('Favicon (logo novo) carrega com 64 px', fav === 64, `${fav}px`);
  {
    // ---- 0.4.1: logo novo (um só arquivo) -> todos os ícones
    const pngSize = (f) => { const b = fs.readFileSync(f); return b.slice(0, 8).toString('hex') === '89504e470d0a1a0a' ? [b.readUInt32BE(16), b.readUInt32BE(20), b[25]] : null; }; // [w, h, tipo de cor]
    const B = path.join(ROOT, 'build');
    const want = { 'build/icon.png': 512, 'build/icon-512.png': 512, 'build/icon-small.png': 32, 'src/favicon.png': 64, 'src/logo.png': 192 };
    for (const n of [16, 24, 32, 48, 64, 128, 256, 512]) want[`build/icons/${n}x${n}.png`] = n;
    const bad = Object.entries(want).filter(([f, n]) => { try { const z = pngSize(path.join(ROOT, f)); return !z || z[0] !== n || z[1] !== n || z[2] !== 6; } catch (e) { return true; } }).map(([f]) => f);
    ok('Ícones: todos os PNG gerados existem, são RGBA e têm o tamanho esperado (16–512, icon-small 32, favicon 64, logo 192)', bad.length === 0, bad.join(','));
    const srcDirIco = path.join(B, 'icones-fonte');
    const readIco = (f) => { const b = fs.readFileSync(f); const n = b.readUInt16LE(4); const out = []; for (let i = 0; i < n; i++) { const o = 6 + 16 * i; const w = b[o] || 256, h = b[o + 1] || 256, len = b.readUInt32LE(o + 8), off = b.readUInt32LE(o + 12); const data = b.slice(off, off + len); const png = data.slice(0, 8).toString('hex') === '89504e470d0a1a0a'; out.push({ w, h, png, data, iw: png ? data.readUInt32BE(16) : data.readInt32LE(4), ih: png ? data.readUInt32BE(20) : data.readInt32LE(8) / 2, bpp: png ? 32 : data.readUInt16LE(14) }); } return { n, type: b.readUInt16LE(2), res: b.readUInt16LE(0), frames: out }; };
    const ico = readIco(path.join(B, 'icon.ico')), usr = readIco(path.join(srcDirIco, 'favicon-yomuchu.ico'));
    const sha1 = (b) => require('crypto').createHash('sha1').update(b).digest('hex');
    ok('Ícones: icon.ico tem os 7 tamanhos (16, 24, 32, 48, 64, 128, 256), cada um com seu próprio quadro real (PNG ou BMP) do mesmo tamanho, 32 bits (não uma imagem só esticada)', ico.res === 0 && ico.type === 1 && ico.n === 7 && ico.frames.map((f) => f.w).join() === '16,24,32,48,64,128,256' && ico.frames.every((f) => f.w === f.h && f.iw === f.w && f.ih === f.h && f.bpp === 32) && new Set(ico.frames.map((f) => sha1(f.data))).size === 7, JSON.stringify(ico.frames.map((f) => `${f.w}${f.png ? 'png' : 'bmp'}`)));
    ok('Ícones: o .ico do usuário (16, 32, 48, 64, 128, 256) é a fonte da verdade — seus 6 quadros estão em build/icon.ico sem nenhuma alteração (só o de 24 px foi acrescentado)', usr.n === 6 && usr.frames.map((f) => f.w).join() === '16,32,48,64,128,256' && usr.frames.every((f) => ico.frames.some((g) => g.w === f.w && g.data.equals(f.data))) && ico.frames.find((f) => f.w === 24).png);
    ok('Ícones: os PNG de 16, 32, 48, 64, 128 e 256 são os quadros do .ico do usuário (mesmo conteúdo)', await (async () => { const { execSync: ex } = require('child_process'); const r = ex(`python3 - <<'PY'
from PIL import Image
import os
ico = Image.open('${path.join(srcDirIco, 'favicon-yomuchu.ico')}')
bad = []
for n in (16, 32, 48, 64, 128, 256):
    a = ico.ico.getimage((n, n)).convert('RGBA'); b = Image.open('${B}/icons/%dx%d.png' % (n, n)).convert('RGBA')
    if a.tobytes() != b.tobytes(): bad.append(n)
print(','.join(map(str, bad)) or 'ok')
PY`).toString().trim(); return r === 'ok'; })());
    const same = (a, b) => fs.readFileSync(path.join(ROOT, a)).equals(fs.readFileSync(path.join(ROOT, b)));
    ok('Ícones: icon.png = icons/512x512.png e icon-small.png = icons/32x32.png (um logo só em todos os usos)', same('build/icon.png', 'build/icons/512x512.png') && same('build/icon-small.png', 'build/icons/32x32.png'));
    const srcDir = path.join(B, 'icones-fonte');
    const leia = fs.readFileSync(path.join(srcDir, 'LEIA-ME.md'), 'utf8');
    ok('Ícones: fontes guardadas em icones-fonte/ (favicon-yomuchu.ico do usuário, yomuchu-logo.png 512×512 RGBA) e os dois desenhos antigos em anteriores/; LEIA-ME em português descreve tudo', (() => { const z = pngSize(path.join(srcDir, 'yomuchu-logo.png')); return z && z[0] === 512 && z[1] === 512 && z[2] === 6; })() && fs.existsSync(path.join(srcDir, 'anteriores', 'iconeYomuchu.png')) && fs.existsSync(path.join(srcDir, 'anteriores', 'livrovazio.png')) && !fs.existsSync(path.join(srcDir, 'iconeYomuchu.png')) && /favicon-yomuchu\.ico/.test(leia) && /yomuchu-logo\.png/.test(leia) && /anteriores/.test(leia) && /24 px/.test(leia));
    const gen = fs.readFileSync(path.join(ROOT, 'tools', 'gerar_icones.py'), 'utf8');
    ok('Ícones: gerar_icones.py prefere o .ico do usuário (plano B: só o logo) e não usa mais os desenhos antigos', /USER_ICO/.test(gen) && /favicon-yomuchu\.ico/.test(gen) && /yomuchu-logo\.png/.test(gen) && !/livrovazio|iconeYomuchu/.test(gen.replace(/^"""[\s\S]*?"""/, '')));
    const pk = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).build;
    const refs = [pk.win.icon, pk.nsis.installerIcon, pk.nsis.uninstallerIcon, pk.linux.icon, ...pk.files.filter((f) => /^build\//.test(f))];
    ok('Ícones: package.json (ícone do Windows, instalador, desinstalador, Linux, arquivos empacotados) aponta só para arquivos que existem', refs.every((r) => fs.existsSync(path.join(ROOT, r))) && pk.win.icon === 'build/icon.ico' && pk.nsis.installerIcon === 'build/icon.ico' && pk.nsis.uninstallerIcon === 'build/icon.ico', refs.join(','));
    const winIcon = await app.evaluate(({ nativeImage }, p) => { const i = nativeImage.createFromPath(p); return { empty: i.isEmpty(), size: i.getSize() }; }, path.join(B, 'icon.png'));
    ok('Ícones: o ícone das janelas (build/icon.png) carrega no processo principal com 512 px', !winIcon.empty && winIcon.size.width === 512, JSON.stringify(winIcon));
    const hdr = await lib.evaluate(() => { const i = document.querySelector('.topbar img.logo'); const d = document.querySelector('.donate-logo'); const lk = [...document.querySelectorAll('link[rel=icon]')].map((l) => l.getAttribute('href')); return { w: i && i.naturalWidth, shown: i && i.getBoundingClientRect().width, oldSvg: !!document.querySelector('svg.logo'), donate: d && d.getAttribute('src'), lk }; });
    const rdIcon = await rd.evaluate(() => [...document.querySelectorAll('link[rel=icon]')].map((l) => l.getAttribute('href')));
    ok('Ícones: o cabeçalho da biblioteca mostra o logo novo (imagem 192 px, sem o SVG antigo), a tela Doar usa o mesmo logo e as duas janelas apontam o favicon novo', hdr.w === 192 && hdr.shown === 46 && !hdr.oldSvg && hdr.donate === '../logo.png' && hdr.lk.join() === '../favicon.png' && rdIcon.join() === '../favicon.png', JSON.stringify([hdr, rdIcon]));
    await lib.locator('.brand').screenshot({ path: path.join(SHOTS, 'logo-cabecalho.png') });
    ok('Ícones: README documenta o .ico do usuário, o logo e o script', /favicon-yomuchu\.ico/.test(fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8')) && /yomuchu-logo\.png/.test(fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8')) && !/livrovazio\.png`\s*\(pequeno\)/.test(fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8')));
  }
  ok('Idioma padrão segue o sistema (pt-BR)', (await lib.textContent('.h1sub')) === 'Biblioteca' && (await lib.evaluate(() => document.documentElement.dir)) === 'ltr');
  await lib.click('#btnSettings'); await sleep(250);
  const langs = await lib.$$eval('#setLang option', (o) => o.map((x) => x.value));
  const NEED = ['pt-BR', 'en', 'ja', 'zh-CN', 'ru', 'es', 'fr', 'de', 'ko', 'ar', 'hi', 'it', 'tr', 'id', 'vi', 'th', 'pl', 'nl'];
  ok('Seletor de idioma lista os 18 idiomas + automático', NEED.every((c) => langs.includes(c)) && langs[0] === '' && langs.length === 19, langs.join(','));
  // percorre todos os idiomas: nenhuma chave sem tradução aparece na tela
  const untranslated = {};
  for (const code of NEED) {
    await lib.selectOption('#setLang', code); await sleep(120);
    const bad = await lib.evaluate(() => [...document.querySelectorAll('[data-i18n],[data-i18n-html]')].filter((e) => /^[a-z]+\.[a-zA-Z]+$/.test(e.textContent.trim())).map((e) => e.textContent));
    const lang = await lib.evaluate(() => document.documentElement.lang);
    if (bad.length || lang !== code) untranslated[code] = bad.length ? bad : 'lang=' + lang;
  }
  ok('Todos os idiomas aplicam sem textos faltando', Object.keys(untranslated).length === 0, JSON.stringify(untranslated));
  await lib.selectOption('#setLang', 'ja'); await sleep(200);
  ok('Trocar para japonês traduz biblioteca e leitor na hora', (await lib.textContent('.h1sub')) === 'ライブラリ'
    && (await rd.textContent('#btnLibrary span')) === 'ライブラリ' && (await rd.getAttribute('#btnFull', 'title')) === '全画面 (F11)',
    `${await lib.textContent('.h1sub')} / ${await rd.textContent('#btnLibrary span')}`);
  await lib.selectOption('#setLang', 'ar'); await sleep(250);
  const rtlLib = await lib.evaluate(() => ({ dir: document.documentElement.dir, cs: getComputedStyle(document.querySelector('.topbar')).direction, h: document.querySelector('.h1sub').textContent }));
  const rtlRd = await rd.evaluate(() => ({ top: getComputedStyle(document.querySelector('#topbar')).direction, stage: getComputedStyle(document.querySelector('#stage')).direction, k: __reader.k, dir: __reader.dir }));
  ok('Árabe: biblioteca em layout RTL', rtlLib.dir === 'rtl' && rtlLib.cs === 'rtl' && rtlLib.h === 'المكتبة', JSON.stringify(rtlLib));
  ok('Árabe: barras do leitor em RTL, livro intacto (direção de leitura não muda)', rtlRd.top === 'rtl' && rtlRd.stage === 'ltr' && rtlRd.dir === 'rtl', JSON.stringify(rtlRd));
  await lib.screenshot({ path: path.join(SHOTS, 'config-arabe.png') });
  await sleep(500);
  ok('Idioma escolhido salvo na configuração', readCfg().settings.language === 'ar');
  // doação
  await lib.click('#tabDonate'); await sleep(200);
  ok('Aba Doar visível e traduzida', await lib.isVisible('#lnkDonate') && (await lib.textContent('#tabDonate')) === 'تبرّع');
  await lib.screenshot({ path: path.join(SHOTS, 'doar-arabe.png') });
  await lib.selectOption('#setLang', 'pt-BR').catch(() => {});
  await lib.evaluate(() => window.mangaAPI.setLanguage('pt-BR').then((p) => { I18N.set(p); I18N.apply(); }));
  await sleep(200);
  await lib.click('#lnkDonate'); await lib.click('#lnkGithub'); await lib.click('#lnkSite'); await sleep(200);
  const opened = await lib.evaluate(() => window.mangaAPI.testOpenedLinks());
  ok('Botões de doação abrem os links certos (shell.openExternal)', JSON.stringify(opened) === JSON.stringify(['https://www.bugzinho.com/donate', 'https://github.com/cleitinhodev/', 'https://www.bugzinho.com/']), JSON.stringify(opened));
  const evil = await lib.evaluate(() => window.mangaAPI.openLink('https://example.com/'));
  ok('Links fora da lista são recusados', evil === false);
  await lib.screenshot({ path: path.join(SHOTS, 'doar.png') });
  await lib.keyboard.press('Escape'); await sleep(200);
  // ---- 0.4.0: temas (escuro/claro/sistema), paleta da marca, fundo do leitor, papel envelhecido (sépia)
  {
    const fsx = require('fs');
    const L = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
    const CR = (a, b) => { const x = L(a), y = L(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
    const rgbOf = (s) => (String(s).match(/[\d.]+/g) || []).slice(0, 3).map(Number);
    const probe = (page, names) => page.evaluate((ns) => { const o = {}; const p = document.createElement('i'); document.body.appendChild(p); for (const n of ns) { p.style.color = 'var(' + n + ')'; o[n] = getComputedStyle(p).color; } p.remove(); return o; }, names);
    const themeOf = (page) => page.evaluate(() => ({ t: document.documentElement.dataset.theme, pref: document.documentElement.dataset.themePref, cs: document.documentElement.style.colorScheme }));
    const rdBox = async () => { const b = await winBounds(app, 'reader.html'); const x = Math.max(0, b.x), y = Math.max(0, b.y); return { x, y, width: Math.min(1600 - x, b.width), height: Math.min(1000 - y, b.height) }; };
    const front = async (which) => { await app.evaluate(({ BrowserWindow }, w) => { const x = BrowserWindow.getAllWindows().find((q) => q.webContents.getURL().includes(w)); if (x.isMinimized()) x.restore(); x.show(); x.focus(); }, which); await sleep(450); };
    const openLook = async () => { if (await lib.isHidden('#settings')) await lib.click('#btnSettings'); await sleep(150); await lib.click('#tabLook'); await sleep(200); };
    const bdCss = async () => { await sleep(700); return rd.evaluate(() => { const b = document.querySelector('#backdrop'), cs = getComputedStyle(b); return { bg: cs.backgroundColor, img: cs.backgroundImage, op: cs.opacity, custom: document.body.classList.contains('bd-custom'), trans: document.body.classList.contains('bd-transparent') }; }); };
    const filt = () => rd.evaluate(() => { const g = (q) => getComputedStyle(document.querySelector(q)).filter; return { slotL: g('#slotL'), slotR: g('#slotR'), stack: g('.stack.left'), faceF: g('#leaf .strip .face.f'), faceB: g('#leaf .strip .face.b'), v: document.documentElement.style.getPropertyValue('--page-filter') }; });

    ok('Leitor: o título do livro continua na barra depois de trocar de idioma (não volta para "Carregando…")', (await rd.textContent('#titleName')) === (await rd.evaluate(() => __reader.title)) && !/Carregando/.test(await rd.textContent('#titleName')), await rd.textContent('#titleName'));
    // 1) paleta da marca num lugar só + contraste
    const css = fsx.readFileSync(path.join(ROOT, 'src', 'shared', 'theme.css'), 'utf8');
    ok('Paleta: as 3 cores da marca (#c210ef, #5623ab, #4ffff0) ficam no topo de theme.css, num lugar só', /--lilac:\s*#c210ef/i.test(css) && /--purple:\s*#5623ab/i.test(css) && /--aqua:\s*#4ffff0/i.test(css) && css.indexOf('--lilac') < css.indexOf('--bg:') && /ONDE MUDAR AS CORES/.test(css));
    const readme = fsx.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
    ok('Paleta: README explica "onde mudar as cores"', /onde mudar as cores/i.test(readme) && /theme\.css/.test(readme) && /#c210ef/i.test(readme));
    const cfg0 = readCfg().settings;
    ok('Tema escuro é o padrão (configuração, biblioteca e leitor)', cfg0.theme === 'dark' && (await themeOf(lib)).t === 'dark' && (await themeOf(rd)).t === 'dark' && cfg0.backdrop === 'default' && cfg0.sepia === false, JSON.stringify([cfg0.theme, await themeOf(lib)]));
    const PAIRS = [['--on-accent', '--lilac', 4.5], ['--on-accent', '--purple', 4.5], ['--text', '--bg', 4.5], ['--text', '--bg2', 4.5], ['--text', '--panel', 4.5], ['--text', '--raised', 4.5], ['--muted', '--bg', 4.5], ['--muted', '--bg2', 4.5], ['--muted', '--panel', 4.5], ['--link', '--bg', 4.5], ['--link', '--bg2', 4.5], ['--hl', '--bg', 4.5], ['--focus', '--bg', 3], ['--lilac', '--bg', 3]];
    const NAMES = [...new Set(PAIRS.flat().filter((x) => typeof x === 'string').concat(['--lilac', '--purple', '--aqua']))];
    const contrastReport = async (page) => { const c = await probe(page, NAMES); const bad = []; let min = 99; for (const [a, b, need] of PAIRS) { const r = CR(rgbOf(c[a]), rgbOf(c[b])); min = Math.min(min, r / need * 4.5); if (r < need) bad.push(`${a} em ${b}: ${r.toFixed(2)} < ${need}`); } return { bad, c }; };
    const prDark = await contrastReport(lib), prDarkRd = await contrastReport(rd);
    const brand = (c) => JSON.stringify([rgbOf(c['--lilac']), rgbOf(c['--purple']), rgbOf(c['--aqua'])]) === JSON.stringify([[194, 16, 239], [86, 35, 171], [79, 255, 240]]);
    ok('Paleta (escuro): variáveis --lilac/--purple/--aqua têm as cores da marca na biblioteca e no leitor', brand(prDark.c) && brand(prDarkRd.c), JSON.stringify([prDark.c['--lilac'], prDark.c['--purple'], prDark.c['--aqua']]));
    ok('Contraste WCAG AA (escuro): texto em botões lilás/roxo ≥ 4,5, texto/fundo/painéis ≥ 4,5, foco ≥ 3 (biblioteca e leitor)', prDark.bad.length === 0 && prDarkRd.bad.length === 0, prDark.bad.concat(prDarkRd.bad).join('; '));
    const btnC = await lib.evaluate(() => { const b = document.querySelector('#btnOpenLink'); const p = document.createElement('button'); p.className = 'btn primary'; document.body.appendChild(p); const cs = getComputedStyle(p); const r = { color: cs.color, bgi: cs.backgroundImage }; p.remove(); return r; });
    ok('Botão primário usa o degradê lilás → roxo com texto branco', /#c210ef|rgb\(194, 16, 239\)/i.test(btnC.bgi) && /rgb\(86, 35, 171\)/.test(btnC.bgi) && btnC.color === 'rgb(255, 255, 255)', JSON.stringify(btnC));

    // 2) capturas: biblioteca e leitor escuros
    await lib.screenshot({ path: path.join(SHOTS, 'biblioteca-escura.png') });
    await front('reader.html'); await rd.mouse.move(400, 30); await sleep(600);
    grab(path.join(SHOTS, 'leitor-escuro.png'), await rdBox());
    await front('library');

    // 3) aba Aparência, seletor de tema ao vivo nas duas janelas e persistência
    await openLook();
    const tab = await lib.evaluate(() => ({ tab: document.querySelector('#tabLook').textContent, pane: !document.querySelector('#paneLook').classList.contains('hidden'), seg: [...document.querySelectorAll('#setTheme button')].map((b) => b.textContent + (b.classList.contains('on') ? '*' : '')) }));
    ok('Configurações: aba "Aparência" com seletor Escuro / Claro / Padrão do sistema (Escuro marcado)', tab.tab === 'Aparência' && tab.pane && tab.seg.join('|') === 'Escuro*|Claro|Padrão do sistema', JSON.stringify(tab));
    await lib.screenshot({ path: path.join(SHOTS, 'aparencia-config.png') });
    await lib.click('#setTheme [data-v="light"]'); await sleep(300);
    await rd.waitForFunction(() => document.documentElement.dataset.theme === 'light', null, { timeout: 5000 });
    const prLight = await contrastReport(lib), prLightRd = await contrastReport(rd);
    const bgL = L(rgbOf((await probe(lib, ['--bg']))['--bg']));
    ok('Tema claro: aplica ao vivo na biblioteca e no leitor, fundo claro e salvo na configuração', (await themeOf(lib)).t === 'light' && (await themeOf(rd)).t === 'light' && bgL > 0.8 && (await (async () => { await sleep(500); return readCfg().settings.theme; })()) === 'light', `luminância do fundo ${bgL.toFixed(2)}`);
    ok('Paleta (claro): as mesmas 3 cores da marca nas duas janelas', brand(prLight.c) && brand(prLightRd.c));
    ok('Contraste WCAG AA (claro): texto em botões ≥ 4,5, texto/fundo/painéis ≥ 4,5, foco ≥ 3 (biblioteca e leitor)', prLight.bad.length === 0 && prLightRd.bad.length === 0, prLight.bad.concat(prLightRd.bad).join('; '));
    await lib.keyboard.press('Escape'); await sleep(250);
    await lib.screenshot({ path: path.join(SHOTS, 'biblioteca-clara.png') });
    await front('reader.html'); await rd.mouse.move(420, 30); await sleep(600);
    grab(path.join(SHOTS, 'leitor-claro.png'), await rdBox());
    await front('library');
    await openLook();
    await lib.screenshot({ path: path.join(SHOTS, 'aparencia-config-claro.png') });
    // padrão do sistema
    await lib.click('#setTheme [data-v="system"]'); await sleep(300);
    await app.evaluate(({ nativeTheme }) => { nativeTheme.themeSource = 'light'; }); await sleep(400);
    const sysL = [await themeOf(lib), await themeOf(rd)];
    await app.evaluate(({ nativeTheme }) => { nativeTheme.themeSource = 'dark'; }); await sleep(400);
    const sysD = [await themeOf(lib), await themeOf(rd)];
    ok('Tema "Padrão do sistema": segue o claro/escuro do sistema nas duas janelas, ao vivo', readCfg().settings.theme === 'system' && sysL.every((x) => x.t === 'light' && x.pref === 'system') && sysD.every((x) => x.t === 'dark' && x.pref === 'system'), JSON.stringify([sysL, sysD]));
    await lib.click('#setTheme [data-v="dark"]'); await sleep(300);
    ok('Voltar para Escuro: ambas as janelas escuras de novo', (await themeOf(lib)).t === 'dark' && (await themeOf(rd)).t === 'dark');

    // 4) fundo atrás do livro (leitor)
    const canTrans = await lib.evaluate(() => window.mangaAPI.getConfig().then((c) => c.transparentActive));
    const sw = await lib.evaluate(() => [...document.querySelectorAll('#bdSwatches .sw')].map((b) => b.dataset.v));
    ok('Fundo do leitor: paleta de amostras (padrão, ' + (canTrans ? 'transparente, ' : '') + '3 cores da marca, preto, cinza, roxo, azul e marrom escuros, claro) + seletor de cor livre', ['default', '#c210ef', '#5623ab', '#4ffff0', '#000000', '#2b2a30', '#1a0f2e', '#0e1a30', '#2a1d14', '#ece6f2'].every((v) => sw.includes(v)) && sw.includes('transparent') === !!canTrans && (await lib.isVisible('#setBdColor')), sw.join(','));
    const bd0 = await bdCss();
    ok('Fundo do leitor: o padrão mantém o visual atual (' + (canTrans ? 'janela transparente' : 'escuro opaco') + ')', !bd0.custom && !bd0.trans && bd0.op === (canTrans ? '0' : '1') && /radial-gradient/.test(bd0.img), JSON.stringify(bd0));
    await rd.evaluate(() => document.body.classList.add('fs'));
    const bdFs = await bdCss(); await rd.evaluate(() => document.body.classList.remove('fs'));
    ok('Fundo do leitor: padrão em tela cheia continua escuro (comportamento original)', bdFs.op === '1');
    const t0 = Date.now();
    await lib.click('#bdSwatches [data-v="#c210ef"]');
    await rd.waitForFunction(() => document.body.classList.contains('bd-custom') && getComputedStyle(document.querySelector('#backdrop')).backgroundColor === 'rgb(194, 16, 239)', null, { timeout: 5000 });
    const liveMs = Date.now() - t0;
    const bd1 = await bdCss();
    ok('Fundo do leitor: escolher uma amostra muda o fundo do leitor ao vivo (sem recarregar) e fica opaco', bd1.custom && bd1.op === '1' && bd1.bg === 'rgb(194, 16, 239)' && (await lib.textContent('#bdName')) === 'Lilás' && (await lib.getAttribute('#bdSwatches [data-v="#c210ef"]', 'aria-checked')) === 'true', `${liveMs} ms`);
    await sleep(500);
    ok('Fundo do leitor: escolha salva na configuração', readCfg().settings.backdrop === '#c210ef');
    await front('reader.html'); await rd.mouse.move(430, 30); await sleep(600);
    grab(path.join(SHOTS, 'fundo-lilas.png'), await rdBox());
    await front('library');
    await lib.fill('#setBdColor', '#336699');
    await rd.waitForFunction(() => getComputedStyle(document.querySelector('#backdrop')).backgroundColor === 'rgb(51, 102, 153)', null, { timeout: 5000 });
    await sleep(500);
    ok('Fundo do leitor: seletor de cor livre (#336699) aplica ao vivo, aparece marcado como "Personalizada" e é salvo', readCfg().settings.backdrop === '#336699' && (await lib.evaluate(() => document.querySelector('#setBdColor').classList.contains('on') && !document.querySelector('#bdSwatches .sw.on'))) && /Personalizada #336699/.test(await lib.textContent('#bdName')));
    if (canTrans) {
      await lib.click('#bdSwatches [data-v="transparent"]');
      await rd.waitForFunction(() => document.body.classList.contains('bd-transparent'), null, { timeout: 5000 });
      const bdT = await bdCss(); await rd.evaluate(() => document.body.classList.add('fs')); const bdTf = await bdCss(); await rd.evaluate(() => document.body.classList.remove('fs'));
      ok('Fundo do leitor: opção "Transparente" preserva o comportamento transparente (inclusive em tela cheia)', bdT.trans && bdT.op === '0' && bdTf.op === '0' && readCfg().settings.backdrop === 'transparent');
    }
    await lib.click('#bdSwatches [data-v="default"]'); await sleep(300);
    const bdBack = await bdCss();
    ok('Fundo do leitor: voltar para "Padrão" restaura o visual original', !bdBack.custom && !bdBack.trans && bdBack.op === bd0.op);
    // o processo principal não confia no renderer: valores inválidos voltam ao padrão
    const dirty = await lib.evaluate(() => window.mangaAPI.setSettings({ backdrop: 'url(javascript:alert(1))', theme: 'neon', sepiaLevel: 9999, sepia: 'sim' }).then((r) => r.settings));
    ok('Segurança: configurações de aparência inválidas são saneadas no processo principal', dirty.backdrop === 'default' && dirty.theme === 'dark' && dirty.sepiaLevel === 100 && dirty.sepia === false, JSON.stringify([dirty.backdrop, dirty.theme, dirty.sepiaLevel, dirty.sepia]));
    await lib.evaluate(() => window.mangaAPI.setSettings({ sepiaLevel: 50 })); await sleep(200);
    await lib.evaluate(() => { document.querySelector('#settings').classList.add('hidden'); document.querySelector('#settings').classList.remove('hidden'); });
    await openLook();

    // 5) papel envelhecido (sépia)
    const f0 = await filt();
    ok('Sépia: desligado por padrão (nenhum filtro nas páginas, na pilha de folhas e nas duas faces da folha)', [f0.slotL, f0.slotR, f0.stack, f0.faceF, f0.faceB].every((x) => x === 'none') && (await lib.isDisabled('#setSepiaLevel')) && !(await lib.isChecked('#setSepia')), JSON.stringify(f0));
    const shotPage = async (file) => { await rd.evaluate(() => document.body.classList.add('ui-hidden')); await front('reader.html'); await sleep(500); grab(path.join(SHOTS, file), await rdBox()); await front('library'); };
    await shotPage('pagina-normal.png');
    await lib.click('.switch:has(#setSepia) span'); await sleep(300);
    const f1 = await filt();
    const lv = await lib.evaluate(() => ({ v: document.querySelector('#setSepiaLevel').value, dis: document.querySelector('#setSepiaLevel').disabled, out: document.querySelector('#sepiaVal').textContent, prev: getComputedStyle(document.querySelector('#pgMock')).filter }));
    ok('Sépia: ligar ativa o controle de intensidade (padrão 50%) e aplica o filtro quente às páginas, à pilha e às duas faces da folha', lv.v === '50' && !lv.dis && lv.out === '50%' && [f1.slotL, f1.slotR, f1.stack, f1.faceF, f1.faceB].every((x) => /sepia\(0\.425\)/.test(x) && /contrast\(0\.95\)/.test(x)) && /sepia\(0\.425\)/.test(lv.prev), JSON.stringify([lv, f1.slotL]));
    await lib.fill('#setSepiaLevel', '100'); await sleep(250);
    const f100 = await filt();
    await lib.fill('#setSepiaLevel', '0'); await sleep(250);
    const f00 = await filt();
    await lib.fill('#setSepiaLevel', '70'); await sleep(250);
    const f70 = await filt();
    ok('Sépia: o controle de intensidade (0–100%) muda o filtro ao vivo (100% = sepia 0,85; 0% = sem filtro; 70% = sepia 0,595)', /sepia\(0\.85\)/.test(f100.slotL) && /sepia\(0\.85\)/.test(f100.faceB) && f00.slotL === 'none' && f00.faceF === 'none' && /sepia\(0\.595\)/.test(f70.slotR) && (await lib.textContent('#sepiaVal')) === '70%', JSON.stringify([f100.slotL, f00.slotL, f70.slotR]));
    await sleep(500);
    ok('Sépia: ligado e intensidade salvos na configuração', readCfg().settings.sepia === true && readCfg().settings.sepiaLevel === 70);
    await shotPage('pagina-sepia.png');
    const cmp = JSON.parse(execSync(`python3 - <<'PY'
import json
from PIL import Image, ImageDraw, ImageStat
a=Image.open('${path.join(SHOTS, 'pagina-normal.png')}').convert('RGB'); b=Image.open('${path.join(SHOTS, 'pagina-sepia.png')}').convert('RGB')
def warm(im):
    w,h=im.size; box=(int(w*.30),int(h*.30),int(w*.70),int(h*.70)); s=ImageStat.Stat(im.crop(box)).mean; return s[0]-s[2], s
wa,sa=warm(a); wb,sb=warm(b)
W=a.width+b.width+30; H=max(a.height,b.height)+40
c=Image.new('RGB',(W,H),(24,16,40)); c.paste(a,(10,30)); c.paste(b,(a.width+20,30))
d=ImageDraw.Draw(c); d.text((14,10),'Normal',fill=(255,255,255)); d.text((a.width+24,10),'Papel envelhecido (sepia 70%)',fill=(255,255,255))
c.save('${path.join(SHOTS, 'sepia-comparacao.png')}')
print(json.dumps({'warmNormal':wa,'warmSepia':wb}))
PY`).toString());
    ok('Sépia: a página fica visivelmente mais quente/amarelada que a normal (R−B sobe) — captura lado a lado salva', cmp.warmSepia - cmp.warmNormal > 6, JSON.stringify(cmp));
    // meio da virada: as duas faces da folha também ficam com o filtro; física congelada
    await rd.evaluate(() => { document.body.classList.add('ui-hidden'); });
    await rd.evaluate(() => new Promise((res) => { __readerTest.go(1); setTimeout(() => { __readerTest.pause(true); res(); }, 170); }));
    await sleep(150);
    const midLeaf = await rd.evaluate(() => { const l = document.querySelector('#leaf'); const g = (q) => getComputedStyle(l.querySelector(q)).filter; return { on: l.classList.contains('on'), f: g('.strip .face.f'), b: g('.strip .face.b'), n: l.querySelectorAll('.face').length }; });
    await front('reader.html'); await sleep(250); grab(path.join(SHOTS, 'sepia-virando.png'), await rdBox()); await front('library');
    await rd.evaluate(() => __readerTest.pause(false)); await waitIdle(rd);
    ok('Sépia: folha que vira (frente e verso, 28 faces) mantém o filtro no meio do movimento', midLeaf.on && midLeaf.n === 28 && /sepia\(0\.595\)/.test(midLeaf.f) && /sepia\(0\.595\)/.test(midLeaf.b), JSON.stringify(midLeaf));
    // página simples e tela cheia
    await rd.keyboard.press('m'); await sleep(500); await waitIdle(rd);
    const fSingle = await filt(); const singleMode = await rd.evaluate(() => __reader.mode);
    await rd.keyboard.press('m'); await sleep(500); await waitIdle(rd);
    await rd.evaluate(() => window.mangaAPI.setFullscreen(true));
    await rd.waitForFunction(() => document.body.classList.contains('fs'), null, { timeout: 8000 }); await sleep(500);
    const fFs = await filt();
    await rd.evaluate(() => window.mangaAPI.setFullscreen(false));
    await rd.waitForFunction(() => !document.body.classList.contains('fs'), null, { timeout: 8000 }); await sleep(400);
    ok('Sépia: vale também no modo de página simples e em tela cheia', singleMode === 'single' && /sepia\(0\.595\)/.test(fSingle.slotL + fSingle.slotR) && /sepia\(0\.595\)/.test(fFs.slotL) && /sepia\(0\.595\)/.test(fFs.faceF), JSON.stringify([singleMode, fSingle.slotL, fFs.slotL]));
    // desempenho: o filtro é só uma matriz de cor na GPU; mede o tempo dos quadros durante a virada, com e sem sépia
    const frames = () => rd.evaluate(() => new Promise((res) => { const ts = []; let n = 0; const tick = (t) => { ts.push(t); if (++n < 40) requestAnimationFrame(tick); else res(ts.slice(1).map((x, i) => x - ts[i])); }; __readerTest.go(1); requestAnimationFrame(tick); }));
    const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;
    const dOn = avg(await frames()); await waitIdle(rd); await rd.keyboard.press('ArrowRight'); await waitIdle(rd);
    await lib.click('.switch:has(#setSepia) span'); await sleep(300);
    const dOff = avg(await frames()); await waitIdle(rd);
    await lib.click('.switch:has(#setSepia) span'); await sleep(300);
    ok('Sépia: não pesa na virada de página (tempo médio por quadro com sépia vs. sem, página parada em estado de física normal)', dOn < dOff * 1.6 + 6 || dOn < 34, `com sépia ${dOn.toFixed(1)} ms/quadro, sem ${dOff.toFixed(1)} ms/quadro`);
    ok('Sépia: a física não depende do filtro (mesmo número de tiras e passos; PHYS intacto)', await rd.evaluate(() => typeof __readerTest.PHYS === 'object' && document.querySelectorAll('#leaf .strip').length === 14));

    // 6) árabe (RTL): aba Aparência espelhada
    await lib.click('#setTabs [data-tab="general"]'); await lib.selectOption('#setLang', 'ar'); await sleep(350); await lib.click('#tabLook'); await sleep(250);
    const rtl = await lib.evaluate(() => { const a = document.querySelectorAll('#bdSwatches .sw'); const r0 = a[0].getBoundingClientRect(), r1 = a[a.length - 1].getBoundingClientRect(); return { dir: document.documentElement.dir, tab: document.querySelector('#tabLook').textContent, sw: getComputedStyle(document.querySelector('#bdSwatches')).direction, firstRight: r0.x > r1.x, theme: [...document.querySelectorAll('#setTheme button')].map((b) => b.textContent).join('|'), vis: !document.querySelector('#paneLook').classList.contains('hidden') }; });
    await lib.screenshot({ path: path.join(SHOTS, 'aparencia-arabe.png') });
    ok('Árabe: aba Aparência traduzida e espelhada (amostras da direita para a esquerda)', rtl.dir === 'rtl' && rtl.tab === 'المظهر' && rtl.sw === 'rtl' && rtl.firstRight && rtl.vis && rtl.theme === 'داكن|فاتح|افتراضي النظام', JSON.stringify(rtl));
    await lib.click('#setTabs [data-tab="general"]'); await lib.selectOption('#setLang', 'pt-BR'); await sleep(350); await lib.click('#tabLook'); await sleep(250);
    // 7) traduções
    const LK4 = ['set.tabLook', 'set.theme', 'set.themeHint', 'set.themeDark', 'set.themeLight', 'set.themeSystem', 'set.backdrop', 'set.backdropHint', 'set.bd.default', 'set.bd.transparent', 'set.bd.custom', 'set.bd.lilac', 'set.bd.purple', 'set.bd.aqua', 'set.bd.black', 'set.bd.grey', 'set.bd.dpurple', 'set.bd.dblue', 'set.bd.brown', 'set.bd.light', 'set.paper', 'set.paperHint', 'set.paperLevel'];
    const LD4 = path.join(ROOT, 'src', 'locales');
    const locs4 = fsx.readdirSync(LD4).filter((f) => f.endsWith('.json')).map((f) => [f, JSON.parse(fsx.readFileSync(path.join(LD4, f), 'utf8'))]);
    const en4 = locs4.find(([f]) => f === 'en.json')[1];
    const miss4 = locs4.flatMap(([f, d]) => LK4.filter((k) => !d[k]).map((k) => f + ':' + k));
    ok(`Idiomas: ${LK4.length} textos novos (tema, fundo, sépia) nos 18 idiomas, com as mesmas chaves em todos os arquivos`, locs4.length === 18 && miss4.length === 0 && locs4.every(([, d]) => Object.keys(d).length === Object.keys(en4).length && Object.keys(en4).every((k) => k in d)) && new Set(locs4.map(([, d]) => d['set.paper'])).size === 18 && new Set(locs4.map(([, d]) => d['set.tabLook'])).size >= 17, miss4.slice(0, 4).join(','));
    // estado final para a verificação de persistência após reiniciar (3ª execução)
    await lib.click('#setTheme [data-v="light"]'); await lib.click('#bdSwatches [data-v="#5623ab"]');
    await sleep(700);
    await lib.keyboard.press('Escape'); await sleep(250);
    const fin = readCfg().settings;
    ok('Estado final salvo (claro, fundo roxo, sépia 70%) para a checagem após reiniciar', fin.theme === 'light' && fin.backdrop === '#5623ab' && fin.sepia === true && fin.sepiaLevel === 70, JSON.stringify([fin.theme, fin.backdrop, fin.sepia, fin.sepiaLevel]));
  }
  // limpar histórico
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().includes('library')); w.restore(); w.focus(); });
  await sleep(300);
  await lib.click('#btnClearHistory'); await sleep(200);
  ok('Limpar histórico pede confirmação', await lib.isVisible('#confirm'));
  await lib.screenshot({ path: path.join(SHOTS, 'limpar-historico.png') });
  await lib.click('#confirmNo'); await sleep(300);
  ok('Cancelar mantém o histórico', (await lib.$$('.cont')).length === 2 && Object.keys(readCfg().progress).length > 0);
  await lib.click('#btnClearHistory'); await sleep(200);
  await lib.click('#confirmYes'); await sleep(900);
  const cfgH = readCfg();
  ok('Confirmar esvazia "Continuar lendo"', await lib.isHidden('#continueSec') && Object.keys(cfgH.progress).length === 0 && cfgH.recentFolders.length === 0,
    `progress=${Object.keys(cfgH.progress).length}, recentes=${cfgH.recentFolders.length}`);
  await lib.evaluate(() => window.mangaAPI.setLanguage('ar')); await sleep(500);
  await app.close();

  // ============================================================ 3ª execução: idioma lembrado
  app = await launch();
  lib = await app.firstWindow();
  watch(lib, 'biblioteca#3');
  await lib.waitForLoadState('domcontentloaded'); await sleep(1200);
  ok('Após reiniciar: idioma (árabe, RTL) lembrado', (await lib.evaluate(() => document.documentElement.dir)) === 'rtl' && (await lib.textContent('.h1sub')) === 'المكتبة');
  {
    const cfg3 = readCfg().settings;
    const lt = await lib.evaluate(() => ({ t: document.documentElement.dataset.theme, q: location.search }));
    ok('Após reiniciar: tema claro lembrado e aplicado já na primeira pintura (via ?theme= da janela)', cfg3.theme === 'light' && lt.t === 'light' && /theme=light/.test(lt.q), JSON.stringify(lt));
    await lib.click('#btnSettings'); await sleep(200); await lib.click('#tabLook'); await sleep(250);
    const ui3 = await lib.evaluate(() => ({ th: document.querySelector('#setTheme .on')?.dataset.v, bd: document.querySelector('#bdSwatches .sw.on')?.dataset.v, sep: document.querySelector('#setSepia').checked, lv: document.querySelector('#setSepiaLevel').value }));
    ok('Após reiniciar: configurações de aparência (claro, fundo roxo, sépia 70%) lembradas e mostradas', ui3.th === 'light' && ui3.bd === '#5623ab' && ui3.sep === true && ui3.lv === '70', JSON.stringify(ui3));
    await lib.keyboard.press('Escape'); await sleep(200);
    await lib.evaluate((p) => window.mangaAPI.openReader(p), LOOSE);
    const rd3 = await readerWindow(app, lib); watch(rd3, 'leitor#3');
    await rd3.waitForFunction(() => window.__reader && window.__reader.n > 0, null, { timeout: 15000 }); await sleep(900);
    const r3 = await rd3.evaluate(() => ({ t: document.documentElement.dataset.theme, bd: getComputedStyle(document.querySelector('#backdrop')).backgroundColor, custom: document.body.classList.contains('bd-custom'), f: getComputedStyle(document.querySelector('#slotL')).filter }));
    ok('Após reiniciar: o leitor abre no tema claro, com o fundo roxo e o papel envelhecido', r3.t === 'light' && r3.custom && r3.bd === 'rgb(86, 35, 171)' && /sepia\(0\.595\)/.test(r3.f), JSON.stringify(r3));
    await lib.evaluate(() => window.mangaAPI.setSettings({ theme: 'dark', backdrop: 'default', sepia: false })); await sleep(500);
  }
  await lib.screenshot({ path: path.join(SHOTS, 'biblioteca-arabe.png') });
  await lib.evaluate(() => window.mangaAPI.setLanguage(null)); await sleep(300);
  ok('"Padrão do sistema" volta ao idioma do sistema', (await lib.textContent('.h1sub')) === 'Biblioteca');
  await app.close();

  const real = errors.filter((e) => !/Electron Security Warning|Autofill/.test(e));
  ok('Nenhum erro no console', real.length === 0, real.join(' | '));
  const passed = results.filter((r) => r.pass).length;
  console.log(`\n${passed}/${results.length} verificações passaram`);
  fs.writeFileSync(path.join(SHOTS, 'resultado-testes.json'), JSON.stringify({ passed, total: results.length, results, errors }, null, 2));
  process.exit(passed === results.length ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });
