// Exercises the real Anthropic provider through the official SDK against a
// local stand-in for the API, so the request shape is checked end to end
// without network access or a real key.
const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');

let lastRequest = null;
let nextResponse = null;

const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', chunk => { body += chunk; });
  req.on('end', () => {
    lastRequest = { method: req.method, url: req.url, headers: req.headers, body: body ? JSON.parse(body) : null };
    const { status = 200, json } = nextResponse;
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(json));
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

test('sends system + user message and opts into server-side fallbacks', async () => {
  nextResponse = message([{ type: 'text', text: 'Hallo' }]);
  const text = await provider.generate(prompt, 'sk-ant-test', 'claude-opus-5-5');

  assert.strictEqual(text, 'Hallo');
  assert.strictEqual(lastRequest.method, 'POST');
  assert.match(lastRequest.url, /^\/v1\/messages/);
  assert.strictEqual(lastRequest.headers['x-api-key'], 'sk-ant-test');
  assert.match(lastRequest.headers['anthropic-beta'], /server-side-fallback-2026-07-01/);
  assert.strictEqual(lastRequest.body.model, 'claude-opus-5-5');
  assert.strictEqual(lastRequest.body.system, prompt.system);
  assert.deepStrictEqual(lastRequest.body.messages, [{ role: 'user', content: prompt.user }]);
  assert.strictEqual(lastRequest.body.fallbacks, 'default');
  assert.ok(lastRequest.body.max_tokens > 0);
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
