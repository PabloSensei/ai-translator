const test = require('node:test');
const assert = require('node:assert');
const s = require('../lib/settings');

test('sanitizeBareModelId keeps Gemini and Claude ids, rejects path tricks', () => {
  assert.strictEqual(s.sanitizeBareModelId('gemini-2.5-flash'), 'gemini-2.5-flash');
  assert.strictEqual(s.sanitizeBareModelId('claude-opus-5-5'), 'claude-opus-5-5');
  assert.strictEqual(s.sanitizeBareModelId('../../../etc/passwd '), '');
  assert.strictEqual(s.sanitizeBareModelId('model:generateContent?key=leak'), '');
  assert.strictEqual(s.sanitizeBareModelId('vendor/model'), '');
  assert.strictEqual(s.sanitizeBareModelId('model name'), '');
  assert.strictEqual(s.sanitizeBareModelId(null), '');
  assert.strictEqual(s.sanitizeBareModelId('a'.repeat(500)), 'a'.repeat(200));
});

test('sanitizeOpenRouterModelId allows vendor prefixes and variants', () => {
  assert.strictEqual(s.sanitizeOpenRouterModelId('meta-llama/llama-3.3-70b-instruct:free'), 'meta-llama/llama-3.3-70b-instruct:free');
  assert.strictEqual(s.sanitizeOpenRouterModelId('model with spaces'), '');
  assert.strictEqual(s.sanitizeOpenRouterModelId('model\n{"injected":true}'), '');
});

test('sanitizeProvider', () => {
  assert.strictEqual(s.sanitizeProvider('anthropic'), 'anthropic');
  assert.strictEqual(s.sanitizeProvider('openrouter'), 'openrouter');
  assert.strictEqual(s.sanitizeProvider('evil'), 'gemini');
  assert.strictEqual(s.sanitizeProvider(undefined), 'gemini');
});

test('sanitizeCustomStyles', () => {
  assert.deepStrictEqual(
    s.sanitizeCustomStyles([{ id: 'custom-1', name: '  Legal  ', instruction: '  Use contract wording  ' }]),
    [{ id: 'custom-1', name: 'Legal', instruction: 'Use contract wording' }]
  );
  for (const id of ['formal', 'toString', '__proto__']) {
    assert.deepStrictEqual(s.sanitizeCustomStyles([{ id, name: 'Fake', instruction: 'x' }]), []);
  }
  assert.deepStrictEqual(s.sanitizeCustomStyles([{ id: 'custom-1', name: '', instruction: 'x' }]), []);
  assert.deepStrictEqual(s.sanitizeCustomStyles([null, undefined, 'str', 42]), []);
  assert.deepStrictEqual(s.sanitizeCustomStyles('nope'), []);

  const huge = s.sanitizeCustomStyles([{ id: 'custom-1', name: 'N'.repeat(200), instruction: 'I'.repeat(9000) }]);
  assert.strictEqual(huge[0].name.length, s.MAX_STYLE_NAME);
  assert.strictEqual(huge[0].instruction.length, s.MAX_STYLE_INSTRUCTION);
  const many = Array.from({ length: 200 }, (_, i) => ({ id: `custom-${i}`, name: 'n', instruction: 'i' }));
  assert.strictEqual(s.sanitizeCustomStyles(many).length, s.MAX_CUSTOM_STYLES);
});

