const test = require('node:test');
const assert = require('node:assert');
const { copySelectedText, acceleratorModifiers } = require('../lib/selection');

class FakeItem {
  constructor(data) { this.data = data; this.types = Object.keys(data); }
  async getType(type) { return this.data[type]; }
}

// A clipboard holding `items`; pressing copy in the "app" replaces it with the
// selection, if there is one.
function setup({ items = [], selection = '', unreadable = false } = {}) {
  const state = { items, writes: [], cleared: 0 };
  const textOf = async () => {
    const item = state.items.find(i => i.types.includes('text/plain'));
    return item ? (await item.getType('text/plain')).text() : '';
  };
  const clipboard = {
    readText: textOf,
    read: async () => {
      if (unreadable) throw new Error('format not supported');
      return state.items;
    },
    write: async (data) => { state.writes.push(data); state.items = data; },
    clear: async () => { state.cleared++; state.items = []; }
  };
  const keyboard = {
    presses: 0,
    pressCopy() {
      this.presses++;
      if (selection) state.items = [new FakeItem({ 'text/plain': new Blob([selection]) })];
    }
  };
  return { state, clipboard, keyboard, deps: { clipboard, ClipboardItem: FakeItem, keyboard, sleep: async () => {} } };
}

const textItem = (text) => new FakeItem({ 'text/plain': new Blob([text]), 'text/html': new Blob([`<b>${text}</b>`]) });

test('returns the selection and puts the previous clipboard back', async () => {
  const { deps, state, keyboard } = setup({ items: [textItem('old clipboard')], selection: 'selected words' });
  assert.strictEqual(await copySelectedText(deps), 'selected words');
  assert.strictEqual(keyboard.presses, 1);
  assert.strictEqual(state.writes.length, 1);
  const restored = state.writes[0][0];
  assert.deepStrictEqual(restored.types, ['text/plain', 'text/html']);
  assert.strictEqual(await (await restored.getType('text/plain')).text(), 'old clipboard');
  assert.strictEqual(await (await restored.getType('text/html')).text(), '<b>old clipboard</b>');
});

test('an empty clipboard is emptied again afterwards', async () => {
  const { deps, state } = setup({ items: [], selection: 'selected' });
  assert.strictEqual(await copySelectedText(deps), 'selected');
  assert.strictEqual(state.cleared, 1);
  assert.deepStrictEqual(state.items, []);
});

test('nothing selected: returns "" and leaves the clipboard alone', async () => {
  const { deps, state } = setup({ items: [textItem('copied earlier')], selection: '' });
  assert.strictEqual(await copySelectedText({ ...deps, timeoutMs: 100 }), '');
  assert.strictEqual(state.writes.length, 0);
  assert.strictEqual(state.cleared, 0);
});

test('a clipboard that cannot be read back exactly keeps the selection', async () => {
  const { deps, state } = setup({ items: [textItem('files')], selection: 'selected', unreadable: true });
  assert.strictEqual(await copySelectedText(deps), 'selected');
  assert.strictEqual(state.writes.length, 0, 'no partial restore');
});

test('acceleratorModifiers lists the held modifiers by platform', () => {
  assert.deepStrictEqual(acceleratorModifiers('Ctrl+Shift+Y', 'win32'), ['Ctrl', 'Shift']);
  assert.deepStrictEqual(acceleratorModifiers('Alt+Super+F1', 'win32'), ['Alt', 'Meta']);
  assert.deepStrictEqual(acceleratorModifiers('CommandOrControl+Shift+Y', 'darwin'), ['Meta', 'Shift']);
  assert.deepStrictEqual(acceleratorModifiers('CmdOrCtrl+Y', 'win32'), ['Ctrl']);
  assert.deepStrictEqual(acceleratorModifiers('', 'win32'), []);
  assert.deepStrictEqual(acceleratorModifiers(undefined, 'win32'), []);
});
