// The saved theme is applied ahead of the first paint by theme-init.js.

// ===== Language List =====
// AUTO_LANG and LANGUAGES come from languages.js, shared with the main process.
const LANGUAGES_BY_CODE = new Map([[AUTO_LANG.code, AUTO_LANG], ...LANGUAGES.map(l => [l.code, l])]);
// History written by older versions stored display names ("Deutsch", "Russian")
// instead of codes, so names in both forms still resolve.
const LANGUAGES_BY_NAME = new Map([
    [AUTO_LANG.name, AUTO_LANG],
    ...LANGUAGES.map(l => [l.english, l]),
    ...LANGUAGES.map(l => [l.name, l])
]);

// Resolves a stored history value (a code, or a legacy name) to a language.
function findLanguage(value) {
    if (value === 'auto') return AUTO_LANG;
    return LANGUAGES_BY_CODE.get(value) || LANGUAGES_BY_NAME.get(value) || null;
}

// ===== Built-in Styles =====
// Ids must match STYLE_INSTRUCTIONS in main.js, which holds the actual prompt wording.
const BUILTIN_STYLES = [
    { id: 'neutral', name: 'Neutral' },
    { id: 'formal', name: 'Formal' },
    { id: 'casual', name: 'Casual' },
    { id: 'technical', name: 'Technical' },
    { id: 'academic', name: 'Academic' },
    { id: 'creative', name: 'Creative' },
    { id: 'concise', name: 'Concise' },
    { id: 'simple', name: 'Simple' },
    { id: 'marketing', name: 'Marketing' },
    { id: 'polite', name: 'Polite' }
];

// ===== State =====
let currentSourceLang = 'auto';
let currentTargetLang = 'ru';
let currentStyle = 'neutral';
let currentMode = 'translate'; // 'translate' | 'fix'
let customStyles = [];
// Id of the translation currently on screen, or null when idle. Streamed
// pieces and results of any other (cancelled or superseded) request are ignored.
let activeRequestId = null;
let requestCounter = 0;
const savedHotkeys = { hotkey: 'Ctrl+Shift+T', selectionHotkey: 'Ctrl+Shift+Y' };
let currentTheme = 'dark';
let openRouterModels = [];

// Optimized DOM lookups for language selection
const sourceLangOptions = new Map();
const targetLangOptions = new Map();
let selectedSourceOpt = null;
let selectedTargetOpt = null;

// ===== DOM Elements =====
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const sourceLangBtn = $('#source-lang-btn');
const targetLangBtn = $('#target-lang-btn');
const sourceLangLabel = $('#source-lang-label');
const targetLangLabel = $('#target-lang-label');
const sourceLangDropdown = $('#source-lang-dropdown');
const targetLangDropdown = $('#target-lang-dropdown');
const swapBtn = $('#swap-btn');
const sourceText = $('#source-text');
const targetText = $('#target-text');
const translateBtn = $('#btn-translate');
const loader = $('#loader');
const recentLangsContainer = $('#recent-langs');
const styleSelector = $('#style-selector');
const modeSwitch = $('#mode-switch');
const targetLangSelector = $('#target-lang-selector');

// ===== Initialization =====
async function init() {
    const settings = await window.api.getSettings();

    applyTheme(settings.theme, settings.resolvedTheme);
    $('#theme-select').value = settings.theme || 'dark';

    renderKeyStatus(settings.savedKeys);

    if (settings.hotkey) savedHotkeys.hotkey = settings.hotkey;
    if (typeof settings.selectionHotkey === 'string') savedHotkeys.selectionHotkey = settings.selectionHotkey;
    $('#hotkey-input').value = savedHotkeys.hotkey;
    $('#selection-hotkey-input').value = savedHotkeys.selectionHotkey;
    // Only Linux exposes the highlighted text directly (PRIMARY selection).
    if (window.api.platform === 'linux') {
        $('#selection-hotkey-hint').textContent = 'Translates the highlighted text (or the clipboard). Backspace disables it';
    }

    $('#provider-select').value = settings.provider || 'gemini';
    updateProviderSections();

    populateModelSelect($('#model-select'), settings.defaultGeminiModels || [], settings.model);
    populateModelSelect($('#anthropic-model-select'), settings.defaultAnthropicModels || [], settings.anthropicModel);
    setOpenRouterModel(settings.openrouterModel);

    $('#app-version').textContent = `v${settings.version || ''}`;

    customStyles = settings.customStyles || [];
    currentStyle = settings.style || 'neutral';
    renderStyles();

    // Restore the most recent language pair, if there is one.
    const recentPairs = settings.recentPairs || [];
    const lastPair = recentPairs[0];
    if (lastPair && LANGUAGES_BY_CODE.has(lastPair.source) && LANGUAGES_BY_CODE.has(lastPair.target) && lastPair.target !== 'auto') {
        currentSourceLang = lastPair.source;
        currentTargetLang = lastPair.target;
    }

    buildDropdown(sourceLangDropdown, 'source');
    buildDropdown(targetLangDropdown, 'target');

    updateLangDisplay();
    renderRecentPairs(recentPairs);
    loadHistory();

    window.api.onSystemThemeChanged((resolved) => {
        if (currentTheme === 'system') applyTheme('system', resolved);
    });
}

