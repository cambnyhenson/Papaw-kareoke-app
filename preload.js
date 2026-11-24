const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  pickFolder: () => ipcRenderer.invoke('pick-folder'),
  libGet: () => ipcRenderer.invoke('lib-get'),
  libStatus: () => ipcRenderer.invoke('lib-status'),
  libAdd: dir => ipcRenderer.invoke('lib-add', dir),
  libRemove: id => ipcRenderer.invoke('lib-remove', id),
  libScan: id => ipcRenderer.invoke('lib-scan', id),
  onScanProgress: cb => ipcRenderer.on('scan-progress', (_e, name, n) => cb(name, n)),
  read: key => ipcRenderer.invoke('read', key),     // -> Uint8Array
  hasTV: () => ipcRenderer.invoke('has-tv'),
  version: () => ipcRenderer.invoke('version'),
  recSave: (title, bytes) => ipcRenderer.invoke('rec-save', title, bytes),
  recList: () => ipcRenderer.invoke('rec-list'),
  recRead: name => ipcRenderer.invoke('rec-read', name),
  recDelete: name => ipcRenderer.invoke('rec-delete', name),
  recShow: name => ipcRenderer.invoke('rec-show', name),
  recFolder: () => ipcRenderer.invoke('rec-folder'),
});
