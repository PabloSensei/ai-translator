const test = require('node:test');
const assert = require('node:assert');
const { createSseParser, parseOpenRouterChunk } = require('../lib/providers');

function collect(chunks) {
  const payloads = [];
  const parser = createSseParser(p => payloads.push(p));
  for (const c of chunks) parser.push(c);
  return payloads;
}

test('SSE parser handles lines split across chunks and CRLF', () => {
  assert.deepStrictEqual(
    collect(['data: {"a"', ':1}\r\n\r\ndata: [DO', 'NE]\n\n']),
    ['{"a":1}', '[DONE]']
  );
});

test('SSE parser ignores comments and other fields', () => {
  assert.deepStrictEqual(
    collect([': OPENROUTER PROCESSING\n\nevent: x\nid: 1\ndata: payload\n\n']),
    ['payload']
  );
});

test('SSE parser waits for the line to finish', () => {
  assert.deepStrictEqual(collect(['data: partial']), []);
});

test('parseOpenRouterChunk extracts text deltas', () => {
  assert.strictEqual(parseOpenRouterChunk('{"choices":[{"delta":{"content":"Hal"}}]}'), 'Hal');
  assert.strictEqual(parseOpenRouterChunk('{"choices":[{"delta":{"role":"assistant"}}]}'), '');
  assert.strictEqual(parseOpenRouterChunk('{"choices":[]}'), '');
  assert.strictEqual(parseOpenRouterChunk('not json'), '');
  assert.strictEqual(parseOpenRouterChunk('[DONE]'), null);
});

test('parseOpenRouterChunk surfaces mid-stream errors', () => {
  assert.throws(
    () => parseOpenRouterChunk('{"error":{"code":502,"message":"Provider returned error"}}'),
    /OpenRouter error: Provider returned error/
  );
});
