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
    initUpdates(settings);

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
    searchInput.setAttribute('role', 'combobox');
    searchInput.setAttribute('aria-expanded', 'true');
    searchInput.setAttribute('aria-controls', container.id);
    searchInput.setAttribute('aria-autocomplete', 'list');
    searchInput.addEventListener('input', (e) => {
        filterDropdown(container, e.target.value);
        // Typing then Enter picks the best match: a name or code that starts
        // with the query, otherwise the first one containing it.
        const q = e.target.value.trim().toLowerCase();
        const options = visibleOptions(container);
        const best = q ? options.find(o => o._searchTerms.some(t => t.startsWith(q))) : null;
        setActiveOption(container, best || options[0] || null);
    });
    searchInput.addEventListener('keydown', (e) => handleDropdownKey(e, container, type));
    searchWrap.appendChild(searchInput);
    container.appendChild(searchWrap);

    // Options — "Detect language" is offered for the source side only.
    container.setAttribute('role', 'listbox');
    const list = type === 'source' ? [AUTO_LANG, ...LANGUAGES] : LANGUAGES;
    const fragment = document.createDocumentFragment();
    list.forEach(lang => {
        const option = document.createElement('div');
        option.className = 'lang-option';
        if (lang.code === 'auto') option.classList.add('lang-option-auto');
        option.dataset.code = lang.code;
        option.id = `${type}-lang-${lang.code}`;
        // Searchable by native name, English name and code ("Deutsch", "german", "de").
        option._searchTerms = [lang.name, lang.english, lang.code].filter(Boolean).map(t => t.toLowerCase());
        option.setAttribute('role', 'option');

        const flag = document.createElement('span');
        flag.className = 'lang-flag';
        flag.textContent = lang.flag;
        option.appendChild(flag);
        option.appendChild(document.createTextNode(lang.name));

        option.addEventListener('click', () => chooseLanguage(type, lang.code));
        // Mouse and keyboard share one highlight, so Enter picks what is under the pointer.
        option.addEventListener('mousemove', () => {
            if (container._activeOption !== option) setActiveOption(container, option, { scroll: false });
        });

        optionsMap.set(lang.code, option);
        fragment.appendChild(option);
    });
    container.appendChild(fragment);
}

function chooseLanguage(type, code) {
    if (type === 'source') {
        currentSourceLang = code;
    } else {
        currentTargetLang = code;
    }
    updateLangDisplay();
    closeAllDropdowns();
    (type === 'source' ? sourceLangBtn : targetLangBtn).focus();
}

function visibleOptions(container) {
    return [...container.querySelectorAll('.lang-option')].filter(option => option.style.display !== 'none');
}

// The keyboard highlight. Focus stays in the search field; the highlighted
// option is announced through aria-activedescendant.
function setActiveOption(container, option, { scroll = true } = {}) {
    if (container._activeOption) container._activeOption.classList.remove('active');
    container._activeOption = option;
    const input = container.querySelector('input');
    if (option) {
        option.classList.add('active');
        input.setAttribute('aria-activedescendant', option.id);
        if (scroll) option.scrollIntoView({ block: 'nearest' });
    } else {
        input.removeAttribute('aria-activedescendant');
    }
}

// Options visible in one screenful of the list, for PageUp/PageDown.
function optionsPerPage(container, options) {
    const height = options[0] ? options[0].offsetHeight : 0;
    return height ? Math.max(1, Math.floor(container.clientHeight / height) - 1) : 8;
}

