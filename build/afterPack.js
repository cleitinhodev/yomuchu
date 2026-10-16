// Remove do pacote do Windows bibliotecas que o app não usa (WebGPU/DXC), para o instalador ficar < 100 MB.
const fs = require('fs'), path = require('path');
exports.default = async function (ctx) {
  if (ctx.electronPlatformName !== 'win32') return;
  for (const f of ['dxcompiler.dll', 'dxil.dll']) {
    const p = path.join(ctx.appOutDir, f);
    if (fs.existsSync(p)) { fs.rmSync(p); console.log('  • afterPack: removido', f); }
  }
};
