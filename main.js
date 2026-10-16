const { app, safeStorage, BrowserWindow, Tray, Menu, globalShortcut, ipcMain, shell, nativeTheme, dialog } = require('electron');
const path = require('path');

const { resolveLanguage, getStyleInstruction, buildPrompt, cleanModelOutput } = require('./lib/prompt');
const {
  MAX_TEXT_LENGTH,
  sanitizeString,
  sanitizeProvider,
  sanitizeBareModelId,
  sanitizeOpenRouterModelId,
  sanitizeCustomStyles,
  mergeRecentPairs,
  isNewerVersion,
  looksEncrypted,
  isAllowedExternalUrl
} = require('./lib/settings');
const {
  GITHUB_REPO,
  DEFAULT_GEMINI_MODELS,
  DEFAULT_ANTHROPIC_MODEL,
  DEFAULT_ANTHROPIC_MODELS,
  getProvider
} = require('./lib/providers');

// electron-store — ESM-only module starting from v9, use dynamic import
let Store;
let settingsStore;
let historyStore;

const DEFAULT_HOTKEY = 'Ctrl+Shift+T';
const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash';
const MAX_HISTORY_ITEMS = 100;

// Settings key holding each provider's API key.
const API_KEY_FIELDS = {
  gemini: 'apiKey',
  openrouter: 'openrouterApiKey',
  anthropic: 'anthropicApiKey'
};

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

function decryptApiKey(stored) {
  if (!stored || typeof stored !== 'string') return '';
  if (!looksEncrypted(stored)) return stored; // legacy plaintext key
  if (!safeStorage.isEncryptionAvailable()) {
    console.error('An encrypted API key is stored, but the OS keychain is not available.');
    return '';
  }
  try {
    return safeStorage.decryptString(Buffer.from(stored, 'hex'));
  } catch (e) {
    // Never hand ciphertext to a provider as if it were the key itself.
    console.error('Failed to decrypt a stored API key:', e.message);
    return '';
  }
}

async function initStores() {
  const mod = await import('electron-store');
  Store = mod.default;

  settingsStore = new Store({
    name: 'settings',
    // A hand-edited, broken settings file should reset rather than brick startup.
    clearInvalidConfig: true,
    defaults: {
      apiKey: '',
      openrouterApiKey: '',
      anthropicApiKey: '',
      provider: 'gemini',
      hotkey: DEFAULT_HOTKEY,
      windowBounds: { width: 860, height: 640 },
      // Filled in from actual usage — starts empty on a fresh install.
      recentPairs: [],
      model: DEFAULT_GEMINI_MODEL,
      openrouterModel: '',
      anthropicModel: DEFAULT_ANTHROPIC_MODEL,
      theme: 'dark',
      style: 'neutral',
      customStyles: []
    }
  });

  historyStore = new Store({
    name: 'history',
    clearInvalidConfig: true,
    defaults: {
      items: []
    }
  });

  // Migrate legacy plaintext API keys
  if (safeStorage.isEncryptionAvailable()) {
    for (const field of Object.values(API_KEY_FIELDS)) {
      const current = settingsStore.get(field);
      if (current && !looksEncrypted(current)) {
        console.log(`Migrating ${field} to encrypted storage...`);
        settingsStore.set(field, encryptApiKey(current));
      }
    }
  }
}

let mainWindow;
let tray;

const THEME_BACKGROUNDS = { dark: '#0f0f1a', light: '#f5f6fb' };

function resolveTheme(theme) {
  if (theme === 'system') return nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
  return theme === 'light' ? 'light' : 'dark';
}

// --- Window Creation ---
function createWindow() {
  const bounds = settingsStore.get('windowBounds') || {};
  const theme = resolveTheme(settingsStore.get('theme'));

  mainWindow = new BrowserWindow({
    width: Number(bounds.width) || 860,
    height: Number(bounds.height) || 640,
    minWidth: 640,
    minHeight: 480,
    frame: false,
    transparent: false,
    backgroundColor: THEME_BACKGROUNDS[theme],
    show: false,
    skipTaskbar: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      sandbox: true,
      webviewTag: false,
      webSecurity: true,
      allowRunningInsecureContent: false
    },
    icon: path.join(__dirname, 'assets', 'icon.png')
  });

  lockDownNavigation(mainWindow.webContents);
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

  // 'resize' fires continuously while dragging; writing the settings file on
  // every event is needless disk churn, so persist once the drag settles.
  let resizeTimer = null;
  mainWindow.on('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (!mainWindow || mainWindow.isDestroyed() || mainWindow.isMaximized()) return;
      const { width, height } = mainWindow.getBounds();
      settingsStore.set('windowBounds', { width, height });
    }, 400);
  });
}

