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
