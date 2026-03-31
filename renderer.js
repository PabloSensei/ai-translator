// ===== Language List =====
const LANGUAGES = [
    { code: 'en', name: 'English', flag: '🇬🇧' },
    { code: 'ru', name: 'Russian', flag: '🇷🇺' },
    { code: 'de', name: 'Deutsch', flag: '🇩🇪' },
    { code: 'fr', name: 'Français', flag: '🇫🇷' },
    { code: 'es', name: 'Español', flag: '🇪🇸' },
    { code: 'it', name: 'Italiano', flag: '🇮🇹' },
    { code: 'pt', name: 'Português', flag: '🇵🇹' },
    { code: 'uk', name: 'Українська', flag: '🇺🇦' },
    { code: 'pl', name: 'Polski', flag: '🇵🇱' },
    { code: 'cs', name: 'Čeština', flag: '🇨🇿' },
    { code: 'nl', name: 'Nederlands', flag: '🇳🇱' },
    { code: 'sv', name: 'Svenska', flag: '🇸🇪' },
    { code: 'da', name: 'Dansk', flag: '🇩🇰' },
    { code: 'fi', name: 'Suomi', flag: '🇫🇮' },
    { code: 'no', name: 'Norsk', flag: '🇳🇴' },
    { code: 'zh', name: '中文', flag: '🇨🇳' },
    { code: 'ja', name: '日本語', flag: '🇯🇵' },
    { code: 'ko', name: '한국어', flag: '🇰🇷' },
    { code: 'ar', name: 'العربية', flag: '🇸🇦' },
    { code: 'hi', name: 'हिन्दी', flag: '🇮🇳' },
    { code: 'tr', name: 'Türkçe', flag: '🇹🇷' },
    { code: 'el', name: 'Ελληνικά', flag: '🇬🇷' },
    { code: 'he', name: 'עברית', flag: '🇮🇱' },
    { code: 'th', name: 'ไทย', flag: '🇹🇭' },
    { code: 'vi', name: 'Tiếng Việt', flag: '🇻🇳' },
    { code: 'id', name: 'Bahasa Indonesia', flag: '🇮🇩' },
    { code: 'ms', name: 'Bahasa Melayu', flag: '🇲🇾' },
    { code: 'ro', name: 'Română', flag: '🇷🇴' },
    { code: 'hu', name: 'Magyar', flag: '🇭🇺' },
    { code: 'bg', name: 'Български', flag: '🇧🇬' },
    { code: 'hr', name: 'Hrvatski', flag: '🇭🇷' },
    { code: 'sk', name: 'Slovenčina', flag: '🇸🇰' },
    { code: 'lt', name: 'Lietuvių', flag: '🇱🇹' },
    { code: 'lv', name: 'Latviešu', flag: '🇱🇻' },
    { code: 'et', name: 'Eesti', flag: '🇪🇪' },
    { code: 'ka', name: 'ქართული', flag: '🇬🇪' },
];

const LANGUAGES_BY_CODE = new Map(LANGUAGES.map(l => [l.code, l]));
const LANGUAGES_BY_NAME = new Map(LANGUAGES.map(l => [l.name, l]));

// ===== State =====
let currentSourceLang = 'en';
let currentTargetLang = 'ru';
let currentStyle = 'neutral'; // 'formal' | 'neutral' | 'casual'
let isTranslating = false;
let currentHotkey = 'Ctrl+Shift+T';

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

// ===== Initialization =====
async function init() {
    const settings = await window.api.getSettings();

    // Set API key if present
    if (settings.apiKey) {
        $('#api-key-input').value = settings.apiKey;
    }

    if (settings.hotkey) {
        currentHotkey = settings.hotkey;
        $('#hotkey-input').value = settings.hotkey;
    }

    if (settings.model) {
        $('#model-select').value = settings.model;
    }

    // Create language dropdowns
    buildDropdown(sourceLangDropdown, 'source');
    buildDropdown(targetLangDropdown, 'target');

    // Update language display
    updateLangDisplay();

    // Recent languages
    renderRecentLanguages(settings.recentLanguages || []);

    // Load history
    loadHistory();

    // Translation style
    initStyleSelector();
}