// ===== Theme =====
function applyTheme(theme, resolved) {
    currentTheme = theme || 'dark';
    const effective = resolved || (theme === 'light' ? 'light' : 'dark');
    document.documentElement.setAttribute('data-theme', effective);
    document.documentElement.dataset.themeSetting = currentTheme;
}

async function setTheme(theme) {
    const result = await window.api.saveSettings({ theme });
    applyTheme(theme, result.resolvedTheme);
    $('#theme-select').value = theme;
}

$('#btn-theme').addEventListener('click', () => {
    // Direct toggle: whatever is on screen now, flip it to the other one.
    const effective = document.documentElement.getAttribute('data-theme');
    setTheme(effective === 'dark' ? 'light' : 'dark');
});

$('#theme-select').addEventListener('change', (e) => setTheme(e.target.value));

// ===== Dropdown Construction =====
function buildDropdown(container, type) {
    container.innerHTML = '';
    const optionsMap = type === 'source' ? sourceLangOptions : targetLangOptions;
    optionsMap.clear();

    // Search
    const searchWrap = document.createElement('div');
    searchWrap.className = 'lang-dropdown-search';
    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.placeholder = 'Search language...';
    searchInput.addEventListener('input', (e) => {
        filterDropdown(container, e.target.value);
    });
    searchWrap.appendChild(searchInput);
    container.appendChild(searchWrap);

    // Options — "Detect language" is offered for the source side only.
    const list = type === 'source' ? [AUTO_LANG, ...LANGUAGES] : LANGUAGES;
    const fragment = document.createDocumentFragment();
    list.forEach(lang => {
        const option = document.createElement('div');
        option.className = 'lang-option';
        if (lang.code === 'auto') option.classList.add('lang-option-auto');
        option.dataset.code = lang.code;

        const flag = document.createElement('span');
        flag.className = 'lang-flag';
        flag.textContent = lang.flag;
        option.appendChild(flag);
        option.appendChild(document.createTextNode(lang.name));

        option.addEventListener('click', () => {
            if (type === 'source') {
                currentSourceLang = lang.code;
            } else {
                currentTargetLang = lang.code;
            }
            updateLangDisplay();
            closeAllDropdowns();
        });

        optionsMap.set(lang.code, option);
        fragment.appendChild(option);
    });
    container.appendChild(fragment);
}

function filterDropdown(container, query) {
    const options = container.querySelectorAll('.lang-option');
    const q = query.toLowerCase();

    // Optimization: Batch DOM updates and cache search terms
    options.forEach(option => {
        // Cache search text to avoid layout thrashing and string allocs
        if (!option._searchText) {
            option._searchText = (option.textContent || '').toLowerCase();
            option._searchCode = (option.dataset.code || '').toLowerCase();
        }

        const shouldShow = option._searchText.includes(q) || option._searchCode.includes(q);
        const newDisplay = shouldShow ? '' : 'none';

        // Only touch DOM if changed
        if (option.style.display !== newDisplay) {
            option.style.display = newDisplay;
        }
    });
}

function langName(code) {
    const lang = LANGUAGES_BY_CODE.get(code);
    return lang ? lang.name : code;
}

function updateLangDisplay() {
    sourceLangLabel.textContent = langName(currentSourceLang);
    targetLangLabel.textContent = langName(currentTargetLang);

    // Update selected state (O(1) optimization)
    if (selectedSourceOpt) selectedSourceOpt.classList.remove('selected');
    selectedSourceOpt = sourceLangOptions.get(currentSourceLang);
    if (selectedSourceOpt) selectedSourceOpt.classList.add('selected');

    if (selectedTargetOpt) selectedTargetOpt.classList.remove('selected');
    selectedTargetOpt = targetLangOptions.get(currentTargetLang);
    if (selectedTargetOpt) selectedTargetOpt.classList.add('selected');

    updateActionLabels();
}