function handleDropdownKey(e, container, type) {
    const options = visibleOptions(container);
    const index = options.indexOf(container._activeOption);
    let next = null;

    switch (e.key) {
        case 'ArrowDown':
            next = options[Math.min(index + 1, options.length - 1)];
            break;
        case 'ArrowUp':
            next = options[Math.max(index - 1, 0)];
            break;
        case 'PageDown':
            next = options[Math.min(index + optionsPerPage(container, options), options.length - 1)];
            break;
        case 'PageUp':
            next = options[Math.max(index - optionsPerPage(container, options), 0)];
            break;
        case 'Enter': {
            e.preventDefault();
            const option = container._activeOption && options.includes(container._activeOption) ? container._activeOption : options[0];
            if (option) chooseLanguage(type, option.dataset.code);
            return;
        }
        case 'Escape':
            e.preventDefault();
            e.stopPropagation();
            closeAllDropdowns();
            (type === 'source' ? sourceLangBtn : targetLangBtn).focus();
            return;
        case 'Tab':
            closeAllDropdowns();
            return;
        default:
            return;
    }
    e.preventDefault();
    if (next) setActiveOption(container, next);
}

function filterDropdown(container, query) {
    const q = query.trim().toLowerCase();
    container.querySelectorAll('.lang-option').forEach(option => {
        const shouldShow = !q || option._searchTerms.some(term => term.includes(q));
        const newDisplay = shouldShow ? '' : 'none';
        // Only touch the DOM when the state actually changes.
        if (option.style.display !== newDisplay) option.style.display = newDisplay;
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

    // Whichever way the languages changed, the matching recent pair lights up.
    recentLangsContainer.querySelectorAll('.recent-chip').forEach(chip => {
        chip.classList.toggle('active', chip.dataset.source === currentSourceLang && chip.dataset.target === currentTargetLang);
    });

    updateActionLabels();
}

function updateActionLabels() {
    const isFix = currentMode === 'fix';
    if (activeRequestId === null) {
        translateBtn.querySelector('.translate-btn-text').textContent = isFix ? 'Fix Text' : 'Translate';
    }

    sourceText.placeholder = isFix ? 'Enter text to fix...' : 'Enter text to translate...';

    // An error message is also a .placeholder; it must stay until the next request.
    const placeholder = targetText.querySelector('.placeholder:not(.error-text)');
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
        btn.setAttribute('aria-expanded', 'true');
        // Focus on search
        const searchInput = dropdown.querySelector('input');
        if (searchInput) {
            searchInput.value = '';
            filterDropdown(dropdown, '');
            // Start from the language that is currently selected.
            setActiveOption(dropdown, dropdown.querySelector('.lang-option.selected') || visibleOptions(dropdown)[0] || null);
            setTimeout(() => searchInput.focus(), 50);
        }
    }
}

function closeAllDropdowns() {
    $$('.lang-dropdown').forEach(d => d.classList.remove('open'));
    $$('.lang-btn').forEach(b => {
        b.classList.remove('open');
        b.setAttribute('aria-expanded', 'false');
    });
}

sourceLangBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleDropdown(sourceLangBtn, sourceLangDropdown);
});

targetLangBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleDropdown(targetLangBtn, targetLangDropdown);
});

