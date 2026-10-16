// gera uma tira com quadros da virada (para inspeção visual)
const { _electron } = require('playwright-core');
const path = require('path'), fs = require('fs'), { execSync } = require('child_process');
(async () => {
  const ud = '/tmp/mr-frames'; fs.rmSync(ud, { recursive: true, force: true }); fs.mkdirSync(ud);
  const app = await _electron.launch({ executablePath: require('electron'), args: ['.', '--no-sandbox'], env: { ...process.env, MANGA_READER_USERDATA: ud } });
  const lib = await app.firstWindow();
  await lib.waitForLoadState('domcontentloaded');
  await lib.evaluate((p) => window.mangaAPI.openReader(p, { page: 5 }), path.resolve(process.argv[2] || 'amostras/avulso/Capitulo 01 - O Comeco'));
  let rd; for (let i = 0; i < 50 && !rd; i++) { rd = app.windows().find((p) => p.url().includes('reader.html')); await new Promise(r => setTimeout(r, 100)); }
  await rd.waitForFunction(() => window.__reader && __reader.n > 0 && document.querySelector('#loading').classList.contains('done'));
  if (process.argv[3] === 'single') { await rd.keyboard.press('m'); await new Promise(r => setTimeout(r, 1500)); }
  if (process.argv[4] === 'ltr') { await rd.keyboard.press('d'); await new Promise(r => setTimeout(r, 800)); }
  await rd.evaluate(() => { document.body.classList.add('ui-hidden'); });
  await new Promise(r => setTimeout(r, 1200));
  const b = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('reader')).getBounds());
  const ts = [0.12, 0.3, 0.5, 0.7, 0.88];
  for (const t of ts) {
    await rd.evaluate((t) => { const T = __readerTest; if (!__reader.trans) T.beginTransition(__reader.k, t, 'flip'); else T.renderLeaf(t); }, t);
    await new Promise(r => setTimeout(r, 250));
    execSync(`python3 -c "from PIL import ImageGrab; ImageGrab.grab(xdisplay='${process.env.DISPLAY}').crop((${b.x},${b.y},${b.x + b.width},${b.y + b.height})).save('/tmp/f_${t}.png')"`);
  }
  execSync(`python3 -c "
from PIL import Image
ims=[Image.open('/tmp/f_'+t+'.png') for t in '${ts.join(' ')}'.split()]
w,h=ims[0].size; s=0.42
out=Image.new('RGB',(int(w*s)*3,int(h*s)*2),(30,30,30))
for i,im in enumerate(ims): out.paste(im.resize((int(w*s),int(h*s))),((i%3)*int(w*s),(i//3)*int(h*s)))
out.save('/tmp/frames.png')"`);
  await app.close();
})().catch(e => { console.error(e); process.exit(1); });
