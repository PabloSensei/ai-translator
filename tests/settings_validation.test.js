const assert = require('assert');

// Implementations mirrored from main.js
const STYLE_INSTRUCTIONS = {
  neutral: '',
  formal: 'FORMAL_INSTRUCTION',
  casual: 'CASUAL_INSTRUCTION'
};

function getStyleInstruction(style, customStyles) {
  if (typeof style !== 'string') return '';
  if (Object.prototype.hasOwnProperty.call(STYLE_INSTRUCTIONS, style)) {
    return STYLE_INSTRUCTIONS[style];
  }
  const custom = (Array.isArray(customStyles) ? customStyles : []).find(s => s && s.id === style);
  if (custom && typeof custom.instruction === 'string') return custom.instruction.trim();
  return '';
}

const MAX_STYLE_NAME = 40;
const MAX_STYLE_INSTRUCTION = 2000;
const MAX_CUSTOM_STYLES = 50;

function sanitizeString(value, maxLength) {
  if (typeof value !== 'string') return '';
  return value.slice(0, maxLength).trim();
}

function sanitizeGeminiModelId(value) {
  const id = sanitizeString(value, 200);
  return /^[A-Za-z0-9._-]+$/.test(id) ? id : '';
}

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
    .filter(s => s.id && s.name && s.instruction && s.id.startsWith('custom-'))
    .slice(0, MAX_CUSTOM_STYLES);
}

console.log('--- Testing getStyleInstruction against prototype members ---');

// Regression: a plain property lookup returned inherited Object.prototype
// members, which were then stringified into the outgoing prompt.
for (const key of ['toString', 'constructor', 'valueOf', '__proto__', 'hasOwnProperty', 'isPrototypeOf']) {
  const result = getStyleInstruction(key, []);
  assert.strictEqual(result, '', `expected '' for inherited key "${key}", got ${typeof result}`);
}
console.log('PASSED: Inherited prototype keys resolve to an empty instruction');

assert.strictEqual(getStyleInstruction('formal'), 'FORMAL_INSTRUCTION');
assert.strictEqual(getStyleInstruction('neutral'), '');
assert.strictEqual(getStyleInstruction(null), '');
assert.strictEqual(getStyleInstruction(undefined), '');
assert.strictEqual(getStyleInstruction({ toString: () => 'formal' }), '');
assert.strictEqual(getStyleInstruction('custom-1', 'not-an-array'), '');
console.log('PASSED: Built-in styles still resolve; non-string ids rejected');

console.log('--- Testing sanitizeGeminiModelId ---');

assert.strictEqual(sanitizeGeminiModelId('gemini-2.5-flash'), 'gemini-2.5-flash');
assert.strictEqual(sanitizeGeminiModelId('gemini-3.1-pro-preview'), 'gemini-3.1-pro-preview');
// A Gemini id lands in the request URL path, so separators must not survive.
assert.strictEqual(sanitizeGeminiModelId('../../../etc/passwd '), '');
assert.strictEqual(sanitizeGeminiModelId('model:generateContent?key=leak'), '');
assert.strictEqual(sanitizeGeminiModelId('vendor/model'), '');
assert.strictEqual(sanitizeGeminiModelId('model name with spaces'), '');
assert.strictEqual(sanitizeGeminiModelId(''), '');
assert.strictEqual(sanitizeGeminiModelId(null), '');
assert.strictEqual(sanitizeGeminiModelId('a'.repeat(500)), 'a'.repeat(200));
console.log('PASSED: Gemini ids restricted to bare id characters');

console.log('--- Testing sanitizeOpenRouterModelId ---');

// Real OpenRouter ids carry a vendor prefix and an optional variant suffix.
assert.strictEqual(sanitizeOpenRouterModelId('anthropic/claude-sonnet-4.5'), 'anthropic/claude-sonnet-4.5');
assert.strictEqual(sanitizeOpenRouterModelId('meta-llama/llama-3.3-70b-instruct:free'), 'meta-llama/llama-3.3-70b-instruct:free');
assert.strictEqual(sanitizeOpenRouterModelId('google/gemini-2.5-flash:nitro'), 'google/gemini-2.5-flash:nitro');
assert.strictEqual(sanitizeOpenRouterModelId('model with spaces'), '');
assert.strictEqual(sanitizeOpenRouterModelId('model\n{"injected":true}'), '');
assert.strictEqual(sanitizeOpenRouterModelId(null), '');
console.log('PASSED: OpenRouter ids allow vendor prefixes and variant suffixes');

console.log('--- Testing sanitizeCustomStyles ---');

assert.deepStrictEqual(
  sanitizeCustomStyles([{ id: 'custom-1', name: '  Legal  ', instruction: '  Use contract wording  ' }]),
  [{ id: 'custom-1', name: 'Legal', instruction: 'Use contract wording' }]
);
console.log('PASSED: Valid style is kept and trimmed');

// Ids that could shadow a built-in or a prototype member are dropped.
assert.deepStrictEqual(sanitizeCustomStyles([{ id: 'formal', name: 'Fake', instruction: 'x' }]), []);
assert.deepStrictEqual(sanitizeCustomStyles([{ id: 'toString', name: 'Fake', instruction: 'x' }]), []);
assert.deepStrictEqual(sanitizeCustomStyles([{ id: '__proto__', name: 'Fake', instruction: 'x' }]), []);
console.log('PASSED: Non-custom-prefixed ids are rejected');

// Incomplete or malformed entries are dropped.
assert.deepStrictEqual(sanitizeCustomStyles([{ id: 'custom-1', name: '', instruction: 'x' }]), []);
assert.deepStrictEqual(sanitizeCustomStyles([{ id: 'custom-1', name: 'A', instruction: '   ' }]), []);
assert.deepStrictEqual(sanitizeCustomStyles([null, undefined, 'str', 42]), []);
assert.deepStrictEqual(sanitizeCustomStyles('nope'), []);
assert.deepStrictEqual(sanitizeCustomStyles(undefined), []);
console.log('PASSED: Malformed entries are dropped');

// Length and count caps keep the settings file bounded.
const huge = sanitizeCustomStyles([{ id: 'custom-1', name: 'N'.repeat(200), instruction: 'I'.repeat(9000) }]);
assert.strictEqual(huge[0].name.length, MAX_STYLE_NAME);
assert.strictEqual(huge[0].instruction.length, MAX_STYLE_INSTRUCTION);

const many = Array.from({ length: 200 }, (_, i) => ({ id: `custom-${i}`, name: 'n', instruction: 'i' }));
assert.strictEqual(sanitizeCustomStyles(many).length, MAX_CUSTOM_STYLES);
console.log('PASSED: Length and count caps enforced');

console.log('--- All Tests Passed ---');
