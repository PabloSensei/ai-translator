const assert = require('assert');
const { updateRecentLanguagesList } = require('../utils');

function runTest(name, initialRecent, source, target, expected) {
  const result = updateRecentLanguagesList(initialRecent, source, target);
  try {
    assert.deepStrictEqual(result, expected);
    console.log(`PASSED: ${name}`);
  } catch (e) {
    console.error(`FAILED: ${name}`);
    console.error(`  Expected: ${JSON.stringify(expected)}`);
    console.error(`  Actual:   ${JSON.stringify(result)}`);
    process.exit(1);
  }
}

console.log('--- Testing updateRecentLanguagesList ---');

runTest(
  'Add new languages to empty list',
  [],
  'en', 'es',
  ['en', 'es']
);

runTest(
  'Move existing languages to front',
  ['en', 'ru', 'de', 'fr'],
  'de', 'fr',
  ['de', 'fr', 'en', 'ru']
);

runTest(
  'Move existing languages to front (swapped)',
  ['en', 'ru', 'de', 'fr'],
  'fr', 'de',
  ['fr', 'de', 'en', 'ru']
);

runTest(
  'Limit to 10 languages',
  ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'],
  'en', 'es',
  ['en', 'es', '1', '2', '3', '4', '5', '6', '7', '8']
);

runTest(
  'Source and target are the same (no duplicates)',
  ['en', 'es', 'fr'],
  'de', 'de',
  ['de', 'en', 'es', 'fr']
);

runTest(
  'Source and target are the same and already present',
  ['en', 'es', 'fr'],
  'es', 'es',
  ['es', 'en', 'fr']
);

console.log('--- All tests passed ---');
