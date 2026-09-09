const { app, safeStorage, BrowserWindow, Tray, Menu, globalShortcut, ipcMain, shell, nativeTheme } = require('electron');
const path = require('path');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// electron-store — ESM-only module starting from v9, use dynamic import
let Store;
let settingsStore;
let historyStore;

const GITHUB_REPO = 'PabloSensei/ai-translator';

// Curated fallback list, used when the provider model list cannot be fetched.
// "Refresh" in the settings replaces this with whatever the API actually offers.
const DEFAULT_GEMINI_MODELS = [
  { id: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash' },
  { id: 'gemini-3.7-flash', name: 'Gemini 3.7 Flash' },
  { id: 'gemini-3.6-flash', name: 'Gemini 3.6 Flash' },
  { id: 'gemini-3.5-flash', name: 'Gemini 3.5 Flash' },
  { id: 'gemini-3.5-flash-lite', name: 'Gemini 3.5 Flash Lite' },
  { id: 'gemini-3.1-pro-preview', name: 'Gemini 3.1 Pro Preview' },
  { id: 'gemini-3.1-flash-lite', name: 'Gemini 3.1 Flash Lite' },
  { id: 'gemini-3-flash-preview', name: 'Gemini 3 Flash Preview' },
  { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro' },
  { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash' },
  { id: 'gemini-2.5-flash-lite', name: 'Gemini 2.5 Flash Lite' }
];

// This app only ever asks a model for text. Anything that generates images,
// audio, video or music, plus embedding/retrieval-only models, is filtered out
// of the picker even when the API reports it as supporting generateContent.
const NON_TEXT_MODEL_PATTERN = /embedding|image|imagen|audio|-tts|\btts\b|veo|lyria|live|aqa|learnlm/i;

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
  try {
    const mod = await import('electron-store');
    Store = mod.default;

    settingsStore = new Store({
      name: 'settings',
      defaults: {
        apiKey: '',
        openrouterApiKey: '',
        provider: 'gemini',
        hotkey: 'Ctrl+Shift+T',
        windowBounds: { width: 860, height: 640 },
        // Filled in from actual usage — starts empty on a fresh install.
        recentPairs: [],
        model: 'gemini-2.5-flash',
        openrouterModel: '',
        theme: 'dark',
        style: 'neutral',
        customStyles: []
      }
    });

    historyStore = new Store({
      name: 'history',
      defaults: {
        items: []
      }
    });

    // Migrate legacy plaintext API keys
    for (const key of ['apiKey', 'openrouterApiKey']) {
      const currentKey = settingsStore.get(key);
      if (currentKey && safeStorage.isEncryptionAvailable()) {
        const decrypted = decryptApiKey(currentKey);
        // If decrypted value equals the input, it means decryption failed (fallback) or wasn't needed,
        // which implies it is currently stored as plaintext (or invalid).
        if (decrypted === currentKey) {
          console.log(`Migrating ${key} to encrypted storage...`);
          settingsStore.set(key, encryptApiKey(currentKey));
        }
      }
    }
  } catch (err) {
    console.error('Failed to initialize electron-store:', err);
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
  const bounds = settingsStore.get('windowBounds');
  const theme = resolveTheme(settingsStore.get('theme'));

  mainWindow = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
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

  mainWindow.on('resize', () => {
    const { width, height } = mainWindow.getBounds();
    settingsStore.set('windowBounds', { width, height });
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

// --- Prompt Building ---
const STYLE_INSTRUCTIONS = {
  neutral: '',
  formal: 'Use a formal, professional, and business-appropriate tone. Prefer official vocabulary, polite constructions, and structured phrasing typical of formal documents or business correspondence.',
  casual: 'Use a casual, conversational, and friendly tone. Prefer everyday vocabulary, natural speech patterns, colloquial expressions, and informal phrasing as if chatting with a friend.',
  technical: 'Use precise technical language. Keep domain terminology, product names, code identifiers, and units exactly as they are, and prefer the established wording used in technical documentation.',
  academic: 'Use an academic, scholarly register. Prefer precise terminology, impersonal constructions, and the measured phrasing typical of research papers.',
  creative: 'Use an expressive, literary tone. Preserve imagery, rhythm, and figurative language, favouring a natural, vivid rendering over a literal one.',
  concise: 'Be as concise as possible. Remove filler, keep only the essential meaning, and prefer short sentences.',
  simple: 'Use simple, plain language that a non-native speaker can easily understand. Avoid jargon, idioms, and complex sentence structures.',
  marketing: 'Use persuasive marketing copy: energetic, benefit-focused, and catchy, while keeping the original meaning.',
  polite: 'Use an especially polite and diplomatic tone. Soften direct statements and prefer courteous, considerate phrasing.'
};

function getStyleInstruction(style, customStyles) {
  // hasOwnProperty, not a plain lookup: a style id such as "toString" or
  // "constructor" would otherwise resolve to an inherited Object.prototype
  // member and get stringified into the prompt.
  if (typeof style !== 'string') return '';
  if (Object.prototype.hasOwnProperty.call(STYLE_INSTRUCTIONS, style)) {
    return STYLE_INSTRUCTIONS[style];
  }
  const custom = (Array.isArray(customStyles) ? customStyles : []).find(s => s && s.id === style);
  if (custom && typeof custom.instruction === 'string') return custom.instruction.trim();
  return '';
}

function buildPrompt({ text, sourceLang, targetLang, mode, styleInstruction }) {
  const styleSuffix = styleInstruction ? ` ${styleInstruction}` : '';
  const tail = ' Return ONLY the resulting text, nothing else — no explanations, no quotes, no formatting.';
  const isAuto = !sourceLang || sourceLang === 'auto';

  if (mode === 'fix') {
    const langPart = isAuto ? '' : ` ${sourceLang}`;
    return `Correct any spelling, grammar, and punctuation errors in the following${langPart} text. Keep the original language.${styleSuffix}${tail}\n\nText:\n${text}`;
  }

  const from = isAuto
    ? 'Detect the language of the following text and translate it'
    : `Translate the following text from ${sourceLang}`;

  return `${from} to ${targetLang}.${styleSuffix}${tail}\n\nText:\n${text}`;
}

// --- Providers ---
let cachedGenAI = null;
let cachedModel = null;
let currentApiKey = null;
let currentModelName = null;

async function generateWithGemini(prompt, apiKey, modelName) {
  if (!apiKey) {
    throw new Error('Gemini API key is not set. Please enter it in the settings.');
  }

  // Optimize: reuse GoogleGenerativeAI and model instances
  if (apiKey !== currentApiKey || !cachedGenAI) {
    cachedGenAI = new GoogleGenerativeAI(apiKey);
    currentApiKey = apiKey;
    cachedModel = null; // Reset model if AI client changes
  }

  if (modelName !== currentModelName || !cachedModel) {
    cachedModel = cachedGenAI.getGenerativeModel({ model: modelName });
    currentModelName = modelName;
  }

  const result = await cachedModel.generateContent(prompt);
  return result.response.text().trim();
}

async function generateWithOpenRouter(prompt, apiKey, modelName) {
  if (!apiKey) {
    throw new Error('OpenRouter API key is not set. Please enter it in the settings.');
  }
  if (!modelName) {
    throw new Error('No OpenRouter model selected. Pick one in the settings.');
  }

  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': `https://github.com/${GITHUB_REPO}`,
      'X-Title': 'AI Translator'
    },
    body: JSON.stringify({
      model: modelName,
      messages: [{ role: 'user', content: prompt }]
    })
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    let detail = body;
    try {
      detail = JSON.parse(body)?.error?.message || body;
    } catch (e) { /* keep the raw body */ }
    throw new Error(`OpenRouter error ${res.status}: ${String(detail).slice(0, 300)}`);
  }

  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) {
    throw new Error('OpenRouter returned an empty response.');
  }
  return content.trim();
}

async function fetchGeminiModels(apiKey) {
  if (!apiKey) throw new Error('Enter and save a Gemini API key first.');
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}&pageSize=200`);
  if (!res.ok) {
    throw new Error(`Google API error ${res.status}`);
  }
  const data = await res.json();
  const models = (data.models || [])
    .filter(m => (m.supportedGenerationMethods || []).includes('generateContent'))
    .map(m => ({
      id: String(m.name || '').replace(/^models\//, ''),
      name: m.displayName || String(m.name || '').replace(/^models\//, '')
    }))
    // Image generators such as gemini-*-flash-image report generateContent too,
    // so they have to be excluded by name as well.
    .filter(m => m.id && !NON_TEXT_MODEL_PATTERN.test(m.id) && !NON_TEXT_MODEL_PATTERN.test(m.name));

  if (!models.length) throw new Error('No usable models returned by the API.');
  return models;
}

// OpenRouter describes each model's modalities. Keep the ones that answer with
// text and drop anything that emits images (gemini-*-image, gpt-*-image, and the
// auto-routers, which advertise image output because they may route to one).
function openRouterReturnsText(model) {
  const arch = model.architecture || {};

  if (Array.isArray(arch.output_modalities) && arch.output_modalities.length) {
    return arch.output_modalities.includes('text') && !arch.output_modalities.includes('image');
  }

  // Older shape: "text+image->text"
  if (typeof arch.modality === 'string' && arch.modality.includes('->')) {
    const outputs = arch.modality.split('->')[1].split('+');
    return outputs.includes('text') && !outputs.includes('image');
  }

  // Unknown shape — keep it rather than hiding a usable model.
  return true;
}

async function fetchOpenRouterModels(apiKey) {
  const headers = apiKey ? { 'Authorization': `Bearer ${apiKey}` } : {};
  const res = await fetch('https://openrouter.ai/api/v1/models', { headers });
  if (!res.ok) {
    throw new Error(`OpenRouter error ${res.status}`);
  }
  const data = await res.json();
  const models = (data.data || [])
    .filter(openRouterReturnsText)
    .map(m => ({ id: m.id, name: m.name || m.id }))
    .filter(m => m.id);

  if (!models.length) throw new Error('No models returned by OpenRouter.');
  models.sort((a, b) => a.name.localeCompare(b.name));
  return models;
}

// --- Update check ---
function parseVersion(v) {
  return String(v).replace(/^v/i, '').split(/[.-]/).map(n => parseInt(n, 10) || 0);
}

function isNewerVersion(remote, local) {
  const a = parseVersion(remote);
  const b = parseVersion(local);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] || 0;
    const y = b[i] || 0;
    if (x > y) return true;
    if (x < y) return false;
  }
  return false;
}

async function checkForUpdates() {
  const currentVersion = app.getVersion();
  const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, {
    headers: { 'Accept': 'application/vnd.github+json', 'User-Agent': 'AI-Translator' }
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
  `https://github.com/${GITHUB_REPO}`,
  `https://github.com/${GITHUB_REPO}/releases`,
  `https://github.com/${GITHUB_REPO}/releases/latest`
];

function getApiKeys() {
  return {
    gemini: decryptApiKey(settingsStore.get('apiKey')),
    openrouter: decryptApiKey(settingsStore.get('openrouterApiKey'))
  };
}

// --- Settings validation ---
// Everything below arrives over IPC. Even though the renderer is our own code,
// the settings file is user-editable on disk and is read back on every launch,
// so values are normalised before they are stored or used.
const MAX_STYLE_NAME = 40;
const MAX_STYLE_INSTRUCTION = 2000;
const MAX_CUSTOM_STYLES = 50;

function sanitizeString(value, maxLength) {
  if (typeof value !== 'string') return '';
  return value.slice(0, maxLength).trim();
}

// A Gemini model id is interpolated into the request URL path ("models/<id>:
// generateContent"), so it is kept to bare id characters — no slash or colon
// that could reshape that path.
function sanitizeGeminiModelId(value) {
  const id = sanitizeString(value, 200);
  return /^[A-Za-z0-9._-]+$/.test(id) ? id : '';
}

// An OpenRouter model id travels in the JSON body, not the URL, and legitimately
// contains a vendor prefix and a variant suffix (e.g. "meta-llama/llama-3.3-70b-instruct:free").
function sanitizeOpenRouterModelId(value) {
  const id = sanitizeString(value, 200);
  return /^[A-Za-z0-9._\/:-]+$/.test(id) ? id : '';
}

function sanitizeCustomStyles(styles) {
  if (!Array.isArray(styles)) return [];
  return styles
    .filter(s => s && typeof s === 'object')
    .map(s => ({
      id: sanitizeString(s.id, 64),
      name: sanitizeString(s.name, MAX_STYLE_NAME),
      instruction: sanitizeString(s.instruction, MAX_STYLE_INSTRUCTION)
    }))
    // Reserved and prototype-ish ids are rejected outright.
    .filter(s => s.id && s.name && s.instruction && s.id.startsWith('custom-'))
    .slice(0, MAX_CUSTOM_STYLES);
}

function setupIPC() {
  // Translation
  ipcMain.handle('translate', async (event, { text, sourceLang, targetLang, style, mode }) => {
    try {
      const keys = getApiKeys();
      const provider = settingsStore.get('provider') || 'gemini';
      const styleInstruction = getStyleInstruction(style, settingsStore.get('customStyles'));
      const prompt = buildPrompt({ text, sourceLang, targetLang, mode, styleInstruction });

      const translated = provider === 'openrouter'
        ? await generateWithOpenRouter(prompt, keys.openrouter, settingsStore.get('openrouterModel'))
        : await generateWithGemini(prompt, keys.gemini, settingsStore.get('model') || 'gemini-2.5-flash');

      // Save to history
      const items = historyStore.get('items') || [];
      items.unshift({
        id: Date.now(),
        sourceText: text,
        targetText: translated,
        sourceLang,
        targetLang,
        mode: mode || 'translate',
        timestamp: new Date().toISOString()
      });
      // Max 100 entries
      if (items.length > 100) items.length = 100;
      historyStore.set('items', items);

      return { success: true, translated };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // Settings
  ipcMain.handle('get-settings', () => {
    const keys = getApiKeys();
    const theme = settingsStore.get('theme') || 'dark';
    return {
      apiKey: keys.gemini,
      openrouterApiKey: keys.openrouter,
      provider: settingsStore.get('provider') || 'gemini',
      hotkey: settingsStore.get('hotkey'),
      recentPairs: settingsStore.get('recentPairs') || [],
      model: settingsStore.get('model') || 'gemini-2.5-flash',
      openrouterModel: settingsStore.get('openrouterModel') || '',
      theme,
      resolvedTheme: resolveTheme(theme),
      style: settingsStore.get('style') || 'neutral',
      customStyles: settingsStore.get('customStyles') || [],
      defaultGeminiModels: DEFAULT_GEMINI_MODELS,
      version: app.getVersion()
    };
  });

  ipcMain.handle('save-settings', (event, settings) => {
    if (!settings || typeof settings !== 'object') return { success: false };

    if (settings.apiKey !== undefined) {
      settingsStore.set('apiKey', encryptApiKey(sanitizeString(settings.apiKey, 400)));
    }
    if (settings.openrouterApiKey !== undefined) {
      settingsStore.set('openrouterApiKey', encryptApiKey(sanitizeString(settings.openrouterApiKey, 400)));
    }
    if (settings.provider !== undefined) {
      settingsStore.set('provider', settings.provider === 'openrouter' ? 'openrouter' : 'gemini');
    }
    if (settings.model !== undefined) {
      const model = sanitizeGeminiModelId(settings.model);
      if (model) settingsStore.set('model', model);
    }
    if (settings.openrouterModel !== undefined) {
      const model = sanitizeOpenRouterModelId(settings.openrouterModel);
      if (model) settingsStore.set('openrouterModel', model);
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
    if (settings.hotkey !== undefined) {
      const hotkey = sanitizeString(settings.hotkey, 64);
      if (hotkey) {
        settingsStore.set('hotkey', hotkey);
        registerHotkey();
      }
    }
    return { success: true, resolvedTheme: resolveTheme(settingsStore.get('theme')) };
  });

  // Models
  ipcMain.handle('list-models', async (event, provider) => {
    try {
      const keys = getApiKeys();
      const models = provider === 'openrouter'
        ? await fetchOpenRouterModels(keys.openrouter)
        : await fetchGeminiModels(keys.gemini);
      return { success: true, models };
    } catch (err) {
      return {
        success: false,
        error: err.message,
        models: provider === 'openrouter' ? [] : DEFAULT_GEMINI_MODELS
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
    return { success: true, pairs: updateRecentPairs(pair) };
  });

  // Read synchronously by the preload script so the first paint already uses
  // the right theme — otherwise light-theme users see a dark flash on startup.
  ipcMain.on('get-initial-theme', (event) => {
    event.returnValue = resolveTheme(settingsStore.get('theme'));
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
        if (ALLOWED_EXTERNAL_URLS.includes(url)) {
          await shell.openExternal(url);
        } else {
          console.warn(`Blocked URL not in allowlist: ${url}`);
        }
      } else {
        console.warn(`Blocked potential security risk (invalid protocol): ${url}`);
      }
    } catch (err) {
      console.warn(`Invalid URL passed to open-external: ${url}`);
    }
  });
}

// Keeps the "recently used" row honest: newest pair first, no duplicates, max 6.
function updateRecentPairs({ source, target } = {}) {
  if (typeof source !== 'string' || typeof target !== 'string' || !source || !target) {
    return settingsStore.get('recentPairs') || [];
  }
  const existing = settingsStore.get('recentPairs') || [];
  const filtered = existing.filter(p => !(p.source === source && p.target === target));
  const updated = [{ source, target }, ...filtered].slice(0, 6);
  settingsStore.set('recentPairs', updated);
  return updated;
}

// --- App lifecycle ---
app.whenReady().then(async () => {
  await initStores();
  // IPC must be ready before the window loads: the preload script reads the
  // initial theme synchronously.
  setupIPC();
  createWindow();
  createTray();
  registerHotkey();
  watchSystemTheme();
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
