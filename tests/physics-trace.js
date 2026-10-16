// registra a física de uma virada (ângulos das tiras por quadro) para ajuste fino
const { _electron } = require('playwright-core');
const path = require('path'), fs = require('fs');
(async () => {
  const ud = '/tmp/mr-trace'; fs.rmSync(ud, { recursive: true, force: true }); fs.mkdirSync(ud);
  const app = await _electron.launch({ executablePath: require('electron'), args: ['.', '--no-sandbox'], env: { ...process.env, MANGA_READER_USERDATA: ud } });
  const lib = await app.firstWindow(); await lib.waitForLoadState('domcontentloaded');
  await lib.evaluate((p) => window.mangaAPI.openReader(p, { page: 5 }), path.resolve('amostras/avulso/Capitulo 01 - O Comeco'));
  let rd; for (let i = 0; i < 50 && !rd; i++) { rd = app.windows().find((p) => p.url().includes('reader.html')); await new Promise(r => setTimeout(r, 100)); }
  const errs = []; rd.on('pageerror', e => errs.push(e.message)); rd.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await rd.waitForFunction(() => window.__reader && __reader.n > 0 && document.querySelector('#loading').classList.contains('done'));
  await new Promise(r => setTimeout(r, 800));
  const trace = await rd.evaluate(() => new Promise((res) => {
    const out = []; const t0 = performance.now();
    const tick = () => { const tr = __reader.trans; out.push(tr ? { ms: Math.round(performance.now() - t0), u: Array.from(tr.u, x => +(x * 180).toFixed(0)), lift: +tr.lift.toFixed(2) } : { ms: Math.round(performance.now() - t0), done: true, k: __reader.k });
      if (out.length < 150 && (tr || out.length < 3)) requestAnimationFrame(tick); else res(out); };
    __readerTest.go(1); requestAnimationFrame(tick);
  }));
  for (const f of trace.filter((_, i) => i % 3 === 0 || !_.u)) console.log(f.ms, f.u ? f.u.join(' ') + '  lift=' + f.lift : 'FIM k=' + f.k);
  console.log('frames', trace.length, 'errs', errs);
  await app.close();
})().catch(e => { console.error(e); process.exit(1); });
