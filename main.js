const { app, safeStorage, BrowserWindow, Tray, Menu, globalShortcut, ipcMain, nativeImage, dialog, shell } = require('electron');
const path = require('path');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// electron-store — ESM-only module starting from v9, use dynamic import
let Store;
let settingsStore;
let historyStore;


// --- Security Helpers ---
function encryptApiKey(text) {
  if (!text) return '';
  if (!safeStorage.isEncryptionAvailable()) return text;
  try {
    return safeStorage.encryptString(text).toString('hex');
  } catch (e) {
    console.error('Encryption error:', e);
    return text;
  }
}

function decryptApiKey(text) {
  if (!text) return '';
  if (!safeStorage.isEncryptionAvailable()) return text;
  try {
    const buffer = Buffer.from(text, 'hex');
    return safeStorage.decryptString(buffer);
  } catch (e) {
    return text;
  }
}

async function initStores() {
  const mod = await import('electron-store');
  Store = mod.default;

  settingsStore = new Store({
    name: 'settings',
    defaults: {
      apiKey: '',
      hotkey: 'Ctrl+Shift+T',
      windowBounds: { width: 860, height: 640 },
      recentLanguages: ['en', 'ru', 'de', 'fr', 'es', 'uk', 'zh', 'ja', 'ko', 'ar'],
      model: 'gemini-2.5-flash'
    }
  });

  historyStore = new Store({
    name: 'history',
    defaults: {
      items: []
    }
  });
  // Migrate legacy plaintext API key
  const currentKey = settingsStore.get('apiKey');
  if (currentKey && safeStorage.isEncryptionAvailable()) {
    const decrypted = decryptApiKey(currentKey);
    // If decrypted value equals the input, it means decryption failed (fallback) or wasn't needed,
    // which implies it is currently stored as plaintext (or invalid).
    if (decrypted === currentKey) {
      console.log('Migrating API key to encrypted storage...');
      settingsStore.set('apiKey', encryptApiKey(currentKey));
    }
  }

}

let mainWindow;
let tray;

// --- Window Creation ---
function createWindow() {
  const bounds = settingsStore.get('windowBounds');

  mainWindow = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    minWidth: 640,
    minHeight: 480,
    frame: false,
    transparent: false,
    backgroundColor: '#0f0f1a',
    show: false,
    skipTaskbar: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    },
    icon: path.join(__dirname, 'assets', 'icon.png')
  });

  mainWindow.loadFile('index.html');

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Hide to tray on close
  mainWindow.on('close', (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('resize', () => {
    const { width, height } = mainWindow.getBounds();
    settingsStore.set('windowBounds', { width, height });
  });
}

// --- Tray Icon ---
function createTray() {
  const iconPath = path.join(__dirname, 'assets', 'icon_tray.png');
  tray = new Tray(iconPath);

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show / Hide',
      click: () => toggleWindow()
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        app.isQuitting = true;
        app.quit();
      }
    }
  ]);

  tray.setToolTip('AI Translator');
  tray.setContextMenu(contextMenu);

  tray.on('double-click', () => toggleWindow());
}

function toggleWindow() {
  if (mainWindow.isVisible()) {
    mainWindow.hide();
  } else {
    mainWindow.show();
    mainWindow.focus();
  }
}

// --- Global Hotkey ---
function registerHotkey() {
  const hotkey = settingsStore.get('hotkey') || 'Ctrl+Shift+T';

  globalShortcut.unregisterAll();

  try {
    const success = globalShortcut.register(hotkey, () => {
      toggleWindow();
    });

    if (!success) {
      console.error(`Failed to register hotkey: ${hotkey}`);
    }
  } catch (err) {
    console.error(`Error registering hotkey ${hotkey}:`, err.message);
    // Optionally register a default hotkey or ignore
  }
}