// The renderer only ever shows the bundled index.html. Any attempt to open a new
// window or navigate elsewhere is denied, so a compromised renderer cannot load
// remote content into a context that has the preload bridge attached. External
// links go through the 'open-external' allowlist instead.
function lockDownNavigation(contents) {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));

  contents.on('will-navigate', (event, url) => {
    if (url !== contents.getURL()) {
      event.preventDefault();
      console.warn(`Blocked in-app navigation to: ${url}`);
    }
  });

  contents.on('will-attach-webview', (event) => {
    event.preventDefault();
  });
}

// Keep the renderer in sync when the OS theme changes and "system" is selected.
// Registered once for the app, not per window.
function watchSystemTheme() {
  nativeTheme.on('updated', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (settingsStore.get('theme') !== 'system') return;
    const resolved = resolveTheme('system');
    mainWindow.setBackgroundColor(THEME_BACKGROUNDS[resolved]);
    mainWindow.webContents.send('system-theme-changed', resolved);
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
  // On Windows a single click on a tray icon is the expected way to open an app.
  if (process.platform === 'win32') {
    tray.on('click', () => toggleWindow());
  }
}

function showWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

// The hotkey should bring the window forward when it is minimised or behind
// other windows, and only hide it when it is actually in front of the user.
function toggleWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isVisible() && !mainWindow.isMinimized() && mainWindow.isFocused()) {
    mainWindow.hide();
  } else {
    showWindow();
  }
}

// --- Global Hotkey ---
// Registers the given accelerator, or the saved one. Returns false when the OS
// refused it (invalid accelerator, or taken by another application).
function registerHotkey(hotkey = settingsStore.get('hotkey') || DEFAULT_HOTKEY) {
  globalShortcut.unregisterAll();
  try {
    const success = globalShortcut.register(hotkey, () => toggleWindow());
    if (!success) console.error(`Failed to register hotkey: ${hotkey}`);
    return success;
  } catch (err) {
    console.error(`Error registering hotkey ${hotkey}:`, err.message);
    return false;
  }
}

// --- Update check ---
async function checkForUpdates() {
  const currentVersion = app.getVersion();
  const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, {
    headers: { 'Accept': 'application/vnd.github+json', 'User-Agent': 'AI-Translator' },
    signal: AbortSignal.timeout(15000)
  });

  if (res.status === 404) {
    return { success: true, updateAvailable: false, currentVersion, latestVersion: null, note: 'No releases published yet.' };
  }
  if (!res.ok) {
    throw new Error(`GitHub API error ${res.status}`);
  }

  const data = await res.json();
  const latestVersion = String(data.tag_name || '').replace(/^v/i, '');
  return {
    success: true,
    currentVersion,
    latestVersion,
    updateAvailable: Boolean(latestVersion) && isNewerVersion(latestVersion, currentVersion),
    releaseUrl: `https://github.com/${GITHUB_REPO}/releases/latest`
  };
}

// --- IPC Handlers ---
const ALLOWED_EXTERNAL_URLS = [
  'https://aistudio.google.com/apikey',
  'https://aistudio.google.com/',
  'https://openrouter.ai/keys',
  'https://openrouter.ai/models',
  'https://platform.claude.com/settings/keys',
  `https://github.com/${GITHUB_REPO}`,
  `https://github.com/${GITHUB_REPO}/releases`,
  `https://github.com/${GITHUB_REPO}/releases/latest`
];

function getApiKey(provider) {
  return decryptApiKey(settingsStore.get(API_KEY_FIELDS[provider]));
}

function getModelFor(provider) {
  if (provider === 'openrouter') return settingsStore.get('openrouterModel') || '';
  if (provider === 'anthropic') return settingsStore.get('anthropicModel') || DEFAULT_ANTHROPIC_MODEL;
  return settingsStore.get('model') || DEFAULT_GEMINI_MODEL;
}

