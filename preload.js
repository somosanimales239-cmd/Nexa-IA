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
    versions: Object.freeze({ node: process.versions.node, chrome: process.versions.chrome, electron: process.versions.electron }),
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
    openKnowledgeFolder: () => ipcRenderer.invoke('system:open-knowledge'),
    openExternal: url => ipcRenderer.invoke('system:open-external', url),
  }),
  chat: Object.freeze({
    start: payload => ipcRenderer.invoke('chat:start', payload),
    stop: requestId => ipcRenderer.invoke('chat:stop', requestId),
    onToken: callback => on('chat:token', callback),
    onDone: callback => on('chat:done', callback),
    onError: callback => on('chat:error', callback),
    onContext: callback => on('chat:context', callback),
  }),
  images: Object.freeze({
    generate: payload => ipcRenderer.invoke('image:generate', payload),
    stop: requestId => ipcRenderer.invoke('image:stop', requestId),
    saveAs: filePath => ipcRenderer.invoke('image:save-as', filePath),
  }),
  knowledge: Object.freeze({
    list: () => ipcRenderer.invoke('knowledge:list'),
    create: input => ipcRenderer.invoke('knowledge:create', input),
    update: (libraryId, patch) => ipcRenderer.invoke('knowledge:update', libraryId, patch),
    delete: libraryId => ipcRenderer.invoke('knowledge:delete', libraryId),
    removeDocument: (libraryId, documentId) => ipcRenderer.invoke('knowledge:remove-document', libraryId, documentId),
    chooseFiles: () => ipcRenderer.invoke('knowledge:choose-files'),
    chooseFolder: () => ipcRenderer.invoke('knowledge:choose-folder'),
    addFiles: (libraryId, files) => ipcRenderer.invoke('knowledge:add-files', libraryId, files),
    search: (query, options) => ipcRenderer.invoke('knowledge:search', query, options),
    openRoot: () => ipcRenderer.invoke('knowledge:open-root'),
    openLibrary: libraryId => ipcRenderer.invoke('knowledge:open-library', libraryId),
    onProgress: callback => on('knowledge:progress', callback),
  }),
  knowledgeDb: Object.freeze({
    stats: () => ipcRenderer.invoke('knowledge-db:stats'),
    objectives: () => ipcRenderer.invoke('knowledge-db:objectives'),
    createObjective: input => ipcRenderer.invoke('knowledge-db:create-objective', input),
    updateObjective: (objectiveId, patch) => ipcRenderer.invoke('knowledge-db:update-objective', objectiveId, patch),
    deleteObjective: objectiveId => ipcRenderer.invoke('knowledge-db:delete-objective', objectiveId),
    topics: objectiveId => ipcRenderer.invoke('knowledge-db:topics', objectiveId),
    addTopic: (objectiveId, input) => ipcRenderer.invoke('knowledge-db:add-topic', objectiveId, input),
    search: (query, options) => ipcRenderer.invoke('knowledge-db:search', query, options),
    save: input => ipcRenderer.invoke('knowledge-db:save', input),
  }),
  research: Object.freeze({
    topic: (objectiveId, topic, options) => ipcRenderer.invoke('research:topic', objectiveId, topic, options),
    missing: (objectiveId, limit) => ipcRenderer.invoke('research:missing', objectiveId, limit),
    onProgress: callback => on('research:progress', callback),
  }),
  factory: Object.freeze({
    list: () => ipcRenderer.invoke('factory:list'),
    create: input => ipcRenderer.invoke('factory:create', input),
    delete: curriculumId => ipcRenderer.invoke('factory:delete', curriculumId),
    years: curriculumId => ipcRenderer.invoke('factory:years', curriculumId),
    configs: (curriculumId, year) => ipcRenderer.invoke('factory:configs', curriculumId, year),
    start: curriculumId => ipcRenderer.invoke('factory:start', curriculumId),
    pause: curriculumId => ipcRenderer.invoke('factory:pause', curriculumId),
    stats: () => ipcRenderer.invoke('factory:stats'),
    onProgress: callback => on('factory:progress', callback),
  }),
  bridge: Object.freeze({
    status: () => ipcRenderer.invoke('bridge:status'),
    regenerateToken: () => ipcRenderer.invoke('bridge:regenerate-token'),
    onCapture: callback => on('bridge:capture', callback),
  }),
});
