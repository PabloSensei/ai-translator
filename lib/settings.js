// --- Settings validation ---
// Everything here arrives over IPC. Even though the renderer is our own code,
// the settings file is user-editable on disk and is read back on every launch,
// so values are normalised before they are stored or used.

const PROVIDERS = ['gemini', 'openrouter', 'anthropic'];

const MAX_STYLE_NAME = 40;
const MAX_STYLE_INSTRUCTION = 2000;
const MAX_CUSTOM_STYLES = 50;
const MAX_RECENT_PAIRS = 6;

// Generous upper bound on what one request may carry. Larger inputs are
// rejected with a clear message instead of failing deep inside a provider.
const MAX_TEXT_LENGTH = 20000;

function sanitizeString(value, maxLength) {
  if (typeof value !== 'string') return '';
  return value.slice(0, maxLength).trim();
}

function sanitizeProvider(value) {
  return PROVIDERS.includes(value) ? value : 'gemini';
}

// A Gemini model id is interpolated into the request URL path ("models/<id>:
// generateContent"), so it is kept to bare id characters — no slash or colon
// that could reshape that path. Anthropic ids ("claude-opus-5-5") follow the
// same shape.
function sanitizeBareModelId(value) {
  const id = sanitizeString(value, 200);
  return /^[A-Za-z0-9._-]+$/.test(id) ? id : '';
}

// An OpenRouter model id travels in the JSON body, not the URL, and legitimately
// contains a vendor prefix and a variant suffix (e.g. "meta-llama/llama-3.3-70b-instruct:free").
function sanitizeOpenRouterModelId(value) {
  const id = sanitizeString(value, 200);
  return /^[A-Za-z0-9._/:-]+$/.test(id) ? id : '';
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

// Keeps the "recently used" row honest: newest pair first, no duplicates, capped.
// Returns the existing list untouched when the pair is malformed.
function mergeRecentPairs(existing, { source, target } = {}) {
  const list = Array.isArray(existing) ? existing : [];
  if (typeof source !== 'string' || typeof target !== 'string' || !source || !target) {
    return list;
  }
  const filtered = list.filter(p => p && !(p.source === source && p.target === target));
  return [{ source, target }, ...filtered].slice(0, MAX_RECENT_PAIRS);
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

// safeStorage output is stored hex-encoded. Real API keys are never pure hex
// (they start with "AIza", "sk-or-", "sk-ant-", ...), so a pure-hex value is
// ciphertext and anything else is a legacy plaintext key.
function looksEncrypted(value) {
  return typeof value === 'string' && value.length >= 32 && value.length % 2 === 0 && /^[0-9a-f]+$/i.test(value);
}

// Only exact, known URLs may be handed to the OS browser.
function isAllowedExternalUrl(url, allowlist) {
  if (!url || typeof url !== 'string') return false;
  let parsed;
  try {
    parsed = new URL(url);
  } catch (e) {
    return false;
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) return false;
  return Array.isArray(allowlist) && allowlist.includes(url);
}

module.exports = {
  PROVIDERS,
  MAX_STYLE_NAME,
  MAX_STYLE_INSTRUCTION,
  MAX_CUSTOM_STYLES,
  MAX_RECENT_PAIRS,
  MAX_TEXT_LENGTH,
  sanitizeString,
  sanitizeProvider,
  sanitizeBareModelId,
  sanitizeOpenRouterModelId,
  sanitizeCustomStyles,
  mergeRecentPairs,
  parseVersion,
  isNewerVersion,
  looksEncrypted,
  isAllowedExternalUrl
};
