// Exercises the real Anthropic provider through the official SDK against a
// local stand-in for the API, so the request shape and the streaming path are
// checked end to end without network access or a real key.
const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');

let lastRequest = null;
let nextResponse = null;

// Turns a finished Message into the SSE events the Messages API streams.
function toSseEvents(message) {
  const events = [['message_start', {
    type: 'message_start',
    message: { ...message, content: [], stop_reason: null, stop_details: null, usage: { input_tokens: 10, output_tokens: 1 } }
  }]];
  message.content.forEach((block, index) => {
    if (block.type === 'text') {
      events.push(['content_block_start', { type: 'content_block_start', index, content_block: { type: 'text', text: '' } }]);
      // Split each text block into several deltas, like a real stream.
      for (const piece of block.text.match(/.{1,2}/gs) || []) {
        events.push(['content_block_delta', { type: 'content_block_delta', index, delta: { type: 'text_delta', text: piece } }]);
      }
    } else {
      events.push(['content_block_start', { type: 'content_block_start', index, content_block: block }]);
    }
    events.push(['content_block_stop', { type: 'content_block_stop', index }]);
  });
  events.push(['message_delta', {
    type: 'message_delta',
    delta: { stop_reason: message.stop_reason, stop_sequence: null, stop_details: message.stop_details },
    usage: { output_tokens: 5 }
  }]);
  events.push(['message_stop', { type: 'message_stop' }]);
  return events;
}

const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', chunk => { body += chunk; });
  req.on('end', async () => {
    lastRequest = { method: req.method, url: req.url, headers: req.headers, body: body ? JSON.parse(body) : null };
    const { status = 200, json, delayMs = 0 } = nextResponse;

    if (status !== 200 || !lastRequest.body || !lastRequest.body.stream) {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(json));
      return;
    }

    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
    for (const [event, data] of toSseEvents(json)) {
      if (res.destroyed) return;
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      if (delayMs) await new Promise(resolve => setTimeout(resolve, delayMs));
    }
    res.end();
  });
});

function message(content, extra = {}) {
  return {
    json: {
      id: 'msg_test', type: 'message', role: 'assistant', model: 'claude-opus-5-5',
      content, stop_reason: 'end_turn', stop_details: null,
      usage: { input_tokens: 10, output_tokens: 5 },
      ...extra
    }
  };
}

let provider;
let extractClaudeText;

