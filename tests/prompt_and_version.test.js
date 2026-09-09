const assert = require('assert');

// Implementations mirrored from main.js
const STYLE_INSTRUCTIONS = {
  neutral: '',
  formal: 'FORMAL_INSTRUCTION',
  casual: 'CASUAL_INSTRUCTION'
};

function getStyleInstruction(style, customStyles) {
  if (STYLE_INSTRUCTIONS[style] !== undefined) return STYLE_INSTRUCTIONS[style];
  const custom = (customStyles || []).find(s => s && s.id === style);
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

console.log('--- Testing buildPrompt ---');

// Explicit source language
let prompt = buildPrompt({ text: 'hello', sourceLang: 'English', targetLang: 'Russian', mode: 'translate', styleInstruction: '' });
assert.ok(prompt.includes('Translate the following text from English to Russian.'));
assert.ok(prompt.endsWith('Text:\nhello'));
console.log('PASSED: Explicit source language');

// Auto-detect source language
prompt = buildPrompt({ text: 'hello', sourceLang: 'auto', targetLang: 'Russian', mode: 'translate', styleInstruction: '' });
assert.ok(prompt.includes('Detect the language of the following text and translate it to Russian.'));
assert.ok(!prompt.includes('from auto'));
console.log('PASSED: Detect language');

// A missing source language behaves like auto
prompt = buildPrompt({ text: 'hello', sourceLang: undefined, targetLang: 'Russian', mode: 'translate', styleInstruction: '' });
assert.ok(prompt.includes('Detect the language'));
console.log('PASSED: Missing source language falls back to detection');

// Fix mode keeps the original language and ignores the target
prompt = buildPrompt({ text: 'helo', sourceLang: 'English', targetLang: 'Russian', mode: 'fix', styleInstruction: '' });
assert.ok(prompt.includes('Correct any spelling, grammar, and punctuation errors in the following English text.'));
assert.ok(prompt.includes('Keep the original language.'));
assert.ok(!prompt.includes('Russian'));
console.log('PASSED: Fix mode ignores the target language');

// Fix mode with auto-detection omits the language name
prompt = buildPrompt({ text: 'helo', sourceLang: 'auto', targetLang: 'Russian', mode: 'fix', styleInstruction: '' });
assert.ok(prompt.includes('errors in the following text.'));
console.log('PASSED: Fix mode with detection');

// Style instructions are injected
prompt = buildPrompt({ text: 'hello', sourceLang: 'English', targetLang: 'Russian', mode: 'translate', styleInstruction: 'FORMAL_INSTRUCTION' });
assert.ok(prompt.includes('to Russian. FORMAL_INSTRUCTION Return ONLY'));
console.log('PASSED: Style instruction injected');

console.log('--- Testing getStyleInstruction ---');

assert.strictEqual(getStyleInstruction('formal'), 'FORMAL_INSTRUCTION');
assert.strictEqual(getStyleInstruction('neutral'), '');
assert.strictEqual(getStyleInstruction('custom-1', [{ id: 'custom-1', instruction: '  Pirate speak  ' }]), 'Pirate speak');
assert.strictEqual(getStyleInstruction('custom-missing', []), '');
assert.strictEqual(getStyleInstruction('custom-1', [null, { id: 'custom-1', instruction: 'ok' }]), 'ok');
console.log('PASSED: Built-in, custom, and unknown styles resolve correctly');

console.log('--- Testing isNewerVersion ---');

assert.strictEqual(isNewerVersion('1.1.0', '1.0.1'), true);
assert.strictEqual(isNewerVersion('v1.1.0', '1.1.0'), false);
assert.strictEqual(isNewerVersion('1.0.0', '1.0.1'), false);
assert.strictEqual(isNewerVersion('2.0.0', '1.9.9'), true);
assert.strictEqual(isNewerVersion('1.10.0', '1.9.0'), true);
// Numeric suffixes are compared as an extra segment; non-numeric pre-release
// tags (e.g. "-beta") are not ranked and count as 0.
assert.strictEqual(isNewerVersion('1.0.2-2', '1.0.2-1'), true);
assert.strictEqual(isNewerVersion('1.0.2', '1.0.2-beta'), false);
console.log('PASSED: Version comparison');

console.log('--- All Tests Passed ---');
