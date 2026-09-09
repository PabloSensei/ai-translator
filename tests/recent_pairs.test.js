const assert = require('assert');

// Mock settingsStore
const store = {
  data: { recentPairs: [] },
  get(key) {
    return this.data[key];
  },
  set(key, value) {
    this.data[key] = value;
  }
};

const settingsStore = store;

// Implementation mirrored from main.js
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

console.log('--- Testing updateRecentPairs behavior ---');

// Test 1: A new pair goes to the front
store.data.recentPairs = [{ source: 'en', target: 'ru' }];
updateRecentPairs({ source: 'pl', target: 'de' });
assert.deepStrictEqual(store.get('recentPairs'), [
  { source: 'pl', target: 'de' },
  { source: 'en', target: 'ru' }
]);
console.log('PASSED: New pair moves to front');

// Test 2: Re-using a pair moves it to the front without duplicating it
store.data.recentPairs = [
  { source: 'en', target: 'ru' },
  { source: 'pl', target: 'de' },
  { source: 'fr', target: 'es' }
];
updateRecentPairs({ source: 'pl', target: 'de' });
assert.deepStrictEqual(store.get('recentPairs'), [
  { source: 'pl', target: 'de' },
  { source: 'en', target: 'ru' },
  { source: 'fr', target: 'es' }
]);
console.log('PASSED: Existing pair is moved, not duplicated');

// Test 3: Direction matters — en→ru and ru→en are different pairs
store.data.recentPairs = [{ source: 'en', target: 'ru' }];
updateRecentPairs({ source: 'ru', target: 'en' });
assert.strictEqual(store.get('recentPairs').length, 2);
console.log('PASSED: Reversed pair is tracked separately');

// Test 4: Capped at 6 entries
store.data.recentPairs = [];
for (const code of ['a', 'b', 'c', 'd', 'e', 'f', 'g']) {
  updateRecentPairs({ source: code, target: 'ru' });
}
assert.strictEqual(store.get('recentPairs').length, 6);
assert.deepStrictEqual(store.get('recentPairs')[0], { source: 'g', target: 'ru' });
console.log('PASSED: Capped at 6 entries, newest first');

// Test 5: 'auto' is a valid source, invalid input is ignored
store.data.recentPairs = [];
updateRecentPairs({ source: 'auto', target: 'ru' });
assert.deepStrictEqual(store.get('recentPairs'), [{ source: 'auto', target: 'ru' }]);
updateRecentPairs({ source: '', target: 'ru' });
updateRecentPairs(undefined);
updateRecentPairs({ source: 123, target: 'ru' });
assert.deepStrictEqual(store.get('recentPairs'), [{ source: 'auto', target: 'ru' }]);
console.log('PASSED: Detect-language pairs kept, invalid input ignored');

console.log('--- All Tests Passed ---');