function updateActionLabels() {
    const isFix = currentMode === 'fix';
    if (activeRequestId === null) {
        translateBtn.querySelector('.translate-btn-text').textContent = isFix ? 'Fix Text' : 'Translate';
    }

    sourceText.placeholder = isFix ? 'Enter text to fix...' : 'Enter text to translate...';

    const placeholder = targetText.querySelector('.placeholder');
    if (placeholder && activeRequestId === null) {
        placeholder.textContent = isFix
            ? 'Corrected text will appear here...'
            : 'Translation will appear here...';
    }
}

// ===== Mode Switch (Translate <-> Fix text) =====
function setMode(mode) {
    currentMode = mode === 'fix' ? 'fix' : 'translate';
    modeSwitch.querySelectorAll('.mode-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.mode === currentMode);
    });

    // Fixing keeps the original language, so the target side is irrelevant.
    const isFix = currentMode === 'fix';
    swapBtn.hidden = isFix;
    targetLangSelector.hidden = isFix;
    recentLangsContainer.hidden = isFix;
    updateActionLabels();
}

modeSwitch.addEventListener('click', (e) => {
    const btn = e.target.closest('.mode-btn');
    if (btn) setMode(btn.dataset.mode);
});

// ===== Dropdown Open/Close =====
function toggleDropdown(btn, dropdown) {
    const isOpen = dropdown.classList.contains('open');
    closeAllDropdowns();
    if (!isOpen) {
        dropdown.classList.add('open');
        btn.classList.add('open');
        // Focus on search
        const searchInput = dropdown.querySelector('input');
        if (searchInput) {
            searchInput.value = '';
            filterDropdown(dropdown, '');
            setTimeout(() => searchInput.focus(), 50);
        }
    }
}

function closeAllDropdowns() {
    $$('.lang-dropdown').forEach(d => d.classList.remove('open'));
    $$('.lang-btn').forEach(b => b.classList.remove('open'));
}

sourceLangBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleDropdown(sourceLangBtn, sourceLangDropdown);
});

targetLangBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleDropdown(targetLangBtn, targetLangDropdown);
});

document.addEventListener('click', (e) => {
    if (!e.target.closest('.lang-selector')) {
        closeAllDropdowns();
    }
});

// ===== Swap =====
swapBtn.addEventListener('click', () => {
    // "Detect language" has no counterpart to swap into.
    if (currentSourceLang === 'auto') {
        showToast('Pick a source language to swap', 'info');
        return;
    }

    // Animation
    swapBtn.classList.add('swapping');
    setTimeout(() => swapBtn.classList.remove('swapping'), 400);

    // Change languages
    const tempLang = currentSourceLang;
    currentSourceLang = currentTargetLang;
    currentTargetLang = tempLang;
    updateLangDisplay();

    // Change texts
    const tempText = sourceText.value;
    const currentTarget = targetText.textContent;
    const placeholder = targetText.querySelector('.placeholder');

    if (currentTarget && !placeholder) {
        sourceText.value = currentTarget;
        if (tempText) {
            targetText.textContent = tempText;
        } else {
            resetTargetPlaceholder();
        }
    }
});

function resetTargetPlaceholder() {
    targetText.innerHTML = '';
    const span = document.createElement('span');
    span.className = 'placeholder';
    span.textContent = currentMode === 'fix'
        ? 'Corrected text will appear here...'
        : 'Translation will appear here...';
    targetText.appendChild(span);
}

// ===== Recently Used Language Pairs =====
function renderRecentPairs(pairs) {
    recentLangsContainer.innerHTML = '';

    if (!pairs || !pairs.length) {
        const hint = document.createElement('span');
        hint.className = 'recent-empty';
        hint.textContent = 'Recently used language pairs will appear here';
        recentLangsContainer.appendChild(hint);
        return;
    }

    const fragment = document.createDocumentFragment();
    pairs.forEach(pair => {
        const src = LANGUAGES_BY_CODE.get(pair.source);
        const tgt = LANGUAGES_BY_CODE.get(pair.target);
        if (!src || !tgt) return;

        const chip = document.createElement('button');
        chip.className = 'recent-chip';
        // Codes only: Windows renders flag emoji as their regional-indicator
        // letters ("pl"), which just duplicates the code next to it.
        chip.title = `${src.name} → ${tgt.name}`;
        chip.textContent = `${src.code === 'auto' ? 'Auto' : src.code.toUpperCase()} → ${tgt.code.toUpperCase()}`;

        if (pair.source === currentSourceLang && pair.target === currentTargetLang) {
            chip.classList.add('active');
        }

        chip.addEventListener('click', () => {
            currentSourceLang = pair.source;
            currentTargetLang = pair.target;
            updateLangDisplay();
            renderRecentPairs(pairs);
        });
        fragment.appendChild(chip);
    });
    recentLangsContainer.appendChild(fragment);
}

