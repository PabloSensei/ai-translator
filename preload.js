const { contextBridge, ipcRenderer, shell } = require('electron');

contextBridge.exposeInMainWorld('api', {
    translate: (data) => ipcRenderer.invoke('translate', data),
    getSettings: () => ipcRenderer.invoke('get-settings'),
    saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
    getHistory: () => ipcRenderer.invoke('get-history'),
    clearHistory: () => ipcRenderer.invoke('clear-history'),
    deleteHistoryItem: (id) => ipcRenderer.invoke('delete-history-item', id),
    getRecentLanguages: () => ipcRenderer.invoke('get-recent-languages'),

    windowMinimize: () => ipcRenderer.send('window-minimize'),
    windowClose: () => ipcRenderer.send('window-close'),
    unregisterHotkey: () => ipcRenderer.send('unregister-hotkey'),
    registerHotkey: () => ipcRenderer.send('register-hotkey'),
    openExternal: (url) => shell.openExternal(url)
});
