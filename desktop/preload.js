const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('needle', {
  generate:     (query, tools, opts = {}) =>
                  ipcRenderer.invoke('needle:generate', { query, tools, ...opts }),
  execute:      (calls) => ipcRenderer.invoke('needle:execute', calls),
  status:       () => ipcRenderer.invoke('needle:status'),
  toolsPath:    () => ipcRenderer.invoke('needle:tools-path'),
  hideLauncher: () => ipcRenderer.invoke('needle:hide'),
  resize:       (h) => ipcRenderer.invoke('needle:resize', h),
  onReady:      (fn) => ipcRenderer.on('needle:ready', (_e, msg) => fn(msg)),
  onShow:       (fn) => ipcRenderer.on('needle:show', () => fn()),
});