// ===== Translation Styles =====
function renderStyles() {
    styleSelector.innerHTML = '';
    const fragment = document.createDocumentFragment();

    const all = [...BUILTIN_STYLES, ...customStyles];
    // A deleted custom style should not leave the selector without a selection.
    if (!all.some(s => s.id === currentStyle)) currentStyle = 'neutral';

    all.forEach(style => {
        const btn = document.createElement('button');
        btn.className = 'style-btn';
        btn.dataset.style = style.id;
        btn.title = style.instruction || `${style.name} style`;
        if (style.id === currentStyle) btn.classList.add('active');

        const label = document.createElement('span');
        label.textContent = style.name;
        btn.appendChild(label);

        btn.addEventListener('click', () => selectStyle(style.id));

        if (style.id.startsWith('custom-')) {
            btn.classList.add('style-btn-custom');
            const del = document.createElement('span');
            del.className = 'style-delete';
            del.textContent = '×';
            del.title = 'Delete this style';
            del.addEventListener('click', (e) => {
                e.stopPropagation();
                deleteCustomStyle(style.id);
            });
            btn.appendChild(del);
        }

        fragment.appendChild(btn);
    });

    // "+ Custom" opener
    const addBtn = document.createElement('button');
    addBtn.className = 'style-btn style-btn-add';
    addBtn.textContent = '+ Custom';
    addBtn.title = 'Define your own translation style';
    addBtn.addEventListener('click', () => {
        const editor = $('#custom-style-editor');
        editor.hidden = !editor.hidden;
        if (!editor.hidden) $('#custom-style-name').focus();
    });
    fragment.appendChild(addBtn);

    styleSelector.appendChild(fragment);
}

async function selectStyle(id) {
    currentStyle = id;
    renderStyles();
    await window.api.saveSettings({ style: id });
}

async function persistCustomStyles() {
    await window.api.saveSettings({ customStyles, style: currentStyle });
}

async function addCustomStyle() {
    const name = $('#custom-style-name').value.trim();
    const instruction = $('#custom-style-instruction').value.trim();

    if (!name || !instruction) {
        showToast('Give the style a name and an instruction', 'error');
        return;
    }

    const style = { id: `custom-${Date.now()}`, name, instruction };
    customStyles.push(style);
    currentStyle = style.id;

    $('#custom-style-name').value = '';
    $('#custom-style-instruction').value = '';
    $('#custom-style-editor').hidden = true;

    renderStyles();
    await persistCustomStyles();
    showToast(`Style "${name}" added`, 'success');
}

async function deleteCustomStyle(id) {
    customStyles = customStyles.filter(s => s.id !== id);
    if (currentStyle === id) currentStyle = 'neutral';
    renderStyles();
    await persistCustomStyles();
}

$('#btn-save-custom-style').addEventListener('click', addCustomStyle);
$('#btn-cancel-custom-style').addEventListener('click', () => {
    $('#custom-style-editor').hidden = true;
});
$('#custom-style-instruction').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addCustomStyle();
});

// ===== Translation =====
// While a translation runs, the main button stops it.
translateBtn.addEventListener('click', () => {
    if (activeRequestId !== null) {
        stopTranslation();
    } else {
        doTranslate();
    }
});

sourceText.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key === 'Enter') {
        doTranslate();
    }
});

function stopTranslation() {
    if (activeRequestId === null) return;
    window.api.cancelTranslation(activeRequestId);
}

// Text node that streamed pieces are appended to; created on the first piece.
let streamNode = null;

window.api.onTranslateDelta(({ requestId, delta }) => {
    if (requestId !== activeRequestId || typeof delta !== 'string') return;
    if (!streamNode) {
        targetText.textContent = '';
        streamNode = document.createTextNode('');
        targetText.appendChild(streamNode);
        targetText.classList.add('streaming');
    }
    streamNode.appendData(delta);
    targetText.scrollTop = targetText.scrollHeight;
});