function setupIPC() {
  // Translation
  ipcMain.handle('translate', async (event, request) => {
    try {
      const { text, sourceLang, targetLang, style, mode } = request || {};
      const isFix = mode === 'fix';

      if (typeof text !== 'string' || !text.trim()) {
        throw new Error('Nothing to translate.');
      }
      if (text.length > MAX_TEXT_LENGTH) {
        throw new Error(`The text is too long (${text.length} characters). The limit is ${MAX_TEXT_LENGTH}.`);
      }

      const source = resolveLanguage(sourceLang, { allowAuto: true }) || resolveLanguage('auto', { allowAuto: true });
      const target = resolveLanguage(targetLang);
      if (!isFix && !target) throw new Error('Unknown target language.');

      const provider = sanitizeProvider(settingsStore.get('provider'));
      const styleInstruction = getStyleInstruction(style, settingsStore.get('customStyles'));
      const prompt = buildPrompt({
        text,
        sourceLang: source.english,
        targetLang: target ? target.english : '',
        mode: isFix ? 'fix' : 'translate',
        styleInstruction
      });

      const raw = await getProvider(provider).generate(prompt, getApiKey(provider), getModelFor(provider));
      const translated = cleanModelOutput(raw);
      if (!translated) throw new Error('The model returned an empty response.');

      // Save to history. Languages are stored as codes; older entries hold
      // display names and are still resolved by the renderer.
      const items = historyStore.get('items') || [];
      items.unshift({
        id: Date.now(),
        sourceText: text,
        targetText: translated,
        sourceLang: source.code,
        targetLang: target ? target.code : '',
        mode: isFix ? 'fix' : 'translate',
        timestamp: new Date().toISOString()
      });
      if (items.length > MAX_HISTORY_ITEMS) items.length = MAX_HISTORY_ITEMS;
      historyStore.set('items', items);

      return { success: true, translated };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // Settings
  ipcMain.handle('get-settings', () => {
    const theme = settingsStore.get('theme') || 'dark';
    return {
      apiKey: getApiKey('gemini'),
      openrouterApiKey: getApiKey('openrouter'),
      anthropicApiKey: getApiKey('anthropic'),
      provider: sanitizeProvider(settingsStore.get('provider')),
      hotkey: settingsStore.get('hotkey'),
      recentPairs: settingsStore.get('recentPairs') || [],
      model: getModelFor('gemini'),
      openrouterModel: getModelFor('openrouter'),
      anthropicModel: getModelFor('anthropic'),
      theme,
      resolvedTheme: resolveTheme(theme),
      style: settingsStore.get('style') || 'neutral',
      customStyles: sanitizeCustomStyles(settingsStore.get('customStyles')),
      defaultGeminiModels: DEFAULT_GEMINI_MODELS,
      defaultAnthropicModels: DEFAULT_ANTHROPIC_MODELS,
      version: app.getVersion()
    };
  });

  ipcMain.handle('save-settings', (event, settings) => {
    if (!settings || typeof settings !== 'object') return { success: false, error: 'Invalid settings.' };

    // An empty string is a deliberate "remove this key".
    if (settings.apiKey !== undefined) {
      settingsStore.set('apiKey', encryptApiKey(sanitizeString(settings.apiKey, 400)));
    }
    if (settings.openrouterApiKey !== undefined) {
      settingsStore.set('openrouterApiKey', encryptApiKey(sanitizeString(settings.openrouterApiKey, 400)));
    }
    if (settings.anthropicApiKey !== undefined) {
      settingsStore.set('anthropicApiKey', encryptApiKey(sanitizeString(settings.anthropicApiKey, 400)));
    }
    if (settings.provider !== undefined) {
      settingsStore.set('provider', sanitizeProvider(settings.provider));
    }
    if (settings.model !== undefined) {
      const model = sanitizeBareModelId(settings.model);
      if (model) settingsStore.set('model', model);
    }
    if (settings.openrouterModel !== undefined) {
      const model = sanitizeOpenRouterModelId(settings.openrouterModel);
      if (model) settingsStore.set('openrouterModel', model);
    }
    if (settings.anthropicModel !== undefined) {
      const model = sanitizeBareModelId(settings.anthropicModel);
      if (model) settingsStore.set('anthropicModel', model);
    }
    if (settings.style !== undefined) {
      settingsStore.set('style', sanitizeString(settings.style, 64) || 'neutral');
    }
    if (settings.customStyles !== undefined) {
      settingsStore.set('customStyles', sanitizeCustomStyles(settings.customStyles));
    }
    if (settings.theme !== undefined) {
      const theme = ['dark', 'light', 'system'].includes(settings.theme) ? settings.theme : 'dark';
      settingsStore.set('theme', theme);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.setBackgroundColor(THEME_BACKGROUNDS[resolveTheme(theme)]);
      }
    }

    const result = { success: true, resolvedTheme: resolveTheme(settingsStore.get('theme')) };

    if (settings.hotkey !== undefined) {
      const hotkey = sanitizeString(settings.hotkey, 64);
      const previous = settingsStore.get('hotkey') || DEFAULT_HOTKEY;
      if (hotkey && hotkey !== previous) {
        // Only keep a shortcut the OS actually accepted; otherwise the old
        // one stays active and the user is told why.
        if (registerHotkey(hotkey)) {
          settingsStore.set('hotkey', hotkey);
        } else {
          registerHotkey(previous);
          result.hotkeyError = `The shortcut ${hotkey} could not be registered — it may be invalid or used by another app. Keeping ${previous}.`;
          result.hotkey = previous;
        }
      }
    }
    return result;
  });

  // Models
  ipcMain.handle('list-models', async (event, providerName) => {
    const provider = sanitizeProvider(providerName);
    try {
      const models = await getProvider(provider).listModels(getApiKey(provider));
      return { success: true, models };
    } catch (err) {
      return {
        success: false,
        error: err.message,
        models: getProvider(provider).defaultModels
      };
    }
  });

  // Updates
  ipcMain.handle('check-for-updates', async () => {
    try {
      return await checkForUpdates();
    } catch (err) {
      return { success: false, error: err.message, currentVersion: app.getVersion() };
    }
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

  // Recent language pairs
  ipcMain.handle('get-recent-pairs', () => {
    return settingsStore.get('recentPairs') || [];
  });

  ipcMain.handle('add-recent-pair', (event, pair) => {
    const existing = settingsStore.get('recentPairs') || [];
    const updated = mergeRecentPairs(existing, pair);
    if (updated !== existing) settingsStore.set('recentPairs', updated);
    return { success: true, pairs: updated };
  });

  // Read synchronously by the preload script so the first paint already uses
  // the right theme — otherwise light-theme users see a dark flash on startup.
  ipcMain.on('get-initial-theme', (event) => {
    event.returnValue = resolveTheme(settingsStore.get('theme'));
  });

  // Window management
  ipcMain.on('window-minimize', () => mainWindow && mainWindow.minimize());
  ipcMain.on('window-close', () => mainWindow && mainWindow.hide());

  // Hotkey management
  ipcMain.on('unregister-hotkey', () => globalShortcut.unregisterAll());
  ipcMain.on('register-hotkey', () => registerHotkey());

  // Opening links in browser
  ipcMain.on('open-external', async (event, url) => {
    if (isAllowedExternalUrl(url, ALLOWED_EXTERNAL_URLS)) {
      await shell.openExternal(url);
    } else {
      console.warn(`Blocked URL not in allowlist: ${url}`);
    }
  });
}

// --- App lifecycle ---
// A second copy would add a second tray icon and fight over the global hotkey;
// bring the running window forward instead.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => showWindow());

  app.whenReady().then(async () => {
    try {
      await initStores();
    } catch (err) {
      console.error('Failed to initialize electron-store:', err);
      dialog.showErrorBox('AI Translator', `Could not load the settings:\n${err.message}`);
      app.isQuitting = true;
      app.quit();
      return;
    }
    // IPC must be ready before the window loads: the preload script reads the
    // initial theme synchronously.
    setupIPC();
    createWindow();
    createTray();
    registerHotkey();
    watchSystemTheme();
  });
}

app.on('window-all-closed', () => {
  // Do not close the application
});

// Cmd+Q, the app menu, an OS shutdown or an installer update all go through
// before-quit. Without this flag the 'close' handler would cancel them and
// hide the window instead, so the app could only be quit from the tray.
app.on('before-quit', () => {
  app.isQuitting = true;
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

// macOS: clicking the dock icon. The window is normally hidden, not destroyed.
app.on('activate', () => {
  if (!settingsStore) return;
  if (mainWindow && !mainWindow.isDestroyed()) {
    showWindow();
  } else {
    createWindow();
  }
});
