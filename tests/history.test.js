const test = require('node:test');
const assert = require('node:assert');
const { trimHistory, formatHistoryExport } = require('../lib/history');
const { matchesHistoryQuery } = require('../utils');

const entry = (id, extra = {}) => ({
  id,
  sourceText: `source ${id}`,
  targetText: `target ${id}`,
  sourceLang: 'en',
  targetLang: 'de',
  mode: 'translate',
  timestamp: '2026-10-16T10:00:00.000Z',
  ...extra
});

test('trimHistory drops the oldest entries but never favourites', () => {
  const items = [entry(5), entry(4), entry(3, { favorite: true }), entry(2), entry(1, { favorite: true })];
  assert.deepStrictEqual(trimHistory(items, 3).map(i => i.id), [5, 3, 1]);
  // More favourites than the cap: all favourites stay, nothing else does.
  assert.deepStrictEqual(trimHistory(items, 1).map(i => i.id), [3, 1]);
  // Under the cap: untouched.
  assert.strictEqual(trimHistory(items, 10), items);
});

test('matchesHistoryQuery needs every word, in either text, any case', () => {
  const item = { sourceText: 'Good morning, world', targetText: 'Guten Morgen, Welt' };
  assert.ok(matchesHistoryQuery(item, ''));
  assert.ok(matchesHistoryQuery(item, '   '));
  assert.ok(matchesHistoryQuery(item, 'MORNING'));
  assert.ok(matchesHistoryQuery(item, 'good welt'));
  assert.ok(!matchesHistoryQuery(item, 'good night'));
  assert.ok(matchesHistoryQuery({}, ''));
});

test('JSON export carries names, mode and favourites', () => {
  const out = JSON.parse(formatHistoryExport([entry(1, { favorite: true }), entry(2, { mode: 'fix' })], 'json', c => c.toUpperCase()));
  assert.deepStrictEqual(out[0], {
    date: '2026-10-16T10:00:00.000Z', mode: 'translate', source: 'EN', target: 'DE', favorite: true,
    sourceText: 'source 1', targetText: 'target 1'
  });
  assert.strictEqual(out[1].mode, 'fix');
  assert.strictEqual(out[1].target, '');
});

test('CSV export quotes fields and defuses formulas', () => {
  const csv = formatHistoryExport([entry(1, { sourceText: 'He said "hi",\nthen left', targetText: '=HYPERLINK("x")' })], 'csv');
  assert.ok(csv.startsWith('﻿"Date","Mode"'));
  const lines = csv.slice(1).split('\r\n');
  assert.strictEqual(lines.length, 3); // header, one row, trailing newline
  assert.ok(lines[1].includes('"He said ""hi"",\nthen left"'));
  assert.ok(lines[1].includes(`"'=HYPERLINK(""x"")"`));
});

test('Markdown export quotes the original and marks favourites', () => {
  const md = formatHistoryExport([entry(1, { favorite: true, sourceText: 'line one\nline two' })], 'md');
  assert.match(md, /^# AI Translator history/);
  assert.match(md, /## ★ en → de/);
  assert.match(md, /> line one\n> line two/);
  assert.match(md, /target 1/);
});

test('an unknown format is rejected', () => {
  assert.throws(() => formatHistoryExport([], 'xml'), /Unknown export format/);
});

test('image entries export a placeholder instead of an empty original', () => {
  const out = JSON.parse(formatHistoryExport([entry(1, { image: true, sourceText: '' })], 'json'));
  assert.strictEqual(out[0].sourceText, '(image)');
});