// ===== Dropdown Construction =====
function buildDropdown(container, type) {
    container.innerHTML = '';

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

    // Options
    LANGUAGES.forEach(lang => {
        const option = document.createElement('div');
        option.className = 'lang-option';
        option.dataset.code = lang.code;
        option.innerHTML = `<span class="lang-flag">${lang.flag}</span>${lang.name}`;

        option.addEventListener('click', () => {
            if (type === 'source') {
                currentSourceLang = lang.code;
            } else {
                currentTargetLang = lang.code;
            }
            updateLangDisplay();
            closeAllDropdowns();
        });

        container.appendChild(option);
    });
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

function updateLangDisplay() {
    const source = LANGUAGES_BY_CODE.get(currentSourceLang);
    const target = LANGUAGES_BY_CODE.get(currentTargetLang);

    sourceLangLabel.textContent = source ? source.name : currentSourceLang;
    targetLangLabel.textContent = target ? target.name : currentTargetLang;

    // Update selected state
    sourceLangDropdown.querySelectorAll('.lang-option').forEach(opt => {
        opt.classList.toggle('selected', opt.dataset.code === currentSourceLang);
    });
    targetLangDropdown.querySelectorAll('.lang-option').forEach(opt => {
        opt.classList.toggle('selected', opt.dataset.code === currentTargetLang);
    });

    const isSameLang = currentSourceLang === currentTargetLang;
    if (!isTranslating) {
        translateBtn.querySelector('.translate-btn-text').textContent = isSameLang ? 'Fix Errors' : 'Translate';
    }

    // Update placeholder if present
    const placeholder = targetText.querySelector('.placeholder');
    if (placeholder && !isTranslating) {
        placeholder.textContent = isSameLang ? 'Corrected text will appear here...' : 'Translation will appear here...';
    }
}

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
        const isSameLang = currentSourceLang === currentTargetLang;
        if (tempText) {
            targetText.textContent = tempText;
        } else {
            targetText.innerHTML = `<span class="placeholder">${isSameLang ? 'Corrected text' : 'Translation'} will appear here...</span>`;
        }
    }
});

// ===== Recent Languages =====
function renderRecentLanguages(recentCodes) {
    recentLangsContainer.innerHTML = '';

    // Show pairs for quick selection
    const pairs = [];
    for (let i = 0; i < recentCodes.length - 1; i += 2) {
        const src = LANGUAGES_BY_CODE.get(recentCodes[i]);
        const tgt = LANGUAGES_BY_CODE.get(recentCodes[i + 1]);
        if (src && tgt) {
            pairs.push({ src, tgt });
        }
    }

    // Also add individual languages as chips
    const uniqueCodes = [...new Set(recentCodes)].slice(0, 8);
    uniqueCodes.forEach(code => {
        const lang = LANGUAGES_BY_CODE.get(code);
        if (!lang) return;

        const chip = document.createElement('button');
        chip.className = 'recent-chip';
        chip.textContent = `${lang.flag} ${lang.name}`;
        chip.addEventListener('click', () => {
            // If it is current source — set as target, otherwise as source
            if (currentSourceLang === code) {
                currentTargetLang = code;
            } else {
                currentSourceLang = code;
            }
            updateLangDisplay();
        });
        recentLangsContainer.appendChild(chip);
    });
}

// ===== Translation Style =====
function initStyleSelector() {
    const styleBtns = document.querySelectorAll('.style-btn');
    styleBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            styleBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentStyle = btn.dataset.style;
        });
    });
}

// ===== Translation =====
translateBtn.addEventListener('click', doTranslate);

sourceText.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key === 'Enter') {
        doTranslate();
    }
});

async function doTranslate() {
    const text = sourceText.value.trim();
    if (!text || isTranslating) return;

    const isSameLang = currentSourceLang === currentTargetLang;
    const actionText = isSameLang ? 'Fixing...' : 'Translating...';
    const btnText = isSameLang ? 'Fix Errors' : 'Translate';

    isTranslating = true;
    translateBtn.disabled = true;
    translateBtn.querySelector('.translate-btn-text').textContent = actionText;
    loader.style.display = 'flex';
    targetText.innerHTML = `<span class="placeholder">${actionText}</span>`;

    try {
        const sourceLang = LANGUAGES_BY_CODE.get(currentSourceLang)?.name || currentSourceLang;
        const targetLang = LANGUAGES_BY_CODE.get(currentTargetLang)?.name || currentTargetLang;

        const result = await window.api.translate({
            text,
            sourceLang,
            targetLang,
            style: currentStyle
        });

        if (result.success) {
            targetText.textContent = result.translated;

            // Update recent
            const recent = await window.api.getRecentLanguages();
            renderRecentLanguages(recent);

            showToast(isSameLang ? 'Text fixed successfully' : 'Translation successful', 'success');
        } else {
            targetText.innerHTML = `<span class="placeholder error-text">${escapeHtml(result.error)}</span>`;
            showToast(result.error, 'error');
        }
    } catch (err) {
        targetText.innerHTML = `<span class="placeholder error-text">Error: ${escapeHtml(err.message)}</span>`;
        showToast(isSameLang ? 'Fixing error' : 'Translation error', 'error');
    } finally {
        isTranslating = false;
        translateBtn.disabled = false;
        translateBtn.querySelector('.translate-btn-text').textContent = btnText;
        loader.style.display = 'none';
    }
}

