// Drives the real Gemini provider (and the official SDK) with a stubbed
// global fetch that answers like the streaming generateContent endpoint.
const test = require('node:test');
const assert = require('node:assert');
const { getProvider } = require('../lib/providers');

const realFetch = globalThis.fetch;
let lastCall = null;

function sseResponse(chunks) {
  const body = chunks
    .map(text => `data: ${JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ text }] }, index: 0 }] })}\r\n\r\n`)
    .join('');
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

test.afterEach(() => { globalThis.fetch = realFetch; });

const prompt = { system: 'Translate to German.', user: '<text>\nhello world\n</text>' };

test('streams pieces and returns the full text', async () => {
  globalThis.fetch = async (url, init) => {
    lastCall = { url: String(url), init };
    return sseResponse(['Hallo', ' Welt']);
  };

  const deltas = [];
  const text = await getProvider('gemini').generate(prompt, 'AIza-test', 'gemini-2.5-flash', { onDelta: d => deltas.push(d) });

  assert.strictEqual(text, 'Hallo Welt');
  assert.deepStrictEqual(deltas, ['Hallo', ' Welt']);
  assert.match(lastCall.url, /models\/gemini-2\.5-flash:streamGenerateContent/);
  const body = JSON.parse(lastCall.init.body);
  assert.strictEqual(body.systemInstruction.parts[0].text, prompt.system);
  assert.strictEqual(body.contents[0].parts[0].text, prompt.user);
});

test('an empty answer is an error', async () => {
  globalThis.fetch = async () => sseResponse(['']);
  await assert.rejects(getProvider('gemini').generate(prompt, 'AIza-test', 'gemini-2.5-flash'), /empty/);
});

test('a missing key fails before any request', async () => {
  let called = false;
  globalThis.fetch = async () => { called = true; return sseResponse(['x']); };
  await assert.rejects(getProvider('gemini').generate(prompt, '', 'gemini-2.5-flash'), /API key is not set/);
  assert.strictEqual(called, false);
});

test('a blocked prompt is reported as a refusal', async () => {
  globalThis.fetch = async () => new Response(
    `data: ${JSON.stringify({ promptFeedback: { blockReason: 'PROHIBITED_CONTENT' } })}\r\n\r\n`,
    { status: 200, headers: { 'content-type': 'text/event-stream' } }
  );
  await assert.rejects(getProvider('gemini').generate(prompt, 'AIza-test', 'gemini-2.5-flash'), /declined.*PROHIBITED_CONTENT/);
});

test('an answer cut off by the token limit is an error, not a partial result', async () => {
  globalThis.fetch = async () => new Response(
    `data: ${JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ text: 'Hallo' }] }, finishReason: 'MAX_TOKENS', index: 0 }] })}\r\n\r\n`,
    { status: 200, headers: { 'content-type': 'text/event-stream' } }
  );
  await assert.rejects(getProvider('gemini').generate(prompt, 'AIza-test', 'gemini-2.5-flash'), /cut off/);
});

test('API errors are turned into readable messages', async () => {
  globalThis.fetch = async () => new Response(
    JSON.stringify({ error: { code: 400, message: 'API key not valid. Please pass a valid API key.', status: 'INVALID_ARGUMENT' } }),
    { status: 400, headers: { 'content-type': 'application/json' } }
  );
  await assert.rejects(getProvider('gemini').generate(prompt, 'AIza-bad', 'gemini-2.5-flash'), /rejected the Gemini API key/);

  globalThis.fetch = async () => new Response(
    JSON.stringify({ error: { code: 500, message: 'Internal error encountered.', status: 'INTERNAL' } }),
    { status: 500, headers: { 'content-type': 'application/json' } }
  );
  await assert.rejects(getProvider('gemini').generate(prompt, 'AIza-test', 'gemini-2.5-flash'), /^Error: Gemini error 500: Internal error encountered\.$/);
});

test('aborting the signal stops the request', async () => {
  globalThis.fetch = (url, init) => new Promise((resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(init.signal.reason));
  });
  const controller = new AbortController();
  const pending = getProvider('gemini').generate(prompt, 'AIza-test', 'gemini-2.5-flash', { signal: controller.signal });
  setTimeout(() => controller.abort(), 10);
  await assert.rejects(pending, (err) => err.name === 'AbortError');
});

test('an attached image is sent as inline data before the instruction', async () => {
  globalThis.fetch = async (url, init) => {
    lastCall = { url: String(url), init };
    return sseResponse(['Hallo']);
  };
  const image = { mediaType: 'image/jpeg', data: '/9j/4AAQ' };
  await getProvider('gemini').generate({ system: 's', user: 'Translate the text in this image.', image }, 'AIza-test', 'gemini-2.5-flash');
  const body = JSON.parse(lastCall.init.body);
  assert.deepStrictEqual(body.contents[0].parts, [
    { inlineData: { mimeType: 'image/jpeg', data: '/9j/4AAQ' } },
    { text: 'Translate the text in this image.' }
  ]);
});