test.before(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  // Read by the SDK when the client is constructed.
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${server.address().port}`;
  const providers = require('../lib/providers');
  provider = providers.getProvider('anthropic');
  extractClaudeText = providers.extractClaudeText;
});

test.after(() => server.close());

const prompt = { system: 'Translate to German.', user: '<text>\nhello\n</text>' };

test('streams a system + user request and opts into server-side fallbacks', async () => {
  nextResponse = message([{ type: 'text', text: 'Hallo Welt' }]);
  const deltas = [];
  const text = await provider.generate(prompt, 'sk-ant-test', 'claude-opus-5-5', { onDelta: d => deltas.push(d) });

  assert.strictEqual(text, 'Hallo Welt');
  assert.ok(deltas.length > 1, 'expected several streamed pieces');
  assert.strictEqual(deltas.join(''), 'Hallo Welt');

  assert.strictEqual(lastRequest.method, 'POST');
  assert.match(lastRequest.url, /^\/v1\/messages/);
  assert.strictEqual(lastRequest.headers['x-api-key'], 'sk-ant-test');
  assert.match(lastRequest.headers['anthropic-beta'], /server-side-fallback-2026-07-01/);
  assert.strictEqual(lastRequest.body.stream, true);
  assert.strictEqual(lastRequest.body.model, 'claude-opus-5-5');
  assert.strictEqual(lastRequest.body.system, prompt.system);
  assert.deepStrictEqual(lastRequest.body.messages, [{ role: 'user', content: prompt.user }]);
  assert.strictEqual(lastRequest.body.fallbacks, 'default');
  assert.ok(lastRequest.body.max_tokens > 0);
});

test('works without a delta callback', async () => {
  nextResponse = message([{ type: 'text', text: 'Hallo' }]);
  assert.strictEqual(await provider.generate(prompt, 'sk-ant-test', 'claude-opus-5-5'), 'Hallo');
});

test('models without server-side fallback get a plain request', async () => {
  nextResponse = message([{ type: 'text', text: 'Hallo' }]);
  await provider.generate(prompt, 'sk-ant-test', 'claude-haiku-5-5');
  assert.strictEqual(lastRequest.body.fallbacks, undefined);
  assert.ok(!String(lastRequest.headers['anthropic-beta'] || '').includes('server-side-fallback'));
});

test('falls back to the default model when none is saved', async () => {
  nextResponse = message([{ type: 'text', text: 'Hallo' }]);
  await provider.generate(prompt, 'sk-ant-test', '');
  assert.strictEqual(lastRequest.body.model, 'claude-opus-5-5');
});

test('thinking blocks are skipped, text blocks joined', async () => {
  nextResponse = message([
    { type: 'thinking', thinking: '', signature: 'sig' },
    { type: 'text', text: 'Hal' },
    { type: 'text', text: 'lo' }
  ]);
  assert.strictEqual(await provider.generate(prompt, 'sk-ant-test', 'claude-opus-5-5'), 'Hallo');
});

test('refusals and truncation become readable errors', async () => {
  nextResponse = message([], { stop_reason: 'refusal', stop_details: { type: 'refusal', category: 'cyber', explanation: null } });
  await assert.rejects(provider.generate(prompt, 'sk-ant-test', 'claude-opus-5-5'), /declined.*cyber/);

  // A mid-stream refusal: the partial was streamed, but the call still fails.
  const deltas = [];
  nextResponse = message([{ type: 'text', text: 'Hal' }], { stop_reason: 'refusal', stop_details: null });
  await assert.rejects(provider.generate(prompt, 'sk-ant-test', 'claude-opus-5-5', { onDelta: d => deltas.push(d) }), /declined/);
  assert.strictEqual(deltas.join(''), 'Hal');

  nextResponse = message([{ type: 'text', text: 'Hal' }], { stop_reason: 'max_tokens' });
  await assert.rejects(provider.generate(prompt, 'sk-ant-test', 'claude-opus-5-5'), /cut off/);

  assert.throws(() => extractClaudeText({ stop_reason: 'end_turn', content: [] }), /empty/);
});

test('HTTP errors map to actionable messages', async () => {
  nextResponse = { status: 401, json: { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } } };
  await assert.rejects(provider.generate(prompt, 'sk-ant-bad', 'claude-opus-5-5'), /rejected the API key/);

  nextResponse = { status: 404, json: { type: 'error', error: { type: 'not_found_error', message: 'model: nope' } } };
  await assert.rejects(provider.generate(prompt, 'sk-ant-test', 'nope'), /model not found/);
});

test('aborting the signal stops the stream', async () => {
  nextResponse = { ...message([{ type: 'text', text: 'a long translation that keeps coming' }]), delayMs: 30 };
  const controller = new AbortController();
  const deltas = [];
  const pending = provider.generate(prompt, 'sk-ant-test', 'claude-opus-5-5', {
    signal: controller.signal,
    onDelta: (d) => {
      deltas.push(d);
      if (deltas.length === 2) controller.abort();
    }
  });
  await assert.rejects(pending);
  assert.ok(controller.signal.aborted);
  assert.ok(deltas.length < 10, `stream kept going after abort (${deltas.length} pieces)`);
});

test('a missing key fails before any request', async () => {
  lastRequest = null;
  await assert.rejects(provider.generate(prompt, '', 'claude-opus-5-5'), /API key is not set/);
  assert.strictEqual(lastRequest, null);
});

test('lists models from the Models API', async () => {
  nextResponse = {
    json: {
      data: [
        { type: 'model', id: 'claude-opus-5-5', display_name: 'Claude Opus 5.5', created_at: '2026-09-01T00:00:00Z' },
        { type: 'model', id: 'claude-haiku-5-5', display_name: 'Claude Haiku 5.5', created_at: '2026-09-01T00:00:00Z' }
      ],
      has_more: false, first_id: 'claude-opus-5-5', last_id: 'claude-haiku-5-5'
    }
  };
  const models = await provider.listModels('sk-ant-test');
  assert.match(lastRequest.url, /^\/v1\/models/);
  assert.deepStrictEqual(models, [
    { id: 'claude-opus-5-5', name: 'Claude Opus 5.5' },
    { id: 'claude-haiku-5-5', name: 'Claude Haiku 5.5' }
  ]);
});

test('an attached image goes first, as a base64 image block', async () => {
  nextResponse = message([{ type: 'text', text: 'Hallo' }]);
  const image = { mediaType: 'image/png', data: 'iVBORw0KGgo=' };
  await provider.generate({ system: 'Translate the text in the image.', user: 'Translate the text in this image.', image }, 'sk-ant-test', 'claude-opus-5-5');
  assert.deepStrictEqual(lastRequest.body.messages, [{
    role: 'user',
    content: [
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBORw0KGgo=' } },
      { type: 'text', text: 'Translate the text in this image.' }
    ]
  }]);
});