// ===== Text Actions =====
$('#btn-clear').addEventListener('click', () => {
    sourceText.value = '';
    const isSameLang = currentSourceLang === currentTargetLang;
    targetText.innerHTML = `<span class="placeholder">${isSameLang ? 'Corrected text' : 'Translation'} will appear here...</span>`;
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

    items.forEach(item => {
        const el = document.createElement('div');
        el.className = 'history-item';

        const time = new Date(item.timestamp);
        const timeStr = time.toLocaleString('en-US', {
            day: '2-digit', month: '2-digit', year: 'numeric',
            hour: '2-digit', minute: '2-digit'
        });

        el.innerHTML = `
      <div class="history-item-header">
        <div class="history-item-langs">
          <span>${escapeHtml(item.sourceLang)}</span>
          <span class="arrow">→</span>
          <span>${escapeHtml(item.targetLang)}</span>
        </div>
        <span class="history-item-time">${timeStr}</span>
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

            // Find language codes by names
            const src = LANGUAGES_BY_NAME.get(item.sourceLang);
            const tgt = LANGUAGES_BY_NAME.get(item.targetLang);
            if (src) currentSourceLang = src.code;
            if (tgt) currentTargetLang = tgt.code;
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

        container.appendChild(el);
    });
}

$('#btn-clear-history').addEventListener('click', async () => {
    await window.api.clearHistory();
    loadHistory();
    showToast('History cleared', 'info');
});

// ===== Settings =====
$('#toggle-api-key').addEventListener('click', () => {
    const input = $('#api-key-input');
    input.type = input.type === 'password' ? 'text' : 'password';
});

$('#hotkey-input').addEventListener('click', function () {
    this.value = 'Press a key combination...';
    this.removeAttribute('readonly');
    window.api.unregisterHotkey();
});

$('#hotkey-input').addEventListener('blur', function () {
    if (this.value === 'Press a key combination...') {
        this.value = currentHotkey;
    }
    this.setAttribute('readonly', true);
    window.api.registerHotkey();
});

$('#hotkey-input').addEventListener('keydown', function (e) {
    e.preventDefault();

    if (e.key === 'Escape') {
        this.value = currentHotkey;
        this.blur();
        return;
    }

    const parts = [];
    if (e.ctrlKey) parts.push('Ctrl');
    if (e.altKey) parts.push('Alt');
    if (e.shiftKey) parts.push('Shift');

    const key = e.key;
    if (!['Control', 'Alt', 'Shift', 'Meta'].includes(key)) {
        let keyName = key.length === 1 ? key.toUpperCase() : key;
        if (keyName === ' ') keyName = 'Space';
        parts.push(keyName);

        if (parts.length > 1) {
            this.value = parts.join('+');
            this.setAttribute('readonly', true);
            this.blur();
        }
    } else {
        if (parts.length > 0) {
            this.value = parts.join('+') + '+...';
        }
    }
});

$('#btn-save-settings').addEventListener('click', async () => {
    const apiKey = $('#api-key-input').value.trim();
    const hotkey = $('#hotkey-input').value.trim();
    const model = $('#model-select').value;

    const settings = {};
    if (apiKey) settings.apiKey = apiKey;
    if (hotkey && hotkey !== 'Press a key combination...') {
        settings.hotkey = hotkey;
        currentHotkey = hotkey;
    }
    if (model) settings.model = model;

    const result = await window.api.saveSettings(settings);
    if (result.success) {
        showToast('Settings saved', 'success');
    }
});

$('#link-aistudio').addEventListener('click', (e) => {
    e.preventDefault();
    window.api.openExternal('https://aistudio.google.com/apikey');
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
