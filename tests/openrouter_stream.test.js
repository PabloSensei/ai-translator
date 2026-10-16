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

const { getProvider } = require('../lib/providers');
const realFetch = globalThis.fetch;
test.afterEach(() => { globalThis.fetch = realFetch; });

test('OpenRouter sends an attached image as a data URL part', async () => {
  let body;
  globalThis.fetch = async (url, init) => {
    body = JSON.parse(init.body);
    return new Response('data: {"choices":[{"delta":{"content":"Hallo"}}]}\n\ndata: [DONE]\n\n', { status: 200 });
  };
  const image = { mediaType: 'image/png', data: 'iVBORw0KGgo=' };
  const text = await getProvider('openrouter').generate({ system: 's', user: 'Translate the text in this image.', image }, 'sk-or-test', 'anthropic/claude-opus-5.5');
  assert.strictEqual(text, 'Hallo');
  assert.deepStrictEqual(body.messages[1].content, [
    { type: 'image_url', image_url: { url: 'data:image/png;base64,iVBORw0KGgo=' } },
    { type: 'text', text: 'Translate the text in this image.' }
  ]);
});

test('OpenRouter explains when the model cannot read images', async () => {
  globalThis.fetch = async () => new Response(
    JSON.stringify({ error: { code: 404, message: 'No endpoints found that support image input' } }),
    { status: 404 }
  );
  const image = { mediaType: 'image/png', data: 'iVBORw0KGgo=' };
  await assert.rejects(
    getProvider('openrouter').generate({ system: 's', user: 'u', image }, 'sk-or-test', 'meta-llama/llama-3.3-70b-instruct'),
    /cannot read images/
  );
});
