const test = require('node:test');
const assert = require('node:assert');
const { escapeHtml, keyEventToAccelerator } = require('../utils.js');

test('escapeHtml', () => {
  assert.strictEqual(escapeHtml('hello world'), 'hello world');
  assert.strictEqual(escapeHtml('<div>'), '&lt;div&gt;');
  assert.strictEqual(escapeHtml('script < > & " \''), 'script &lt; &gt; &amp; &quot; &#039;');
  for (const v of [null, undefined, 123]) assert.strictEqual(escapeHtml(v), '');
});

const ev = (code, mods = {}) => ({ code, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...mods });

test('keyEventToAccelerator: letters, digits and F-keys', () => {
  assert.strictEqual(keyEventToAccelerator(ev('KeyT', { ctrlKey: true, shiftKey: true })).accelerator, 'Ctrl+Shift+T');
  // With Shift held event.key would be "!" — event.code keeps the real key.
  assert.strictEqual(keyEventToAccelerator(ev('Digit1', { ctrlKey: true, shiftKey: true })).accelerator, 'Ctrl+Shift+1');
  assert.strictEqual(keyEventToAccelerator(ev('F5', { altKey: true })).accelerator, 'Alt+F5');
  assert.strictEqual(keyEventToAccelerator(ev('KeyK', { metaKey: true })).accelerator, 'Super+K');
});

test('keyEventToAccelerator: names Electron understands', () => {
  assert.strictEqual(keyEventToAccelerator(ev('ArrowUp', { ctrlKey: true })).accelerator, 'Ctrl+Up');
  assert.strictEqual(keyEventToAccelerator(ev('Space', { ctrlKey: true, altKey: true })).accelerator, 'Ctrl+Alt+Space');
  assert.strictEqual(keyEventToAccelerator(ev('Numpad3', { ctrlKey: true })).accelerator, 'Ctrl+num3');
  assert.strictEqual(keyEventToAccelerator(ev('Slash', { ctrlKey: true })).accelerator, 'Ctrl+/');
});

test('keyEventToAccelerator: incomplete combinations', () => {
  // Modifier on its own.
  const r = keyEventToAccelerator(ev('ControlLeft', { ctrlKey: true }));
  assert.deepStrictEqual(r.modifiers, ['Ctrl']);
  assert.strictEqual(r.accelerator, null);
  // A key without a modifier is not accepted as a global shortcut.
  assert.strictEqual(keyEventToAccelerator(ev('KeyA')).accelerator, null);
  // Unknown physical keys.
  assert.strictEqual(keyEventToAccelerator(ev('IntlRo', { ctrlKey: true })).accelerator, null);
});