// Down/Up on a focused language button opens its list, like a native select.
[[sourceLangBtn, sourceLangDropdown], [targetLangBtn, targetLangDropdown]].forEach(([btn, dropdown]) => {
    btn.setAttribute('aria-haspopup', 'listbox');
    btn.setAttribute('aria-expanded', 'false');
    btn.addEventListener('keydown', (e) => {
        if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !dropdown.classList.contains('open')) {
            e.preventDefault();
            toggleDropdown(btn, dropdown);
        }
    });
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

    // Whatever has streamed so far is swapped as it stands.
    abandonRequest();

    // Animation
    swapBtn.classList.add('swapping');
    setTimeout(() => swapBtn.classList.remove('swapping'), 400);

    // Change languages
    const tempLang = currentSourceLang;
    currentSourceLang = currentTargetLang;
    currentTargetLang = tempLang;
    updateLangDisplay();

    // Change texts
    const tempText = attachedImage ? '' : sourceText.value;
    const currentTarget = targetText.textContent;
    const placeholder = targetText.querySelector('.placeholder');

    if (currentTarget && !placeholder) {
        // The translation of an image becomes editable text.
        if (attachedImage) removeImage();
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

        chip.dataset.source = pair.source;
        chip.dataset.target = pair.target;
        chip.classList.toggle('active', pair.source === currentSourceLang && pair.target === currentTargetLang);

        chip.addEventListener('click', () => {
            currentSourceLang = pair.source;
            currentTargetLang = pair.target;
            updateLangDisplay();
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

// Returns the UI to idle once the request on screen is over.
function finishRequestUi() {
    activeRequestId = null;
    streamNode = null;
    targetText.classList.remove('streaming');
    translateBtn.classList.remove('stoppable');
    translateBtn.title = '';
    loader.style.display = 'none';
    // Restores the button label for whatever mode is active now.
    updateActionLabels();
}

// For actions that replace what is on screen (Clear, a history entry, a new
// image, Swap): the running request is cancelled and disowned at once, so
// neither its remaining pieces nor its result can overwrite the new content.
// stopTranslation() alone would keep it as the owner until it settles.
function abandonRequest() {
    if (activeRequestId === null) return;
    window.api.cancelTranslation(activeRequestId);
    finishRequestUi();
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
    // An attached image takes the place of the text.
    const image = attachedImage ? { mediaType: attachedImage.mediaType, data: attachedImage.data } : null;
    const text = image ? '' : sourceText.value.trim();
    if (!text && !image) return;

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
            ...(image ? { image } : {}),
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
        if (requestId === activeRequestId) finishRequestUi();
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
    if (attachedImage) removeImage();
    sourceText.value = text;
    doTranslate();
});

// ===== Image input (screenshots) =====
// The image is decoded and re-encoded here, so every format the browser can
// read (WebP, GIF, BMP, ...) reaches the providers as PNG or JPEG, and large
// screenshots are scaled down to a size the vision models handle well.
const MAX_IMAGE_EDGE = 2000;
const MAX_PNG_BYTES = 3.5 * 1024 * 1024;
let attachedImage = null; // { mediaType, data (base64), url (data URL) }

const imageAttachment = $('#image-attachment');
const dropOverlay = $('#drop-overlay');

function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
    });
}

function canvasToBlob(canvas, type, quality) {
    return new Promise((resolve, reject) => {
        canvas.toBlob(blob => (blob ? resolve(blob) : reject(new Error('encode failed'))), type, quality);
    });
}

async function prepareImage(blob) {
    const bitmap = await createImageBitmap(blob);
    const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext('2d');
    // JPEG has no alpha: give transparent areas a white backing.
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();

    // PNG keeps screenshot text crisp; photos that come out huge go JPEG.
    let encoded = await canvasToBlob(canvas, 'image/png');
    if (encoded.size > MAX_PNG_BYTES) encoded = await canvasToBlob(canvas, 'image/jpeg', 0.9);

    const url = await blobToDataUrl(encoded);
    return { mediaType: encoded.type, data: url.slice(url.indexOf(',') + 1), url };
}

async function attachImage(blob) {
    if (!blob || !/^image\//.test(blob.type || 'image/')) {
        showToast('That file is not an image', 'error');
        return false;
    }
    try {
        attachedImage = await prepareImage(blob);
    } catch (e) {
        showToast('Could not read this image', 'error');
        return false;
    }
    $('#image-preview').src = attachedImage.url;
    imageAttachment.hidden = false;
    sourceText.hidden = true;
    abandonRequest();
    resetTargetPlaceholder();
    imageAttachment.focus();
    return true;
}

function removeImage() {
    attachedImage = null;
    $('#image-preview').removeAttribute('src');
    imageAttachment.hidden = true;
    sourceText.hidden = false;
    sourceText.focus();
}

