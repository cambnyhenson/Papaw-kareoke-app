const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  pickFolder: () => ipcRenderer.invoke('pick-folder'),
  scan: dir => ipcRenderer.invoke('scan', dir),
  read: rel => ipcRenderer.invoke('read', rel),     // -> Uint8Array
  hasTV: () => ipcRenderer.invoke('has-tv'),
  version: () => ipcRenderer.invoke('version'),
});
