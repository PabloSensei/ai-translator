const { app, safeStorage, BrowserWindow, Tray, Menu, globalShortcut, ipcMain, shell, nativeTheme, dialog, clipboard, ClipboardItem, systemPreferences } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');

const { resolveLanguage, getStyleInstruction, buildPrompt, cleanModelOutput, NO_TEXT_MARKER } = require('./lib/prompt');
const {
  MAX_TEXT_LENGTH,
  sanitizeString,
  sanitizeImage,
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
const { trimHistory, formatHistoryExport, EXPORT_FORMATS } = require('./lib/history');
const { copySelectedText, acceleratorModifiers } = require('./lib/selection');
const { createUpdater, CAN_INSTALL_UPDATES, CHECK_DELAY_MS, CHECK_INTERVAL_MS, RELEASES_URL } = require('./lib/updater');

// electron-store — ESM-only module starting from v9, use dynamic import
let Store;
let settingsStore;
let historyStore;

const DEFAULT_HOTKEY = 'Ctrl+Shift+T';
// Not a Ctrl+Alt combination: on Polish and many other layouts Ctrl+Alt is
// AltGr and types characters (Ctrl+Alt+C = ć).
const DEFAULT_SELECTION_HOTKEY = 'Ctrl+Shift+Y';
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
      // Empty string disables it.
      selectionHotkey: DEFAULT_SELECTION_HOTKEY,
      windowBounds: { width: 860, height: 640 },
      // Filled in from actual usage — starts empty on a fresh install.
      recentPairs: [],
      model: DEFAULT_GEMINI_MODEL,
      openrouterModel: '',
      anthropicModel: DEFAULT_ANTHROPIC_MODEL,
      theme: 'dark',
      style: 'neutral',
      customStyles: [],
      // Glass theme: let the desktop show through (where the OS can blur it).
      glassSeeThrough: true,
      // Download new versions in the background; they install on the next quit.
      autoUpdate: true
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

const THEMES = ['dark', 'light', 'system', 'glass'];
// Window colour behind the page: what shows before the first paint and
// while resizing. Glass without native blur paints its own backdrop.
const THEME_BACKGROUNDS = { dark: '#0f0f1a', light: '#f5f6fb', glass: '#1a1035' };

function resolveTheme(theme) {
  if (theme === 'system') return nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
  return theme === 'light' || theme === 'glass' ? theme : 'dark';
}

// Where the OS can blur what is behind a window: macOS vibrancy, and the
// Acrylic material of Windows 11 22H2 (build 22621) and later. Elsewhere the
// glass theme draws its own backdrop inside the window.
const NATIVE_GLASS = process.platform === 'darwin' ||
  (process.platform === 'win32' && Number(os.release().split('.')[2]) >= 22621);

// True when the window is currently see-through.
function glassSeeThrough() {
  return NATIVE_GLASS &&
    resolveTheme(settingsStore.get('theme')) === 'glass' &&
    settingsStore.get('glassSeeThrough') !== false;
}

// Applies the theme to the window itself: its background colour, and the
// system blur material for the see-through glass theme.
function applyWindowLook() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const seeThrough = glassSeeThrough();
  try {
    if (process.platform === 'darwin') {
      mainWindow.setVibrancy(seeThrough ? 'under-window' : null);
    } else if (process.platform === 'win32' && NATIVE_GLASS) {
      mainWindow.setBackgroundMaterial(seeThrough ? 'acrylic' : 'none');
    }
  } catch (err) {
    console.error('Could not change the window material:', err.message);
  }
  mainWindow.setBackgroundColor(seeThrough ? '#00000000' : THEME_BACKGROUNDS[resolveTheme(settingsStore.get('theme'))]);
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
    backgroundColor: glassSeeThrough() ? '#00000000' : THEME_BACKGROUNDS[theme],
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
  // Before the first paint, so a see-through glass window opens blurred.
  applyWindowLook();
  mainWindow.loadFile('index.html');

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Windows does not emit 'before-quit' on shutdown, restart or log-off
  // (see app 'before-quit' in electron.d.ts): without this the window would
  // hide itself instead of closing and hold up the session end.
  mainWindow.on('session-end', () => {
    app.isQuitting = true;
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
    applyWindowLook();
    mainWindow.webContents.send('system-theme-changed', resolved);
  });
}

