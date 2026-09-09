const { contextBridge, ipcRenderer } = require('electron');

// Resolved before the page renders so the first paint uses the saved theme.
let initialTheme = 'dark';
try {
    initialTheme = ipcRenderer.sendSync('get-initial-theme') || 'dark';
} catch (e) {
    console.error('Failed to read the initial theme:', e);
}

contextBridge.exposeInMainWorld('api', {
    initialTheme,

    translate: (data) => ipcRenderer.invoke('translate', data),
    getSettings: () => ipcRenderer.invoke('get-settings'),
    saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
    getHistory: () => ipcRenderer.invoke('get-history'),
    clearHistory: () => ipcRenderer.invoke('clear-history'),
    deleteHistoryItem: (id) => ipcRenderer.invoke('delete-history-item', id),
    getRecentPairs: () => ipcRenderer.invoke('get-recent-pairs'),
    addRecentPair: (pair) => ipcRenderer.invoke('add-recent-pair', pair),
    listModels: (provider) => ipcRenderer.invoke('list-models', provider),
    checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),

    windowMinimize: () => ipcRenderer.send('window-minimize'),
    windowClose: () => ipcRenderer.send('window-close'),
    unregisterHotkey: () => ipcRenderer.send('unregister-hotkey'),
    registerHotkey: () => ipcRenderer.send('register-hotkey'),
    openExternal: (url) => ipcRenderer.send('open-external', url),

    onSystemThemeChanged: (callback) => {
        ipcRenderer.on('system-theme-changed', (event, theme) => callback(theme));
    }
});
