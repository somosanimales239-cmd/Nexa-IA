'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const listeners = new Map();

function on(channel, callback) {
  const wrapped = (_event, payload) => callback(payload);
  listeners.set(callback, { channel, wrapped });
  ipcRenderer.on(channel, wrapped);
  return () => {
    ipcRenderer.removeListener(channel, wrapped);
    listeners.delete(callback);
  };
}

contextBridge.exposeInMainWorld('nexa', {
  app: Object.freeze({
    platform: process.platform,
    versions: Object.freeze({
      node: process.versions.node,
      chrome: process.versions.chrome,
      electron: process.versions.electron,
    }),
  }),
  store: Object.freeze({
    get: () => ipcRenderer.invoke('store:get'),
    saveSettings: patch => ipcRenderer.invoke('store:settings', patch),
    saveChat: chat => ipcRenderer.invoke('store:chat:save', chat),
    deleteChat: chatId => ipcRenderer.invoke('store:chat:delete', chatId),
    saveMemory: memory => ipcRenderer.invoke('store:memory:save', memory),
    deleteMemory: memoryId => ipcRenderer.invoke('store:memory:delete', memoryId),
  }),
  engine: Object.freeze({
    status: () => ipcRenderer.invoke('engine:status'),
    start: () => ipcRenderer.invoke('engine:start'),
    warm: () => ipcRenderer.invoke('engine:warm'),
    unload: () => ipcRenderer.invoke('engine:unload'),
  }),
  system: Object.freeze({
    stats: () => ipcRenderer.invoke('system:stats'),
    openDataFolder: () => ipcRenderer.invoke('system:open-data'),
  }),
  chat: Object.freeze({
    start: payload => ipcRenderer.invoke('chat:start', payload),
    stop: requestId => ipcRenderer.invoke('chat:stop', requestId),
    onToken: callback => on('chat:token', callback),
    onDone: callback => on('chat:done', callback),
    onError: callback => on('chat:error', callback),
  }),
});