// --- Gemini API ---
async function translateText(text, sourceLang, targetLang, apiKey, style = 'neutral', modelName = 'gemini-2.5-flash') {
  if (!apiKey) {
    throw new Error('API key is not set. Please enter it in the settings.');
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: modelName });

  let styleInstruction = '';
  if (style === 'formal') {
    styleInstruction = ' Use a formal, professional, and business-appropriate tone. Prefer official vocabulary, polite constructions, and structured phrasing typical of formal documents or business correspondence.';
  } else if (style === 'casual') {
    styleInstruction = ' Use a casual, conversational, and friendly tone. Prefer everyday vocabulary, natural speech patterns, colloquial expressions, and informal phrasing as if chatting with a friend.';
  }

  let prompt;
  if (sourceLang === targetLang) {
    prompt = `Correct any spelling, grammar, and punctuation errors in the following ${sourceLang} text.${styleInstruction} Return ONLY the corrected text, nothing else — no explanations, no quotes, no formatting.\n\nText:\n${text}`;
  } else {
    prompt = `Translate the following text from ${sourceLang} to ${targetLang}.${styleInstruction} Return ONLY the translated text, nothing else — no explanations, no quotes, no formatting.\n\nText:\n${text}`;
  }

  const result = await model.generateContent(prompt);
  const response = result.response;
  return response.text().trim();
}

// --- IPC Handlers ---
function setupIPC() {
  // Translation
  ipcMain.handle('translate', async (event, { text, sourceLang, targetLang, style }) => {
    try {
      const apiKey = decryptApiKey(settingsStore.get('apiKey'));
      const modelName = settingsStore.get('model') || 'gemini-2.5-flash';
      const translated = await translateText(text, sourceLang, targetLang, apiKey, style, modelName);

      // Save to history
      const items = historyStore.get('items') || [];
      items.unshift({
        id: Date.now(),
        sourceText: text,
        targetText: translated,
        sourceLang,
        targetLang,
        timestamp: new Date().toISOString()
      });
      // Max 100 entries
      if (items.length > 100) items.length = 100;
      historyStore.set('items', items);

      // Update recent languages
      updateRecentLanguages(sourceLang, targetLang);

      return { success: true, translated };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // Settings
  ipcMain.handle('get-settings', () => {
    return {
      apiKey: decryptApiKey(settingsStore.get('apiKey')),
      hotkey: settingsStore.get('hotkey'),
      recentLanguages: settingsStore.get('recentLanguages'),
      model: settingsStore.get('model') || 'gemini-2.5-flash'
    };
  });

  ipcMain.handle('save-settings', (event, settings) => {
    if (settings.apiKey !== undefined) settingsStore.set('apiKey', encryptApiKey(settings.apiKey));
    if (settings.model !== undefined) settingsStore.set('model', settings.model);
    if (settings.hotkey !== undefined) {
      settingsStore.set('hotkey', settings.hotkey);
      registerHotkey();
    }
    return { success: true };
  });

  // History
  ipcMain.handle('get-history', () => {
    return historyStore.get('items') || [];
  });

  ipcMain.handle('clear-history', () => {
    historyStore.set('items', []);
    return { success: true };
  });

  ipcMain.handle('delete-history-item', (event, id) => {
    const items = historyStore.get('items') || [];
    historyStore.set('items', items.filter(item => item.id !== id));
    return { success: true };
  });

  // Recent languages
  ipcMain.handle('get-recent-languages', () => {
    return settingsStore.get('recentLanguages') || [];
  });

  // Window management
  ipcMain.on('window-minimize', () => mainWindow.minimize());
  ipcMain.on('window-close', () => mainWindow.hide());

  // Hotkey management
  ipcMain.on('unregister-hotkey', () => globalShortcut.unregisterAll());
  ipcMain.on('register-hotkey', () => registerHotkey());

  // Opening links in browser
  ipcMain.on('open-external', async (event, url) => {
    if (!url || typeof url !== 'string') return;
    try {
      const parsed = new URL(url);
      if (['http:', 'https:'].includes(parsed.protocol)) {
        await shell.openExternal(url);
      } else {
        console.warn(`Blocked potential security risk: ${url}`);
      }
    } catch (err) {
      console.warn(`Invalid URL passed to open-external: ${url}`);
    }
  });
}

function updateRecentLanguages(source, target) {
  const recent = settingsStore.get('recentLanguages') || [];

  // Move to start
  const filtered = recent.filter(l => l !== source && l !== target);
  filtered.unshift(target);
  filtered.unshift(source);

  // Max 10
  if (filtered.length > 10) filtered.length = 10;
  settingsStore.set('recentLanguages', filtered);
}

// --- App lifecycle ---
app.whenReady().then(async () => {
  await initStores();
  createWindow();
  createTray();
  registerHotkey();
  setupIPC();
});

app.on('window-all-closed', () => {
  // Do not close the application
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