async function doTranslate() {
    const text = sourceText.value.trim();
    if (!text) return;

    // A new request replaces one that is still running.
    if (activeRequestId !== null) stopTranslation();

    // Snapshot the request: the user may switch languages or mode while it
    // is in flight, and the recent pair must record what was actually sent.
    const requestId = ++requestCounter;
    const isFix = currentMode === 'fix';
    const sourceLang = currentSourceLang;
    const targetLang = currentTargetLang;
    const actionText = isFix ? 'Fixing...' : 'Translating...';

    activeRequestId = requestId;
    streamNode = null;
    translateBtn.classList.add('stoppable');
    translateBtn.querySelector('.translate-btn-text').textContent = 'Stop';
    translateBtn.title = 'Stop generating';
    loader.style.display = 'flex';
    targetText.innerHTML = '';
    const pending = document.createElement('span');
    pending.className = 'placeholder';
    pending.textContent = actionText;
    targetText.appendChild(pending);

    try {
        const result = await window.api.translate({
            requestId,
            text,
            sourceLang,
            targetLang,
            style: currentStyle,
            mode: isFix ? 'fix' : 'translate'
        });

        // Superseded by a newer request: that one owns the output now.
        if (requestId !== activeRequestId) return;

        if (result.success) {
            // The final text is authoritative: it is cleaned up, and may differ
            // from the streamed pieces if the provider switched models mid-way.
            targetText.textContent = result.translated;

            if (!isFix) {
                const res = await window.api.addRecentPair({ source: sourceLang, target: targetLang });
                renderRecentPairs(res.pairs);
            }

            showToast(isFix ? 'Text fixed successfully' : 'Translation successful', 'success');
        } else if (result.cancelled) {
            // Keep whatever had already arrived; it is not saved to history.
            if (!streamNode) resetTargetPlaceholder();
            showToast('Stopped', 'info');
        } else {
            showError(result.error);
            showToast(result.error, 'error');
        }
    } catch (err) {
        if (requestId !== activeRequestId) return;
        showError(`Error: ${err.message}`);
        showToast(isFix ? 'Fixing error' : 'Translation error', 'error');
    } finally {
        if (requestId === activeRequestId) {
            activeRequestId = null;
            streamNode = null;
            targetText.classList.remove('streaming');
            translateBtn.classList.remove('stoppable');
            translateBtn.title = '';
            loader.style.display = 'none';
            // Restores the button label for whatever mode is active now.
            updateActionLabels();
        }
    }
}

// ===== Translate selection (global hotkey / tray) =====
window.api.onTranslateText((text) => {
    showView('translate');
    if (!text || !text.trim()) {
        showToast('Nothing to translate — select or copy some text first', 'info');
        sourceText.focus();
        return;
    }
    setMode('translate');
    sourceText.value = text;
    doTranslate();
});

function showError(message) {
    targetText.innerHTML = '';
    const span = document.createElement('span');
    span.className = 'placeholder error-text';
    span.textContent = message;
    targetText.appendChild(span);
}

// ===== Text Actions =====
$('#btn-clear').addEventListener('click', () => {
    sourceText.value = '';
    resetTargetPlaceholder();
    sourceText.focus();
});

$('#btn-paste').addEventListener('click', async () => {
    try {
        const text = await navigator.clipboard.readText();
        sourceText.value = text;
        sourceText.focus();
    } catch (e) {
        showToast('Failed to paste text', 'error');
    }
});

$('#btn-copy').addEventListener('click', async () => {
    const placeholder = targetText.querySelector('.placeholder');
    if (placeholder) return;
    try {
        await navigator.clipboard.writeText(targetText.textContent);
        showToast('Copied!', 'success');
    } catch (e) {
        showToast('Copy error', 'error');
    }
});

// ===== Navigation =====
function showView(viewId) {
    $$('.view').forEach(v => v.classList.remove('active'));
    $(`#view-${viewId}`).classList.add('active');
}

$('#btn-settings').addEventListener('click', () => {
    const view = $('#view-settings');
    if (view.classList.contains('active')) {
        showView('translate');
    } else {
        showView('settings');
    }
});

$('#btn-history').addEventListener('click', () => {
    const view = $('#view-history');
    if (view.classList.contains('active')) {
        showView('translate');
    } else {
        loadHistory();
        showView('history');
    }
});

