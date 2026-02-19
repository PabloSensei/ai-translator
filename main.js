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
      recentLanguages: ['en', 'ru', 'de', 'fr', 'es', 'uk', 'zh', 'ja', 'ko', 'ar']
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

// --- Иконка трея (нарисованная программно) ---
function createTrayIcon() {
  const size = 32;
  const canvas = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
      <defs>
        <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style="stop-color:#6366f1"/>
          <stop offset="100%" style="stop-color:#a855f7"/>
        </linearGradient>
      </defs>
      <rect width="${size}" height="${size}" rx="6" fill="url(#bg)"/>
      <text x="50%" y="56%" dominant-baseline="middle" text-anchor="middle" fill="white" font-size="18" font-family="Segoe UI,Arial" font-weight="bold">T</text>
    </svg>
  `;

  // Создаём PNG из SVG через data URI
  const dataUrl = `data:image/svg+xml;base64,${Buffer.from(canvas).toString('base64')}`;
  return nativeImage.createFromDataURL(dataUrl);
}

function createTray() {
  const icon = createTrayIcon();
  tray = new Tray(icon.resize({ width: 16, height: 16 }));

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Показать / Скрыть',
      click: () => toggleWindow()
    },
    { type: 'separator' },
    {
      label: 'Выход',
      click: () => {
        app.isQuitting = true;
        app.quit();
      }
    }
  ]);

  tray.setToolTip('Gemini Translator');
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

  const success = globalShortcut.register(hotkey, () => {
    toggleWindow();
  });

  if (!success) {
    console.error(`Failed to register hotkey: ${hotkey}`);
  }
}

// --- Gemini API ---
async function translateText(text, sourceLang, targetLang, apiKey, style = 'neutral') {
  if (!apiKey) {
    throw new Error('API-ключ не задан. Введите ключ в настройках.');
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

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
      const translated = await translateText(text, sourceLang, targetLang, apiKey, style);

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
      recentLanguages: settingsStore.get('recentLanguages')
    };
  });

  ipcMain.handle('save-settings', (event, settings) => {
    if (settings.apiKey !== undefined) settingsStore.set('apiKey', settings.apiKey);
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
