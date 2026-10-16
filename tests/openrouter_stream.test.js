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

test('parseOpenRouterChunk extracts text deltas and the finish reason', () => {
  assert.deepStrictEqual(parseOpenRouterChunk('{"choices":[{"delta":{"content":"Hal"}}]}'), { text: 'Hal', finishReason: null });
  assert.deepStrictEqual(parseOpenRouterChunk('{"choices":[{"delta":{"role":"assistant"}}]}'), { text: '', finishReason: null });
  assert.deepStrictEqual(parseOpenRouterChunk('{"choices":[]}'), { text: '', finishReason: null });
  assert.deepStrictEqual(parseOpenRouterChunk('not json'), { text: '', finishReason: null });
  assert.deepStrictEqual(parseOpenRouterChunk('{"choices":[{"delta":{"content":""},"finish_reason":"length"}]}'), { text: '', finishReason: 'length' });
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

const sse = (...events) => new Response(events.map(e => `data: ${typeof e === 'string' ? e : JSON.stringify(e)}\n\n`).join(''), { status: 200 });
const delta = (content, finish_reason = null) => ({ choices: [{ delta: { content }, finish_reason }] });

test('OpenRouter: a normal stream ends with stop and [DONE]', async () => {
  globalThis.fetch = async () => sse(delta('Hal'), delta('lo', 'stop'), '[DONE]');
  const deltas = [];
  assert.strictEqual(await getProvider('openrouter').generate({ system: 's', user: 'u' }, 'k', 'm', { onDelta: d => deltas.push(d) }), 'Hallo');
  assert.deepStrictEqual(deltas, ['Hal', 'lo']);
});

test('OpenRouter: an answer cut off by the token limit is an error', async () => {
  globalThis.fetch = async () => sse(delta('Hal'), delta('', 'length'), '[DONE]');
  await assert.rejects(getProvider('openrouter').generate({ system: 's', user: 'u' }, 'k', 'm'), /cut off/);
});

test('OpenRouter: a filtered answer is an error', async () => {
  globalThis.fetch = async () => sse(delta('Hal'), delta('', 'content_filter'), '[DONE]');
  await assert.rejects(getProvider('openrouter').generate({ system: 's', user: 'u' }, 'k', 'm'), /declined/);
});

test('OpenRouter: a stream that just stops is not taken as complete', async () => {
  globalThis.fetch = async () => sse(delta('Hal'));
  await assert.rejects(getProvider('openrouter').generate({ system: 's', user: 'u' }, 'k', 'm'), /closed before the answer was complete/);
});

test('OpenRouter: the last line may arrive without a trailing newline', async () => {
  globalThis.fetch = async () => new Response(`data: ${JSON.stringify(delta('Hallo', 'stop'))}`, { status: 200 });
  assert.strictEqual(await getProvider('openrouter').generate({ system: 's', user: 'u' }, 'k', 'm'), 'Hallo');
});

test('OpenRouter: Stop during the stream aborts it', async () => {
  const controller = new AbortController();
  globalThis.fetch = async (url, init) => new Response(new ReadableStream({
    start(c) {
      c.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(delta('Hal'))}\n\n`));
      init.signal.addEventListener('abort', () => c.error(init.signal.reason));
    }
  }), { status: 200 });
  const pending = getProvider('openrouter').generate({ system: 's', user: 'u' }, 'k', 'm', { signal: controller.signal, onDelta: () => controller.abort() });
  await assert.rejects(pending, err => err.name === 'AbortError');
});

test('withDeadline tells a timeout apart from Stop', async () => {
  const { withDeadline } = require('../lib/providers');
  const timed = withDeadline(undefined, 5);
  await new Promise(r => setTimeout(r, 20));
  assert.ok(timed.signal.aborted);
  assert.strictEqual(timed.timedOut(), true);

  const controller = new AbortController();
  const stopped = withDeadline(controller.signal, 60000);
  controller.abort();
  assert.ok(stopped.signal.aborted);
  assert.strictEqual(stopped.timedOut(), false);
});