// --- Tray Icon ---
function buildTrayMenu() {
  const template = [
    {
      label: 'Show / Hide',
      click: () => toggleWindow()
    },
    {
      label: 'Translate Clipboard',
      // The clipboard only, as the label says: the hotkey also looks at
      // the selection first, and with the tray menu open there is none.
      click: () => translateSelection({ fromSelection: false })
    },
    { type: 'separator' }
  ];
  if (updater && updater.status.state === 'downloaded') {
    template.push({
      label: `Restart to Install v${updater.status.version}`,
      click: () => installUpdate()
    }, { type: 'separator' });
  }
  template.push({
    label: 'Quit',
    click: () => {
      app.isQuitting = true;
      app.quit();
    }
  });
  return Menu.buildFromTemplate(template);
}

function createTray() {
  const iconPath = path.join(__dirname, 'assets', 'icon_tray.png');
  tray = new Tray(iconPath);

  tray.setToolTip('AI Translator');
  tray.setContextMenu(buildTrayMenu());

  // On Windows a single click on a tray icon is the expected way to open an
  // app. A double-click there also delivers a click first, so listening to
  // both would show the window and hide it again.
  if (process.platform === 'win32') {
    tray.on('click', () => toggleWindow());
  } else {
    tray.on('double-click', () => toggleWindow());
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

// --- Translate selection ---
// The clipboard API is asynchronous (Electron 44+), and every read can fail
// on a busy or odd clipboard owner, so failures count as "nothing there".
//
// Linux (X11 and most Wayland compositors) exposes the current selection as
// the PRIMARY clipboard, so highlighted text can be read without copying it.
// Windows and macOS have no such buffer: there the app presses Ctrl+C (Cmd+C)
// for the user (lib/selection.js) and falls back to whatever is already on
// the clipboard when nothing new gets copied.
async function readSelectedText({ fromSelection = true } = {}) {
  if (fromSelection && process.platform === 'linux' && clipboard.selection) {
    const primary = await clipboard.selection.readText().catch(() => '');
    if (primary && primary.trim()) return primary;
  }
  if (fromSelection && (process.platform === 'win32' || process.platform === 'darwin')) {
    const keyboard = getSystemKeyboard();
    if (keyboard) {
      const copied = await copySelectedText({
        clipboard,
        ClipboardItem,
        keyboard,
        sleep: (ms) => new Promise(resolve => setTimeout(resolve, ms))
      }).catch(err => {
        console.error('Copying the selection failed:', err.message);
        return '';
      });
      if (copied && copied.trim()) return copied;
    }
  }
  return clipboard.readText().catch(() => '');
}

// Presses Ctrl+C (Cmd+C) in the focused app through uiohook-napi, or null
// where that is unavailable: Linux (which has PRIMARY instead), a native
// module that failed to load, or macOS without the Accessibility permission.
let uiohook;
let accessibilityPrompted = false;
function getSystemKeyboard() {
  if (process.platform === 'darwin' && !systemPreferences.isTrustedAccessibilityClient(false)) {
    // Ask once per run; macOS shows its own dialog that leads to
    // System Settings → Privacy & Security → Accessibility.
    if (!accessibilityPrompted) {
      accessibilityPrompted = true;
      systemPreferences.isTrustedAccessibilityClient(true);
    }
    return null;
  }
  if (uiohook === undefined) {
    try {
      uiohook = require('uiohook-napi');
    } catch (err) {
      console.error('uiohook-napi is unavailable, the hotkey will use the clipboard:', err.message);
      uiohook = null;
    }
  }
  if (!uiohook) return null;

  const { uIOhook, UiohookKey: K } = uiohook;
  const codes = {
    Ctrl: [K.Ctrl, K.CtrlRight],
    Alt: [K.Alt, K.AltRight],
    Shift: [K.Shift, K.ShiftRight],
    Meta: [K.Meta, K.MetaRight]
  };
  const copyModifier = process.platform === 'darwin' ? K.Meta : K.Ctrl;
  return {
    pressCopy() {
      // The copy modifier goes down before the hotkey's other modifiers are
      // lifted: a lone Alt release would open the app's menu bar on Windows,
      // and a lone Win release the Start menu.
      uIOhook.keyToggle(copyModifier, 'down');
      for (const name of acceleratorModifiers(savedHotkeys().selectionHotkey)) {
        for (const code of codes[name]) {
          if (code !== copyModifier) uIOhook.keyToggle(code, 'up');
        }
      }
      uIOhook.keyTap(K.C);
      uIOhook.keyToggle(copyModifier, 'up');
    }
  };
}

// A screenshot copied to the clipboard (Win+Shift+S, Cmd+Ctrl+Shift+4,
// PrtSc on most Linux desktops), as a data URL, or '' when there is none.
async function readClipboardImage() {
  try {
    for (const item of await clipboard.read()) {
      const type = item.types.find(t => /^image\/(png|jpeg|webp|gif|bmp)$/.test(t));
      if (!type) continue;
      const blob = await item.getType(type);
      const data = Buffer.from(await blob.arrayBuffer()).toString('base64');
      return `data:${type};base64,${data}`;
    }
  } catch (e) {
    console.error('Failed to read an image from the clipboard:', e.message);
  }
  return '';
}

async function translateSelection({ fromSelection = true } = {}) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  // Read before the window shows: the selection belongs to the app that has
  // focus now. Text wins: a copied web image often comes with text alongside it.
  const text = (await readSelectedText({ fromSelection })).trim();
  const imageUrl = text ? '' : await readClipboardImage();
  if (mainWindow.isDestroyed()) return;
  showWindow();
  const send = () => {
    if (imageUrl) {
      mainWindow.webContents.send('translate-image', imageUrl);
    } else {
      mainWindow.webContents.send('translate-text', text);
    }
  };
  if (mainWindow.webContents.isLoading()) {
    mainWindow.webContents.once('did-finish-load', send);
  } else {
    send();
  }
}

// --- Global Hotkeys ---
// A shortcut taken by another app at login would otherwise fail silently,
// and with no tray icon (GNOME without AppIndicator) the hidden window could
// not be brought back.
function warnAboutHotkeys(failed) {
  if (!failed.length || !mainWindow || mainWindow.isDestroyed()) return;
  const hotkeys = savedHotkeys();
  const message = `${failed.map(field => hotkeys[field]).join(', ')} could not be registered — it may be used by another app. Pick another shortcut in Settings.`;
  const send = () => mainWindow.webContents.send('hotkey-warning', message);
  if (mainWindow.webContents.isLoading()) {
    mainWindow.webContents.once('did-finish-load', send);
  } else {
    send();
  }
}

const HOTKEYS = {
  hotkey: { action: () => toggleWindow() },
  selectionHotkey: { action: () => translateSelection() }
};

function savedHotkeys() {
  return {
    hotkey: settingsStore.get('hotkey') || DEFAULT_HOTKEY,
    selectionHotkey: settingsStore.get('selectionHotkey') ?? DEFAULT_SELECTION_HOTKEY
  };
}

// Registers every global shortcut, from `hotkeys` or the saved settings.
// Returns the setting names the OS refused (invalid accelerator, or taken by
// another application); an empty accelerator means "disabled" and is skipped.
function registerHotkeys(hotkeys = savedHotkeys()) {
  globalShortcut.unregisterAll();
  const failed = [];
  for (const [field, { action }] of Object.entries(HOTKEYS)) {
    const accelerator = hotkeys[field];
    if (!accelerator) continue;
    try {
      if (!globalShortcut.register(accelerator, action)) failed.push(field);
    } catch (err) {
      failed.push(field);
    }
    if (failed.includes(field)) console.error(`Failed to register hotkey: ${accelerator}`);
  }
  return failed;
}

// --- Automatic updates ---
// Only a packaged build can update itself; `npm start` falls back to the
// GitHub release check below.
let updater = null;
let trayShowsUpdate = false;

function initAutoUpdater() {
  if (!app.isPackaged) return;
  let autoUpdater;
  try {
    ({ autoUpdater } = require('electron-updater'));
  } catch (err) {
    console.error('electron-updater is unavailable:', err.message);
    return;
  }
  autoUpdater.logger = console;

  updater = createUpdater({
    updater: autoUpdater,
    currentVersion: app.getVersion(),
    autoDownload: settingsStore.get('autoUpdate') !== false,
    canInstall: CAN_INSTALL_UPDATES,
    onStatus: (status) => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('update-status', status);
      // The tray menu only changes when an update becomes (or stops being)
      // ready; download progress fires many times a second.
      const ready = status.state === 'downloaded';
      if (ready !== trayShowsUpdate && tray && !tray.isDestroyed()) {
        trayShowsUpdate = ready;
        tray.setContextMenu(buildTrayMenu());
      }
    }
  });

  setTimeout(() => updater.check(), CHECK_DELAY_MS).unref();
  setInterval(() => updater.check(), CHECK_INTERVAL_MS).unref();
}