test('mergeRecentPairs', () => {
  assert.deepStrictEqual(s.mergeRecentPairs([{ source: 'en', target: 'ru' }], { source: 'pl', target: 'de' }),
    [{ source: 'pl', target: 'de' }, { source: 'en', target: 'ru' }]);

  // Re-used pair moves to the front, no duplicate.
  assert.deepStrictEqual(
    s.mergeRecentPairs([{ source: 'en', target: 'ru' }, { source: 'pl', target: 'de' }], { source: 'pl', target: 'de' }),
    [{ source: 'pl', target: 'de' }, { source: 'en', target: 'ru' }]
  );

  // Direction matters.
  assert.strictEqual(s.mergeRecentPairs([{ source: 'en', target: 'ru' }], { source: 'ru', target: 'en' }).length, 2);

  let pairs = [];
  for (const code of ['a', 'b', 'c', 'd', 'e', 'f', 'g']) pairs = s.mergeRecentPairs(pairs, { source: code, target: 'ru' });
  assert.strictEqual(pairs.length, s.MAX_RECENT_PAIRS);
  assert.deepStrictEqual(pairs[0], { source: 'g', target: 'ru' });

  // Malformed input leaves the list untouched (same reference).
  const existing = [{ source: 'auto', target: 'ru' }];
  assert.strictEqual(s.mergeRecentPairs(existing, { source: '', target: 'ru' }), existing);
  assert.strictEqual(s.mergeRecentPairs(existing, undefined), existing);
  assert.strictEqual(s.mergeRecentPairs(existing, { source: 123, target: 'ru' }), existing);
  assert.deepStrictEqual(s.mergeRecentPairs(null, { source: 'en', target: 'ru' }), [{ source: 'en', target: 'ru' }]);
});

test('isNewerVersion', () => {
  assert.strictEqual(s.isNewerVersion('1.1.0', '1.0.1'), true);
  assert.strictEqual(s.isNewerVersion('v1.1.0', '1.1.0'), false);
  assert.strictEqual(s.isNewerVersion('1.0.0', '1.0.1'), false);
  assert.strictEqual(s.isNewerVersion('1.10.0', '1.9.0'), true);
  assert.strictEqual(s.isNewerVersion('1.0.2-2', '1.0.2-1'), true);
  assert.strictEqual(s.isNewerVersion('1.0.2', '1.0.2-beta'), false);
});

test('looksEncrypted tells ciphertext from plaintext keys', () => {
  assert.strictEqual(s.looksEncrypted('763130' + 'ab'.repeat(40)), true);
  assert.strictEqual(s.looksEncrypted('AIzaSyD-example-key-1234567890abcdef'), false);
  assert.strictEqual(s.looksEncrypted('sk-ant-api03-abcdef0123456789abcdef0123456789'), false);
  assert.strictEqual(s.looksEncrypted('sk-or-v1-0123456789abcdef0123456789abcdef'), false);
  assert.strictEqual(s.looksEncrypted('abcd'), false);
  assert.strictEqual(s.looksEncrypted(''), false);
  assert.strictEqual(s.looksEncrypted(null), false);
});

test('isAllowedExternalUrl', () => {
  const allow = ['https://aistudio.google.com/apikey', 'https://aistudio.google.com/'];
  assert.strictEqual(s.isAllowedExternalUrl('https://aistudio.google.com/apikey', allow), true);
  assert.strictEqual(s.isAllowedExternalUrl('https://aistudio.google.com/', allow), true);
  for (const bad of ['https://google.com', 'http://example.com', 'file:///etc/passwd', 'javascript:alert(1)',
    'sftp://example.com', 'invalid-url', '', null, 123, 'https://aistudio.google.com/apikey/../evil']) {
    assert.strictEqual(s.isAllowedExternalUrl(bad, allow), false, String(bad));
  }
});

test('sanitizeImage accepts PNG/JPEG base64 and rejects everything else', () => {
  assert.strictEqual(s.sanitizeImage(undefined), null);
  assert.strictEqual(s.sanitizeImage(null), null);
  assert.deepStrictEqual(s.sanitizeImage({ mediaType: 'image/png', data: 'iVBORw0KGgo=', extra: 1 }), { mediaType: 'image/png', data: 'iVBORw0KGgo=' });
  assert.throws(() => s.sanitizeImage({ mediaType: 'image/svg+xml', data: 'PHN2Zz4=' }), /Unsupported/);
  assert.throws(() => s.sanitizeImage({ mediaType: 'image/png', data: '' }), /invalid/);
  assert.throws(() => s.sanitizeImage({ mediaType: 'image/png', data: 'data:image/png;base64,AAAA' }), /invalid/);
  assert.throws(() => s.sanitizeImage({ mediaType: 'image/jpeg', data: 'A'.repeat(s.MAX_IMAGE_BASE64_LENGTH + 4) }), /too large/);
  assert.throws(() => s.sanitizeImage('image'), /Unsupported/);
});
