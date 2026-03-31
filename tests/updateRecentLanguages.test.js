const assert = require('assert');

// Mock settingsStore
let store = {
  data: {
    recentLanguages: ['en', 'ru', 'de', 'fr', 'es', 'it', 'pt', 'uk', 'pl', 'cs']
  },
  get(key) {
    return this.data[key];
  },
  set(key, value) {
    this.data[key] = value;
  }
};

const settingsStore = store;

// Refactored implementation from main.js
function updateRecentLanguages(source, target) {
  const recent = settingsStore.get('recentLanguages') || [];
  const updated = [...new Set([source, target, ...recent])].slice(0, 10);
  settingsStore.set('recentLanguages', updated);
}

// Tests
console.log('--- Testing updateRecentLanguages behavior ---');

// Test 1: Basic move to front
store.data.recentLanguages = ['en', 'ru', 'de'];
updateRecentLanguages('fr', 'es');
assert.deepStrictEqual(store.get('recentLanguages'), ['fr', 'es', 'en', 'ru', 'de']);
console.log('PASSED: Basic move to front');

// Test 2: Move existing to front
store.data.recentLanguages = ['en', 'ru', 'de', 'fr'];
updateRecentLanguages('de', 'ru');
assert.deepStrictEqual(store.get('recentLanguages'), ['de', 'ru', 'en', 'fr']);
console.log('PASSED: Move existing to front');

// Test 3: Max 10 limit
store.data.recentLanguages = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'];
updateRecentLanguages('x', 'y');
assert.strictEqual(store.get('recentLanguages').length, 10);
assert.deepStrictEqual(store.get('recentLanguages'), ['x', 'y', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']);
console.log('PASSED: Max 10 limit');

// Test 4: source === target (Bug fix: no duplicates)
store.data.recentLanguages = ['en', 'ru', 'de'];
updateRecentLanguages('en', 'en');
// Improved implementation:
// [en, en, en, ru, de] -> Set -> [en, ru, de]
assert.deepStrictEqual(store.get('recentLanguages'), ['en', 'ru', 'de']);
console.log('PASSED: Improved behavior without duplicates');

console.log('--- All Tests Passed ---');