function installUpdate() {
  // On Windows and Linux electron-updater installs, then calls app.quit(),
  // whose 'before-quit' lets the windows close. isQuitting is not set here:
  // if the install fails the app keeps running, and closing the window
  // must still hide it to the tray rather than destroy it. (macOS, where
  // Squirrel closes windows before 'before-quit', never installs updates.)
  if (updater) updater.install();
}

// --- Update check (without electron-updater) ---
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
    releaseUrl: RELEASES_URL(GITHUB_REPO)
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
  RELEASES_URL(GITHUB_REPO)
];

function getApiKey(provider) {
  return decryptApiKey(settingsStore.get(API_KEY_FIELDS[provider]));
}

// Keys never travel back to the renderer: it only learns which ones are
// saved. A key that can no longer be decrypted counts as missing.
function savedKeyFlags() {
  const flags = {};
  for (const provider of Object.keys(API_KEY_FIELDS)) flags[provider] = Boolean(getApiKey(provider));
  return flags;
}

function getModelFor(provider) {
  if (provider === 'openrouter') return settingsStore.get('openrouterModel') || '';
  if (provider === 'anthropic') return settingsStore.get('anthropicModel') || DEFAULT_ANTHROPIC_MODEL;
  return settingsStore.get('model') || DEFAULT_GEMINI_MODEL;
}

