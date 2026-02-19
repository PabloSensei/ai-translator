const { app, BrowserWindow, Tray, Menu, globalShortcut, ipcMain, nativeImage, dialog } = require('electron');
const path = require('path');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// electron-store — ESM-only модуль начиная с v9, используем динамический import
let Store;
let settingsStore;
let historyStore;

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
}

let mainWindow;
let tray;

// --- Создание окна ---
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

  // Скрыть в трей при закрытии
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

// --- Иконка трея ---
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

// --- Глобальный хоткей ---
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

  const prompt = `Translate the following text from ${sourceLang} to ${targetLang}.${styleInstruction} Return ONLY the translated text, nothing else — no explanations, no quotes, no formatting.\n\nText:\n${text}`;

  const result = await model.generateContent(prompt);
  const response = result.response;
  return response.text().trim();
}

// --- IPC Handlers ---
function setupIPC() {
  // Перевод
  ipcMain.handle('translate', async (event, { text, sourceLang, targetLang, style }) => {
    try {
      const apiKey = settingsStore.get('apiKey');
      const modelName = settingsStore.get('model') || 'gemini-2.5-flash';
      const translated = await translateText(text, sourceLang, targetLang, apiKey, style, modelName);

      // Сохранить в историю
      const items = historyStore.get('items') || [];
      items.unshift({
        id: Date.now(),
        sourceText: text,
        targetText: translated,
        sourceLang,
        targetLang,
        timestamp: new Date().toISOString()
      });
      // Макс 100 записей
      if (items.length > 100) items.length = 100;
      historyStore.set('items', items);

      // Обновить недавние языки
      updateRecentLanguages(sourceLang, targetLang);

      return { success: true, translated };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // Настройки
  ipcMain.handle('get-settings', () => {
    return {
      apiKey: settingsStore.get('apiKey'),
      hotkey: settingsStore.get('hotkey'),
      recentLanguages: settingsStore.get('recentLanguages'),
      model: settingsStore.get('model') || 'gemini-2.5-flash'
    };
  });

  ipcMain.handle('save-settings', (event, settings) => {
    if (settings.apiKey !== undefined) settingsStore.set('apiKey', settings.apiKey);
    if (settings.model !== undefined) settingsStore.set('model', settings.model);
    if (settings.hotkey !== undefined) {
      settingsStore.set('hotkey', settings.hotkey);
      registerHotkey();
    }
    return { success: true };
  });

  // История
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

  // Недавние языки
  ipcMain.handle('get-recent-languages', () => {
    return settingsStore.get('recentLanguages') || [];
  });

  // Управление окном
  ipcMain.on('window-minimize', () => mainWindow.minimize());
  ipcMain.on('window-close', () => mainWindow.hide());

  // Управление хоткеями
  ipcMain.on('unregister-hotkey', () => globalShortcut.unregisterAll());
  ipcMain.on('register-hotkey', () => registerHotkey());
}

function updateRecentLanguages(source, target) {
  const recent = settingsStore.get('recentLanguages') || [];

  // Переместить в начало
  const filtered = recent.filter(l => l !== source && l !== target);
  filtered.unshift(target);
  filtered.unshift(source);

  // Макс 10
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
  // Не закрывать приложение
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
