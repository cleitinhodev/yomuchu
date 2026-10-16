'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');

const on = (channel) => (cb) => {
  const h = (_e, ...args) => cb(...args);
  ipcRenderer.on(channel, h);
  return () => ipcRenderer.removeListener(channel, h);
};

contextBridge.exposeInMainWorld('mangaAPI', {
  getConfig: () => ipcRenderer.invoke('config:get'),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
  relaunch: () => ipcRenderer.invoke('app:relaunch'),
  getI18n: () => ipcRenderer.invoke('i18n:get'),
  setLanguage: (code) => ipcRenderer.invoke('i18n:set', code),
  onI18nChanged: on('i18n:changed'),
  clearHistory: () => ipcRenderer.invoke('history:clear'),
  openLink: (url) => ipcRenderer.invoke('link:open', url),
  testOpenedDirs: () => ipcRenderer.invoke('test:openedDirs'),
  testOpenedLinks: () => ipcRenderer.invoke('test:openedLinks'),
  // abrir link
  startLink: (url) => ipcRenderer.invoke('link:start', url),
  cancelLink: () => ipcRenderer.invoke('link:cancel'),
  linkCacheInfo: () => ipcRenderer.invoke('link:cacheInfo'),
  deleteDownload: (folder) => ipcRenderer.invoke('link:delete', folder),
  openDownloadsDir: (folder) => ipcRenderer.invoke('link:openDir', folder),
  clearDownloads: () => ipcRenderer.invoke('link:clear'),
  onLinkProgress: on('link:progress'),
  // biblioteca
  chooseLibraryRoot: () => ipcRenderer.invoke('library:chooseRoot'),
  setLibraryRoot: (p) => ipcRenderer.invoke('library:setRoot', p),
  scanLibrary: () => ipcRenderer.invoke('library:scan'),
  chooseFolder: () => ipcRenderer.invoke('folder:choose'),
  isDir: (p) => ipcRenderer.invoke('folder:isDir', p),
  listPages: (p) => ipcRenderer.invoke('folder:listPages', p),
  revealFolder: (p) => ipcRenderer.invoke('folder:reveal', p),
  openReader: (folder, opts) => ipcRenderer.invoke('reader:open', folder, opts),
  showLibrary: () => ipcRenderer.invoke('library:show'),
  pathForFile: (file) => { try { return webUtils.getPathForFile(file); } catch { return null; } },
  // progresso
  setProgress: (folder, page, total) => ipcRenderer.invoke('progress:set', folder, page, total),
  clearProgress: (folder) => ipcRenderer.invoke('progress:clear', folder),
  // janela
  toggleFullscreen: () => ipcRenderer.invoke('win:toggleFullscreen'),
  setFullscreen: (v) => ipcRenderer.invoke('win:setFullscreen', v),
  isFullscreen: () => ipcRenderer.invoke('win:isFullscreen'),
  minimize: () => ipcRenderer.invoke('win:minimize'),
  close: () => ipcRenderer.invoke('win:close'),
  getBounds: () => ipcRenderer.invoke('win:getBounds'),
  setBounds: (b) => ipcRenderer.invoke('win:setBounds', b),
  moveTo: (b) => ipcRenderer.send('win:moveTo', b),
  fitBook: (aspect) => ipcRenderer.invoke('win:fitBook', aspect),
  // eventos
  onReaderLoad: on('reader:load'),
  onFullscreen: on('reader:fullscreen'),
  onLibraryRefresh: on('library:refresh'),
  onLibraryProgress: on('library:progress'),
  onSettingsChanged: on('settings:changed'),
  onSystemTheme: on('theme:system'),
});