// In-flight translations by renderer request id, so they can be cancelled.
const inflightTranslations = new Map();

function setupIPC() {
  // Translation. The answer is streamed to the renderer as 'translate-delta'
  // events while it is generated; the resolved value is the final, cleaned text.
  ipcMain.handle('translate', async (event, request) => {
    const { requestId } = request || {};
    const id = Number.isSafeInteger(requestId) ? requestId : null;
    const controller = new AbortController();
    if (id !== null) inflightTranslations.set(id, controller);

    try {
      const { text, sourceLang, targetLang, style, mode } = request || {};
      const isFix = mode === 'fix';
      // An image replaces the text: the model reads the text off the image.
      const image = sanitizeImage(request && request.image);

      if (!image && (typeof text !== 'string' || !text.trim())) {
        throw new Error('Nothing to translate.');
      }
      if (!image && text.length > MAX_TEXT_LENGTH) {
        throw new Error(`The text is too long (${text.length} characters). The limit is ${MAX_TEXT_LENGTH}.`);
      }

      const source = resolveLanguage(sourceLang, { allowAuto: true }) || resolveLanguage('auto', { allowAuto: true });
      const target = resolveLanguage(targetLang);
      if (!isFix && !target) throw new Error('Unknown target language.');

      const provider = sanitizeProvider(settingsStore.get('provider'));
      const styleInstruction = getStyleInstruction(style, settingsStore.get('customStyles'));
      const prompt = buildPrompt({
        text: image ? '' : text,
        image: Boolean(image),
        sourceLang: source.english,
        targetLang: target ? target.english : '',
        mode: isFix ? 'fix' : 'translate',
        styleInstruction
      });

      const onDelta = id === null ? undefined : (delta) => {
        if (!event.sender.isDestroyed()) event.sender.send('translate-delta', { requestId: id, delta });
      };
      const raw = await getProvider(provider).generate({ ...prompt, image }, getApiKey(provider), getModelFor(provider), {
        signal: controller.signal,
        onDelta
      });
      if (controller.signal.aborted) return { success: false, cancelled: true };
      const translated = cleanModelOutput(raw);
      if (!translated) throw new Error('The model returned an empty response.');
      if (image && translated === NO_TEXT_MARKER) throw new Error('No text found in the image.');

      // Save to history. Languages are stored as codes; older entries hold
      // display names and are still resolved by the renderer.
      const items = historyStore.get('items') || [];
      items.unshift({
        id: Date.now(),
        // The image itself is not kept: it can be large and may be private.
        sourceText: image ? '' : text,
        ...(image ? { image: true } : {}),
        targetText: translated,
        sourceLang: source.code,
        targetLang: target ? target.code : '',
        mode: isFix ? 'fix' : 'translate',
        timestamp: new Date().toISOString()
      });
      historyStore.set('items', trimHistory(items, MAX_HISTORY_ITEMS));

      return { success: true, translated };
    } catch (err) {
      if (controller.signal.aborted) return { success: false, cancelled: true };
      return { success: false, error: err.message };
    } finally {
      if (id !== null) inflightTranslations.delete(id);
    }
  });

  ipcMain.handle('read-clipboard-image', () => readClipboardImage());

  ipcMain.handle('get-update-status', () => (updater ? updater.status : null));
  ipcMain.handle('download-update', () => (updater ? updater.download() : null));
  ipcMain.on('install-update', () => installUpdate());

  ipcMain.on('cancel-translation', (event, requestId) => {
    const controller = inflightTranslations.get(requestId);
    if (controller) controller.abort();
  });

  // Settings
  ipcMain.handle('get-settings', () => {
    const theme = settingsStore.get('theme') || 'dark';
    return {
      savedKeys: savedKeyFlags(),
      provider: sanitizeProvider(settingsStore.get('provider')),
      hotkey: savedHotkeys().hotkey,
      selectionHotkey: savedHotkeys().selectionHotkey,
      recentPairs: settingsStore.get('recentPairs') || [],
      model: getModelFor('gemini'),
      openrouterModel: getModelFor('openrouter'),
      anthropicModel: getModelFor('anthropic'),
      theme,
      resolvedTheme: resolveTheme(theme),
      glassSeeThrough: settingsStore.get('glassSeeThrough') !== false,
      glassNativeSupported: NATIVE_GLASS,
      seeThrough: glassSeeThrough(),
      style: settingsStore.get('style') || 'neutral',
      customStyles: sanitizeCustomStyles(settingsStore.get('customStyles')),
      defaultGeminiModels: DEFAULT_GEMINI_MODELS,
      defaultAnthropicModels: DEFAULT_ANTHROPIC_MODELS,
      autoUpdate: settingsStore.get('autoUpdate') !== false,
      // False in development; on macOS updates are announced but not installed.
      autoUpdateSupported: Boolean(updater) && CAN_INSTALL_UPDATES,
      version: app.getVersion()
    };
  });

  ipcMain.handle('save-settings', (event, settings) => {
    if (!settings || typeof settings !== 'object') return { success: false, error: 'Invalid settings.' };

    // An empty string is a deliberate "remove this key".
    for (const field of Object.values(API_KEY_FIELDS)) {
      if (settings[field] !== undefined) {
        settingsStore.set(field, encryptApiKey(sanitizeString(settings[field], 400)));
      }
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
    if (settings.autoUpdate !== undefined) {
      settingsStore.set('autoUpdate', Boolean(settings.autoUpdate));
      if (updater) updater.setAutoDownload(Boolean(settings.autoUpdate));
    }
    if (settings.theme !== undefined) {
      settingsStore.set('theme', THEMES.includes(settings.theme) ? settings.theme : 'dark');
    }
    if (settings.glassSeeThrough !== undefined) {
      settingsStore.set('glassSeeThrough', Boolean(settings.glassSeeThrough));
    }
    if (settings.theme !== undefined || settings.glassSeeThrough !== undefined) applyWindowLook();

    const result = {
      success: true,
      resolvedTheme: resolveTheme(settingsStore.get('theme')),
      seeThrough: glassSeeThrough(),
      savedKeys: savedKeyFlags()
    };

    const requested = {};
    for (const field of Object.keys(HOTKEYS)) {
      if (settings[field] === undefined) continue;
      const value = sanitizeString(settings[field], 64);
      // The show/hide shortcut is how the app is reached; it cannot be cleared.
      if (field === 'hotkey' && !value) continue;
      requested[field] = value;
    }
    if (Object.keys(requested).length) {
      const previous = savedHotkeys();
      const next = { ...previous, ...requested };
      const changed = Object.keys(HOTKEYS).some(field => next[field] !== previous[field]);
      if (changed) {
        let error = null;
        if (next.hotkey === next.selectionHotkey) {
          error = `${next.hotkey} cannot be used for both shortcuts.`;
        } else {
          // Only keep shortcuts the OS actually accepted; otherwise the old
          // ones stay active and the user is told which one failed.
          const failed = registerHotkeys(next);
          if (failed.length) {
            error = `${failed.map(f => next[f]).join(', ')} could not be registered — it may be invalid or used by another app.`;
          }
        }
        if (error) {
          registerHotkeys(previous);
          result.hotkeyError = `${error} Keeping the previous shortcuts.`;
          result.hotkeys = previous;
        } else {
          for (const field of Object.keys(HOTKEYS)) settingsStore.set(field, next[field]);
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
    if (updater) {
      const status = await updater.check();
      return {
        success: status.state !== 'error',
        error: status.error,
        currentVersion: status.currentVersion,
        latestVersion: status.version || null,
        updateAvailable: ['available', 'downloading', 'downloaded'].includes(status.state),
        status
      };
    }
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

  // Favourites survive "Clear"; they are removed one by one.
  ipcMain.handle('clear-history', () => {
    const kept = (historyStore.get('items') || []).filter(item => item.favorite);
    historyStore.set('items', kept);
    return { success: true, kept: kept.length };
  });

  ipcMain.handle('set-history-favorite', (event, id, favorite) => {
    const items = historyStore.get('items') || [];
    const item = items.find(entry => entry.id === id);
    if (!item) return { success: false };
    item.favorite = Boolean(favorite);
    historyStore.set('items', items);
    return { success: true };
  });

  // The renderer names which entries to export (what the search shows); the
  // content always comes from the store.
  ipcMain.handle('export-history', async (event, ids) => {
    const wanted = new Set(Array.isArray(ids) ? ids : []);
    const items = (historyStore.get('items') || []).filter(item => wanted.has(item.id));
    if (!items.length) return { success: false, error: 'Nothing to export.' };

    const stamp = new Date().toISOString().slice(0, 10);
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      title: 'Export history',
      defaultPath: path.join(app.getPath('documents'), `ai-translator-history-${stamp}.csv`),
      filters: [
        { name: 'CSV (Excel, Google Sheets)', extensions: ['csv'] },
        { name: 'JSON', extensions: ['json'] },
        { name: 'Markdown', extensions: ['md'] }
      ]
    });
    if (canceled || !filePath) return { success: false, cancelled: true };

    const ext = path.extname(filePath).slice(1).toLowerCase();
    const format = EXPORT_FORMATS.includes(ext) ? ext : 'csv';
    const langName = (code) => {
      if (code === 'auto') return 'Auto-detect';
      const lang = resolveLanguage(code);
      return lang ? lang.english : code;
    };
    try {
      await fs.promises.writeFile(filePath, formatHistoryExport(items, format, langName), 'utf8');
      return { success: true, count: items.length, filePath };
    } catch (err) {
      return { success: false, error: `Could not write the file: ${err.message}` };
    }
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
    event.returnValue = { theme: resolveTheme(settingsStore.get('theme')), seeThrough: glassSeeThrough() };
  });

  // Window management
  ipcMain.on('window-minimize', () => mainWindow && mainWindow.minimize());
  ipcMain.on('window-close', () => mainWindow && mainWindow.hide());

  // Hotkey management
  ipcMain.on('unregister-hotkey', () => globalShortcut.unregisterAll());
  ipcMain.on('register-hotkey', () => registerHotkeys());

  // Opening links in browser
  ipcMain.on('open-external', async (event, url) => {
    if (isAllowedExternalUrl(url, ALLOWED_EXTERNAL_URLS)) {
      // Rejects when there is no browser or URL handler (bare Linux setups).
      await shell.openExternal(url).catch(err => console.error('Could not open the link:', err.message));
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
    warnAboutHotkeys(registerHotkeys());
    watchSystemTheme();
    initAutoUpdater();
  });
}

app.on('window-all-closed', () => {
  // Do not close the application
});

// Cmd+Q, the app menu, app.quit() from the tray or an installer update all
// go through before-quit (a Windows shutdown does not: see 'session-end' on
// the window). Without this flag the 'close' handler would cancel them and
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