// ===== History =====
async function loadHistory() {
    const items = await window.api.getHistory();
    const container = $('#history-list');

    if (items.length === 0) {
        container.innerHTML = `
      <div class="empty-state">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" opacity="0.3"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
        <p>History is empty</p>
      </div>`;
        return;
    }

    container.innerHTML = '';
    const fragment = document.createDocumentFragment();

    items.forEach(item => {
        const el = document.createElement('div');
        el.className = 'history-item';

        const time = new Date(item.timestamp);
        const timeStr = time.toLocaleString('en-US', {
            day: '2-digit', month: '2-digit', year: 'numeric',
            hour: '2-digit', minute: '2-digit'
        });

        const src = findLanguage(item.sourceLang);
        const tgt = findLanguage(item.targetLang);
        const srcLabel = src ? (src.code === 'auto' ? 'Auto' : src.name) : String(item.sourceLang || '');
        const tgtLabel = tgt ? tgt.name : String(item.targetLang || '');

        const langs = item.mode === 'fix'
            ? `<span>Fix</span><span class="arrow">·</span><span>${escapeHtml(srcLabel)}</span>`
            : `<span>${escapeHtml(srcLabel)}</span>
         <span class="arrow">→</span>
         <span>${escapeHtml(tgtLabel)}</span>`;

        el.innerHTML = `
      <div class="history-item-header">
        <div class="history-item-langs">${langs}</div>
        <span class="history-item-time">${escapeHtml(timeStr)}</span>
      </div>
      <div class="history-item-source">${escapeHtml(item.sourceText)}</div>
      <div class="history-item-target">${escapeHtml(item.targetText)}</div>
      <button class="history-item-delete" title="Delete">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    `;

        // Click — load into translator
        el.addEventListener('click', (e) => {
            if (e.target.closest('.history-item-delete')) return;

            sourceText.value = item.sourceText;
            targetText.textContent = item.targetText;

            setMode(item.mode === 'fix' ? 'fix' : 'translate');

            if (src) currentSourceLang = src.code;
            if (tgt && tgt.code !== 'auto') currentTargetLang = tgt.code;
            updateLangDisplay();

            showView('translate');
        });

        // Delete entry
        el.querySelector('.history-item-delete').addEventListener('click', async (e) => {
            e.stopPropagation();
            await window.api.deleteHistoryItem(item.id);
            el.style.animation = 'fadeIn 0.2s ease reverse';
            setTimeout(() => {
                el.remove();
                if (container.children.length === 0) loadHistory();
            }, 200);
        });

        fragment.appendChild(el);
    });
    container.appendChild(fragment);
}

$('#btn-clear-history').addEventListener('click', async () => {
    await window.api.clearHistory();
    loadHistory();
    showToast('History cleared', 'info');
});

// ===== Settings: provider & models =====
function updateProviderSections() {
    const provider = $('#provider-select').value;
    $('#provider-gemini').hidden = provider !== 'gemini';
    $('#provider-openrouter').hidden = provider !== 'openrouter';
    $('#provider-anthropic').hidden = provider !== 'anthropic';
}

$('#provider-select').addEventListener('change', updateProviderSections);

function populateModelSelect(select, models, selected) {
    select.innerHTML = '';

    // Keep a saved model selectable even if it is missing from the fetched list.
    const list = [...models];
    if (selected && !list.some(m => m.id === selected)) {
        list.unshift({ id: selected, name: `${selected} (saved)` });
    }

    list.forEach(model => {
        const option = document.createElement('option');
        option.value = model.id;
        option.textContent = model.name;
        select.appendChild(option);
    });

    if (selected) select.value = selected;
}

// Saves the key that is currently typed in, so "Refresh" works right after
// pasting a key without a separate trip to "Save Settings".
async function refreshModelSelect(btn, provider, select) {
    btn.disabled = true;
    btn.textContent = 'Loading...';
    try {
        await saveTypedKeys([provider]);
        const selected = select.value;
        const result = await window.api.listModels(provider);
        populateModelSelect(select, result.models || [], selected);
        showToast(result.success ? `Loaded ${result.models.length} models` : result.error, result.success ? 'success' : 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Refresh';
    }
}

$('#btn-refresh-gemini-models').addEventListener('click', (e) => {
    refreshModelSelect(e.currentTarget, 'gemini', $('#model-select'));
});

$('#btn-refresh-anthropic-models').addEventListener('click', (e) => {
    refreshModelSelect(e.currentTarget, 'anthropic', $('#anthropic-model-select'));
});

function setOpenRouterModel(modelId) {
    const label = $('#openrouter-model-current');
    label.textContent = modelId ? `Selected: ${modelId}` : 'No model selected yet';
    label.dataset.modelId = modelId || '';
}

function renderOpenRouterModels(filter = '') {
    const select = $('#openrouter-model-select');
    const q = filter.trim().toLowerCase();
    const selected = $('#openrouter-model-current').dataset.modelId;

    select.innerHTML = '';
    const fragment = document.createDocumentFragment();

    openRouterModels
        .filter(m => !q || m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q))
        .slice(0, 400)
        .forEach(model => {
            const option = document.createElement('option');
            option.value = model.id;
            option.textContent = `${model.name} — ${model.id}`;
            if (model.id === selected) option.selected = true;
            fragment.appendChild(option);
        });

    select.appendChild(fragment);
}