function dataUrlToBlob(dataUrl) {
    const [header, base64] = dataUrl.split(',');
    const type = (header.match(/^data:([^;]+)/) || [])[1] || 'image/png';
    const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
    return new Blob([bytes], { type });
}

function imageFromClipboardData(data) {
    if (!data) return null;
    const item = [...data.items].find(i => i.kind === 'file' && i.type.startsWith('image/'));
    return item ? item.getAsFile() : null;
}

$('#btn-remove-image').addEventListener('click', removeImage);
$('#btn-pick-image').addEventListener('click', () => $('#image-file-input').click());
$('#image-file-input').addEventListener('change', (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (file) attachImage(file);
});

imageAttachment.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key === 'Enter') doTranslate();
    if (e.key === 'Delete' || e.key === 'Backspace') removeImage();
});

// Ctrl+V with an image on the clipboard, in the text field or anywhere on
// the translate screen outside other inputs.
document.addEventListener('paste', (e) => {
    if (!$('#view-translate').classList.contains('active')) return;
    const target = e.target;
    const inOtherField = target !== sourceText && target.closest && target.closest('input, textarea, [contenteditable]');
    if (inOtherField) return;
    // Text wins, as with the Paste button and the hotkey: Office apps put a
    // picture of the selection on the clipboard next to the text itself.
    if (e.clipboardData && e.clipboardData.getData('text/plain').trim()) return;
    const file = imageFromClipboardData(e.clipboardData);
    if (!file) return;
    e.preventDefault();
    attachImage(file);
});

// Drag and drop onto the source panel. Dragged-over children fire their own
// enter/leave events, so a counter tracks whether the pointer is still inside.
const sourcePanel = $('.text-area-wrapper.source');
let dragDepth = 0;
const isFileDrag = (e) => e.dataTransfer && [...e.dataTransfer.types].includes('Files');

sourcePanel.addEventListener('dragenter', (e) => {
    if (!isFileDrag(e)) return;
    dragDepth++;
    dropOverlay.hidden = false;
});
sourcePanel.addEventListener('dragleave', () => {
    if (dragDepth > 0 && --dragDepth === 0) dropOverlay.hidden = true;
});
sourcePanel.addEventListener('drop', (e) => {
    dragDepth = 0;
    dropOverlay.hidden = true;
    const file = e.dataTransfer && e.dataTransfer.files[0];
    if (file) {
        e.preventDefault();
        attachImage(file);
    }
});
// Anywhere else, a dropped file must not replace the page.
document.addEventListener('dragover', (e) => {
    if (isFileDrag(e)) e.preventDefault();
});
document.addEventListener('drop', (e) => {
    if (isFileDrag(e)) e.preventDefault();
});

// Screenshot on the clipboard + the "translate selection" hotkey.
window.api.onTranslateImage(async (dataUrl) => {
    showView('translate');
    setMode('translate');
    if (await attachImage(dataUrlToBlob(dataUrl))) doTranslate();
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
    abandonRequest();
    if (attachedImage) removeImage();
    sourceText.value = '';
    resetTargetPlaceholder();
    sourceText.focus();
});

