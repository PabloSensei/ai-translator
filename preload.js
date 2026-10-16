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
    platform: process.platform,

    translate: (data) => ipcRenderer.invoke('translate', data),
    getSettings: () => ipcRenderer.invoke('get-settings'),
    saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
    getHistory: () => ipcRenderer.invoke('get-history'),
    clearHistory: () => ipcRenderer.invoke('clear-history'),
    deleteHistoryItem: (id) => ipcRenderer.invoke('delete-history-item', id),
    setHistoryFavorite: (id, favorite) => ipcRenderer.invoke('set-history-favorite', id, favorite),
    exportHistory: (ids) => ipcRenderer.invoke('export-history', ids),
    getRecentPairs: () => ipcRenderer.invoke('get-recent-pairs'),
    addRecentPair: (pair) => ipcRenderer.invoke('add-recent-pair', pair),
    listModels: (provider) => ipcRenderer.invoke('list-models', provider),
    checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
    readClipboardImage: () => ipcRenderer.invoke('read-clipboard-image'),

    windowMinimize: () => ipcRenderer.send('window-minimize'),
    windowClose: () => ipcRenderer.send('window-close'),
    unregisterHotkey: () => ipcRenderer.send('unregister-hotkey'),
    registerHotkey: () => ipcRenderer.send('register-hotkey'),
    openExternal: (url) => ipcRenderer.send('open-external', url),

    cancelTranslation: (requestId) => ipcRenderer.send('cancel-translation', requestId),

    onSystemThemeChanged: (callback) => {
        ipcRenderer.on('system-theme-changed', (event, theme) => callback(theme));
    },
    // Streamed pieces of an in-flight translation: { requestId, delta }.
    onTranslateDelta: (callback) => {
        ipcRenderer.on('translate-delta', (event, payload) => callback(payload));
    },
    // Text picked up by the "translate selection" hotkey or tray item.
    onTranslateText: (callback) => {
        ipcRenderer.on('translate-text', (event, text) => callback(text));
    },
    // A clipboard image (PNG data URL) picked up by the same hotkey.
    onTranslateImage: (callback) => {
        ipcRenderer.on('translate-image', (event, dataUrl) => callback(dataUrl));
    }
});