$('#btn-refresh-openrouter-models').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.textContent = 'Loading...';
    try {
        await saveTypedKeys(['openrouter']);
        const result = await window.api.listModels('openrouter');
        if (result.success) {
            openRouterModels = result.models;
            renderOpenRouterModels($('#openrouter-model-filter').value);
            showToast(`Loaded ${openRouterModels.length} models`, 'success');
        } else {
            showToast(result.error, 'error');
        }
    } finally {
        btn.disabled = false;
        btn.textContent = 'Load models';
    }
});

$('#openrouter-model-filter').addEventListener('input', (e) => renderOpenRouterModels(e.target.value));

$('#openrouter-model-select').addEventListener('change', (e) => setOpenRouterModel(e.target.value));

// ===== Settings: keys, hotkey, save =====
// Saved keys stay in the main process. The fields only ever hold a key the
// user is typing in; a saved one is shown as a "Key saved" line instead.
const KEY_INPUTS = {
    gemini: { input: '#api-key-input', field: 'apiKey' },
    anthropic: { input: '#anthropic-key-input', field: 'anthropicApiKey' },
    openrouter: { input: '#openrouter-key-input', field: 'openrouterApiKey' }
};

function renderKeyStatus(savedKeys = {}) {
    for (const [provider, { input }] of Object.entries(KEY_INPUTS)) {
        const field = $(input);
        field.dataset.placeholder ??= field.placeholder;
        field.placeholder = savedKeys[provider] ? '••••••••••••••••' : field.dataset.placeholder;
        $(`#${provider}-key-status`).hidden = !savedKeys[provider];
    }
}

// The settings payload for keys typed into the given providers' fields.
// Empty fields are left out: they mean "keep the saved key", not "remove it".
function typedKeys(providers = Object.keys(KEY_INPUTS)) {
    const keys = {};
    for (const provider of providers) {
        const { input, field } = KEY_INPUTS[provider];
        const value = $(input).value.trim();
        if (value) keys[field] = value;
    }
    return keys;
}

// Once a typed key is stored the field is cleared, so it does not linger in the DOM.
function afterKeysSaved(sent, result) {
    if (!result || !result.success) return;
    for (const { input, field } of Object.values(KEY_INPUTS)) {
        if (sent[field] !== undefined) {
            $(input).value = '';
            $(input).type = 'password';
        }
    }
    renderKeyStatus(result.savedKeys);
}

async function saveTypedKeys(providers) {
    const keys = typedKeys(providers);
    if (!Object.keys(keys).length) return;
    afterKeysSaved(keys, await window.api.saveSettings(keys));
}

document.querySelectorAll('[data-remove-key]').forEach(btn => {
    btn.addEventListener('click', async () => {
        const { field } = KEY_INPUTS[btn.dataset.removeKey];
        const sent = { [field]: '' };
        const result = await window.api.saveSettings(sent);
        afterKeysSaved(sent, result);
        showToast(result.success ? 'API key removed' : (result.error || 'Failed to remove the key'), result.success ? 'success' : 'error');
    });
});

$('#toggle-api-key').addEventListener('click', () => {
    const input = $('#api-key-input');
    input.type = input.type === 'password' ? 'text' : 'password';
});

$('#toggle-openrouter-key').addEventListener('click', () => {
    const input = $('#openrouter-key-input');
    input.type = input.type === 'password' ? 'text' : 'password';
});

$('#toggle-anthropic-key').addEventListener('click', () => {
    const input = $('#anthropic-key-input');
    input.type = input.type === 'password' ? 'text' : 'password';
});

const HOTKEY_PROMPT = 'Press a key combination...';

// Records a global shortcut into `input`. While recording, all global
// shortcuts are suspended so the combination reaches the field.
// `optional` fields can be cleared with Backspace/Delete to disable them.
function attachHotkeyCapture(input, field, { optional = false } = {}) {
    input.addEventListener('click', function () {
        this.value = HOTKEY_PROMPT;
        this.removeAttribute('readonly');
        window.api.unregisterHotkey();
    });

    input.addEventListener('blur', function () {
        // Abandoned mid-combination ("Ctrl+...") or never started: keep the old one.
        if (this.value === HOTKEY_PROMPT || this.value.endsWith('+...')) {
            this.value = savedHotkeys[field];
        }
        this.setAttribute('readonly', true);
        window.api.registerHotkey();
    });

    input.addEventListener('keydown', function (e) {
        // Plain Tab still moves focus out of the field.
        if (e.key === 'Tab' && !e.ctrlKey && !e.altKey && !e.metaKey) return;
        e.preventDefault();

        if (e.key === 'Escape') {
            this.value = savedHotkeys[field];
            this.blur();
            return;
        }

        const { modifiers, accelerator } = keyEventToAccelerator(e);
        if (optional && !modifiers.length && (e.key === 'Backspace' || e.key === 'Delete')) {
            this.value = '';
            this.blur();
            return;
        }
        if (accelerator) {
            this.value = accelerator;
            this.setAttribute('readonly', true);
            this.blur();
        } else if (modifiers.length) {
            this.value = modifiers.join('+') + '+...';
        }
    });
}

