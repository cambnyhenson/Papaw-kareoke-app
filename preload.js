const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  pickFolder: () => ipcRenderer.invoke('pick-folder'),
  scan: dir => ipcRenderer.invoke('scan', dir),
  read: rel => ipcRenderer.invoke('read', rel),     // -> Uint8Array
  hasTV: () => ipcRenderer.invoke('has-tv'),
  version: () => ipcRenderer.invoke('version'),
  recSave: (title, bytes) => ipcRenderer.invoke('rec-save', title, bytes),
  recList: () => ipcRenderer.invoke('rec-list'),
  recRead: name => ipcRenderer.invoke('rec-read', name),
  recDelete: name => ipcRenderer.invoke('rec-delete', name),
  recShow: name => ipcRenderer.invoke('rec-show', name),
  recFolder: () => ipcRenderer.invoke('rec-folder'),
});
