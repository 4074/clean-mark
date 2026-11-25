'use strict';

const { contextBridge, ipcRenderer, webUtils } = require('electron');

let initialTheme = 'dark';
try {
  const stored = ipcRenderer.sendSync('theme:get-sync');
  if (stored === 'light' || stored === 'dark') initialTheme = stored;
} catch {
  // 主进程尚未就绪时使用默认主题。
}

contextBridge.exposeInMainWorld('cleanmark', {
  platform: process.platform,
  initialTheme,
  chooseFolder: () => ipcRenderer.invoke('folder:choose'),
  scanFolder: (folderPath) => ipcRenderer.invoke('folder:scan', folderPath),
  startProcessing: (folderPath) => ipcRenderer.invoke('process:start', { folderPath }),
  cancelProcessing: () => ipcRenderer.invoke('process:cancel'),
  getImageInfo: (imagePath) => ipcRenderer.invoke('image:info', imagePath),
  openOutputFolder: (folderPath) => ipcRenderer.invoke('output:open', folderPath),
  revealOutput: (filePath) => ipcRenderer.invoke('output:reveal', filePath),
  setTheme: (theme) => ipcRenderer.invoke('theme:set', theme),
  getPathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file);
    } catch {
      return '';
    }
  },
  onProgress: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('process:progress', listener);
    return () => ipcRenderer.removeListener('process:progress', listener);
  },
});