// Value to save from a hotkey field, or undefined when it holds no finished combination.
function readHotkeyInput(input) {
    const value = input.value.trim();
    if (value === HOTKEY_PROMPT || value.endsWith('+...')) return undefined;
    return value;
}

attachHotkeyCapture($('#hotkey-input'), 'hotkey');
attachHotkeyCapture($('#selection-hotkey-input'), 'selectionHotkey', { optional: true });

$('#btn-save-settings').addEventListener('click', async () => {
    const hotkey = readHotkeyInput($('#hotkey-input'));
    const selectionHotkey = readHotkeyInput($('#selection-hotkey-input'));
    const model = $('#model-select').value;
    const anthropicModel = $('#anthropic-model-select').value;
    const openrouterModel = $('#openrouter-model-current').dataset.modelId;

    // Only newly typed keys are sent; "Remove" deletes a saved one.
    const settings = {
        provider: $('#provider-select').value,
        ...typedKeys()
    };
    if (hotkey) settings.hotkey = hotkey;
    if (selectionHotkey !== undefined) settings.selectionHotkey = selectionHotkey;
    if (model) settings.model = model;
    if (anthropicModel) settings.anthropicModel = anthropicModel;
    if (openrouterModel) settings.openrouterModel = openrouterModel;

    const result = await window.api.saveSettings(settings);
    if (!result.success) {
        showToast(result.error || 'Failed to save settings', 'error');
        return;
    }
    afterKeysSaved(settings, result);
    if (result.hotkeyError) {
        Object.assign(savedHotkeys, result.hotkeys);
        $('#hotkey-input').value = savedHotkeys.hotkey;
        $('#selection-hotkey-input').value = savedHotkeys.selectionHotkey;
        showToast(result.hotkeyError, 'error');
        return;
    }
    if (settings.hotkey) savedHotkeys.hotkey = settings.hotkey;
    if (settings.selectionHotkey !== undefined) savedHotkeys.selectionHotkey = settings.selectionHotkey;
    showToast('Settings saved', 'success');
});

$('#link-aistudio').addEventListener('click', (e) => {
    e.preventDefault();
    window.api.openExternal('https://aistudio.google.com/apikey');
});

$('#link-openrouter').addEventListener('click', (e) => {
    e.preventDefault();
    window.api.openExternal('https://openrouter.ai/keys');
});

$('#link-anthropic').addEventListener('click', (e) => {
    e.preventDefault();
    window.api.openExternal('https://platform.claude.com/settings/keys');
});

$('#link-repo').addEventListener('click', (e) => {
    e.preventDefault();
    window.api.openExternal('https://github.com/PabloSensei/ai-translator');
});

// ===== Updates =====
$('#btn-check-updates').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const status = $('#update-status');

    btn.disabled = true;
    btn.textContent = 'Checking...';
    status.className = 'update-status';
    status.textContent = '';

    try {
        const result = await window.api.checkForUpdates();

        if (!result.success) {
            status.classList.add('error-text');
            status.textContent = `Update check failed: ${result.error}`;
            return;
        }

        if (result.updateAvailable) {
            status.classList.add('update-available');
            status.textContent = `Version ${result.latestVersion} is available (you have ${result.currentVersion}). `;

            const link = document.createElement('a');
            link.href = '#';
            link.textContent = 'Open the download page';
            link.addEventListener('click', (ev) => {
                ev.preventDefault();
                window.api.openExternal('https://github.com/PabloSensei/ai-translator/releases/latest');
            });
            status.appendChild(link);
            showToast(`Update available: v${result.latestVersion}`, 'info');
        } else {
            status.textContent = result.note || `You are on the latest version (${result.currentVersion}).`;
        }
    } finally {
        btn.disabled = false;
        btn.textContent = 'Check for updates';
    }
});

// ===== Window Management =====
$('#btn-minimize').addEventListener('click', () => window.api.windowMinimize());
$('#btn-close').addEventListener('click', () => window.api.windowClose());

// ===== Toast Notifications =====
function showToast(message, type = 'info') {
    const existing = document.querySelector('.toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);

    setTimeout(() => {
        if (toast.parentNode) toast.remove();
    }, 3000);
}

// ===== Start =====
init();