$('#btn-paste').addEventListener('click', async () => {
    try {
        const text = await navigator.clipboard.readText();
        if (text) {
            if (attachedImage) removeImage();
            sourceText.value = text;
            sourceText.focus();
            return;
        }
        // No text: maybe a screenshot.
        const imageUrl = await window.api.readClipboardImage();
        if (imageUrl) {
            await attachImage(dataUrlToBlob(imageUrl));
        } else {
            showToast('The clipboard is empty', 'info');
        }
    } catch (e) {
        showToast('Failed to paste', 'error');
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
let historyItems = [];
let historyFilter = 'all'; // 'all' | 'favorites'
const historySearch = $('#history-search');

async function loadHistory() {
    historyItems = await window.api.getHistory();
    renderHistory();
}

function visibleHistoryItems() {
    const query = historySearch.value;
    return historyItems.filter(item =>
        (historyFilter !== 'favorites' || item.favorite) && matchesHistoryQuery(item, query));
}

function renderEmptyHistory(container, message) {
    container.innerHTML = `
      <div class="empty-state">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" opacity="0.3"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
        <p></p>
      </div>`;
    container.querySelector('p').textContent = message;
}

const STAR_ICON = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>';
const IMAGE_ICON = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>';
const DELETE_ICON = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';

function renderHistory() {
    const container = $('#history-list');
    const items = visibleHistoryItems();
    $('#btn-export-history').disabled = items.length === 0;

    if (items.length === 0) {
        let message = 'History is empty';
        if (historyItems.length) {
            message = historySearch.value.trim() ? 'Nothing matches your search' : 'No favorites yet — star a translation to keep it';
        }
        renderEmptyHistory(container, message);
        return;
    }

    const query = historySearch.value;
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
        <div class="history-item-meta">
          <span class="history-item-time">${escapeHtml(timeStr)}</span>
          <button class="history-item-star${item.favorite ? ' active' : ''}" title="${item.favorite ? 'Remove from favorites' : 'Add to favorites'}">${STAR_ICON}</button>
          <button class="history-item-delete" title="Delete">${DELETE_ICON}</button>
        </div>
      </div>
      <div class="history-item-source">${item.image ? `<span class="history-item-image">${IMAGE_ICON}Text from an image</span>` : highlightMatches(item.sourceText, query)}</div>
      <div class="history-item-target">${highlightMatches(item.targetText, query)}</div>
    `;

        // Click — load into translator
        el.addEventListener('click', (e) => {
            if (e.target.closest('button')) return;

            abandonRequest();
            if (attachedImage) removeImage();
            sourceText.value = item.sourceText || '';
            targetText.textContent = item.targetText;

            setMode(item.mode === 'fix' ? 'fix' : 'translate');

            if (src) currentSourceLang = src.code;
            if (tgt && tgt.code !== 'auto') currentTargetLang = tgt.code;
            updateLangDisplay();

            showView('translate');
        });

        el.querySelector('.history-item-star').addEventListener('click', async (e) => {
            e.stopPropagation();
            const result = await window.api.setHistoryFavorite(item.id, !item.favorite);
            if (!result.success) return;
            item.favorite = !item.favorite;
            renderHistory();
        });

        // Delete entry
        el.querySelector('.history-item-delete').addEventListener('click', async (e) => {
            e.stopPropagation();
            await window.api.deleteHistoryItem(item.id);
            historyItems = historyItems.filter(entry => entry.id !== item.id);
            el.style.animation = 'fadeIn 0.2s ease reverse';
            setTimeout(renderHistory, 200);
        });

        fragment.appendChild(el);
    });
    container.appendChild(fragment);
}

historySearch.addEventListener('input', renderHistory);

historySearch.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && historySearch.value) {
        e.stopPropagation();
        historySearch.value = '';
        renderHistory();
    }
});

$('#history-filter').addEventListener('click', (e) => {
    const btn = e.target.closest('.history-filter-btn');
    if (!btn) return;
    historyFilter = btn.dataset.filter;
    $$('.history-filter-btn').forEach(b => b.classList.toggle('active', b === btn));
    renderHistory();
});

$('#btn-export-history').addEventListener('click', async () => {
    const result = await window.api.exportHistory(visibleHistoryItems().map(item => item.id));
    if (result.success) {
        showToast(`Exported ${result.count} ${result.count === 1 ? 'entry' : 'entries'}`, 'success');
    } else if (!result.cancelled) {
        showToast(result.error || 'Export failed', 'error');
    }
});

$('#btn-clear-history').addEventListener('click', async () => {
    const result = await window.api.clearHistory();
    await loadHistory();
    showToast(result.kept ? `History cleared — ${result.kept} favorite${result.kept === 1 ? '' : 's'} kept` : 'History cleared', 'info');
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
// Packaged builds update themselves through electron-updater; `npm start`
// and builds it cannot update fall back to a plain "a new version exists" check.
const RELEASES_PAGE = 'https://github.com/PabloSensei/ai-translator/releases/latest';
let lastUpdateState = null;

function releasesLink(text) {
    const link = document.createElement('a');
    link.href = '#';
    link.textContent = text;
    link.addEventListener('click', (ev) => {
        ev.preventDefault();
        window.api.openExternal(RELEASES_PAGE);
    });
    return link;
}

function renderUpdateStatus(status) {
    if (!status) return;
    const el = $('#update-status');
    el.className = 'update-status';
    el.textContent = '';
    $('#btn-download-update').hidden = status.state !== 'available' || Boolean(status.manual);
    $('#btn-install-update').hidden = status.state !== 'downloaded';

    const version = status.version ? `Version ${status.version}` : 'A new version';
    switch (status.state) {
        case 'checking':
            el.textContent = 'Checking for updates...';
            break;
        case 'latest':
            el.textContent = `You are on the latest version (${status.currentVersion}).`;
            break;
        case 'available':
            el.classList.add('update-available');
            el.textContent = `${version} is available (you have ${status.currentVersion}). `;
            // Builds that cannot install updates themselves (macOS) link to the download.
            if (status.manual) el.appendChild(releasesLink('Download it from GitHub'));
            break;
        case 'downloading':
            el.textContent = `Downloading ${version.toLowerCase()}... ${status.percent || 0}%`;
            break;
        case 'downloaded':
            el.classList.add('update-available');
            el.textContent = `${version} is ready. It installs when you restart the app.`;
            break;
        case 'error':
            el.classList.add('error-text');
            el.textContent = `Update failed: ${status.error} `;
            el.appendChild(releasesLink('Open the releases page'));
            break;
        default:
            break;
    }

    // Announce the moments that need the user, once each.
    if (status.state !== lastUpdateState) {
        if (status.state === 'downloaded') showToast(`${version} is ready — restart to install it`, 'success');
        if (status.state === 'available' && lastUpdateState !== null) showToast(`Update available: v${status.version}`, 'info');
    }
    lastUpdateState = status.state;
}

window.api.onUpdateStatus(renderUpdateStatus);

async function initUpdates(settings) {
    $('#auto-update-row').hidden = !settings.autoUpdateSupported;
    $('#auto-update-checkbox').checked = settings.autoUpdate !== false;
    // Also on macOS, where updates are announced rather than installed.
    const status = await window.api.getUpdateStatus();
    if (status && status.state !== 'idle') renderUpdateStatus(status);
}

$('#auto-update-checkbox').addEventListener('change', async (e) => {
    await window.api.saveSettings({ autoUpdate: e.target.checked });
    showToast(e.target.checked ? 'Updates will download automatically' : 'You will be asked before an update downloads', 'info');
});

$('#btn-download-update').addEventListener('click', async (e) => {
    // e.currentTarget is null once the handler has awaited.
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
        renderUpdateStatus(await window.api.downloadUpdate());
    } finally {
        btn.disabled = false;
    }
});

$('#btn-install-update').addEventListener('click', () => window.api.installUpdate());

$('#btn-check-updates').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const status = $('#update-status');

    btn.disabled = true;
    btn.textContent = 'Checking...';
    status.className = 'update-status';
    status.textContent = '';

    try {
        const result = await window.api.checkForUpdates();

        if (result.status) {
            renderUpdateStatus(result.status);
            return;
        }

        if (!result.success) {
            status.classList.add('error-text');
            status.textContent = `Update check failed: ${result.error}`;
            return;
        }

        if (result.updateAvailable) {
            status.classList.add('update-available');
            status.textContent = `Version ${result.latestVersion} is available (you have ${result.currentVersion}). `;
            status.appendChild(releasesLink('Open the download page'));
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
