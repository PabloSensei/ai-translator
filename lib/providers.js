const { GoogleGenAI, ApiError: GeminiApiError } = require('@google/genai');
const Anthropic = require('@anthropic-ai/sdk');

const GITHUB_REPO = 'PabloSensei/ai-translator';

// Without a ceiling a stalled connection leaves the UI on "Translating..." forever.
// Generous, because a streamed translation of a long text legitimately takes a while.
const REQUEST_TIMEOUT_MS = 300000;
const MODEL_LIST_TIMEOUT_MS = 20000;

// Curated fallback lists, used when the provider model list cannot be fetched.
// "Refresh" in the settings replaces these with whatever the API actually offers.
const DEFAULT_GEMINI_MODELS = [
  { id: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash' },
  { id: 'gemini-3.7-flash', name: 'Gemini 3.7 Flash' },
  { id: 'gemini-3.6-flash', name: 'Gemini 3.6 Flash' },
  { id: 'gemini-3.5-flash', name: 'Gemini 3.5 Flash' },
  { id: 'gemini-3.5-flash-lite', name: 'Gemini 3.5 Flash Lite' },
  { id: 'gemini-3.1-pro-preview', name: 'Gemini 3.1 Pro Preview' },
  { id: 'gemini-3.1-flash-lite', name: 'Gemini 3.1 Flash Lite' },
  { id: 'gemini-3-flash-preview', name: 'Gemini 3 Flash Preview' },
  { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro' },
  { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash' },
  { id: 'gemini-2.5-flash-lite', name: 'Gemini 2.5 Flash Lite' }
];

const DEFAULT_ANTHROPIC_MODEL = 'claude-opus-5-5';

const DEFAULT_ANTHROPIC_MODELS = [
  { id: 'claude-opus-5-5', name: 'Claude Opus 5.5' },
  { id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5' },
  { id: 'claude-haiku-5-5', name: 'Claude Haiku 5.5' },
  { id: 'claude-fable-5-1', name: 'Claude Fable 5.1' }
];

// Models that accept server-side refusal fallbacks. When a safety classifier
// declines a request, the API re-runs it on Anthropic's recommended model for
// that refusal category instead of returning an empty answer. Haiku has no
// server-side fallback, and older models do not know the parameter.
const ANTHROPIC_FALLBACK_MODELS = new Set([
  'claude-fable-5-1',
  'claude-opus-5-5',
  'claude-opus-5',
  'claude-sonnet-5-5'
]);
const ANTHROPIC_FALLBACK_BETA = 'server-side-fallback-2026-07-01';

// Output cap per request. Responses are streamed, so a large cap does not
// risk an HTTP timeout; it leaves room for adaptive thinking plus the
// translation of a long text.
const ANTHROPIC_MAX_TOKENS = 64000;

// This app only ever asks a model for text. Anything that generates images,
// audio, video or music, plus embedding/retrieval-only models, is filtered out
// of the picker even when the API reports it as supporting generateContent.
const NON_TEXT_MODEL_PATTERN = /embedding|image|imagen|audio|-tts|\btts\b|veo|lyria|live|aqa|learnlm/i;

// --- Gemini ---
let cachedGenAI = null;
let cachedGeminiKey = null;

function getGeminiClient(apiKey) {
  if (apiKey !== cachedGeminiKey || !cachedGenAI) {
    cachedGenAI = new GoogleGenAI({ apiKey });
    cachedGeminiKey = apiKey;
  }
  return cachedGenAI;
}

// Finish reasons that mean the answer was withheld or cut, not completed.
const GEMINI_BLOCKED_REASONS = new Set(['SAFETY', 'PROHIBITED_CONTENT', 'BLOCKLIST', 'SPII', 'RECITATION', 'IMAGE_SAFETY']);

// The SDK puts the raw JSON error body into the message; dig out the
// human-readable part so the toast does not show a JSON dump.
function describeGeminiError(err) {
  if (!(err instanceof GeminiApiError)) return err;
  let detail = '';
  const json = String(err.message).match(/\{[\s\S]*\}$/);
  if (json) {
    try {
      detail = JSON.parse(json[0])?.error?.message || '';
    } catch (e) { /* not JSON after all */ }
  }
  if (err.status === 400 && /api key/i.test(detail)) {
    return new Error('Google rejected the Gemini API key. Check it in the settings.');
  }
  if (err.status === 403) {
    return new Error('This Gemini API key has no access to the selected model.');
  }
  if (err.status === 404) {
    return new Error('Gemini model not found. Pick another model in the settings.');
  }
  if (err.status === 429) {
    return new Error('Gemini rate limit or quota reached. Wait a moment and try again.');
  }
  return new Error(`Gemini error ${err.status}: ${(detail || String(err.message)).slice(0, 300)}`);
}

/**
 * Every generate function shares one shape:
 *   generate({ system, user, image }, apiKey, model, { signal, onDelta }) -> Promise<string>
 * `image`, when present, is { mediaType, data } with base64 data; it is sent
 * ahead of the user message.
 * `onDelta(text)` receives each streamed chunk as it arrives; the resolved
 * value is the complete answer, which the caller treats as authoritative.
 * Aborting `signal` stops the request and rejects the promise.
 */
async function generateWithGemini({ system, user, image }, apiKey, modelName, { signal, onDelta } = {}) {
  if (!apiKey) {
    throw new Error('Gemini API key is not set. Please enter it in the settings.');
  }

  // A deadline for the whole stream, not just for the response headers.
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  let text = '';
  let finishReason;
  let blockReason;
  try {
    const stream = await getGeminiClient(apiKey).models.generateContentStream({
      model: modelName,
      contents: image
        ? [{ role: 'user', parts: [{ inlineData: { mimeType: image.mediaType, data: image.data } }, { text: user }] }]
        : user,
      config: {
        systemInstruction: system,
        abortSignal: signal ? AbortSignal.any([signal, timeout]) : timeout
      }
    });
    for await (const chunk of stream) {
      blockReason = chunk.promptFeedback?.blockReason || blockReason;
      finishReason = chunk.candidates?.[0]?.finishReason || finishReason;
      const delta = chunk.text;
      if (delta) {
        text += delta;
        if (onDelta) onDelta(delta);
      }
    }
  } catch (err) {
    throw describeGeminiError(err);
  }

  if (blockReason || GEMINI_BLOCKED_REASONS.has(finishReason)) {
    throw new Error(`Gemini declined to translate this text (${blockReason || finishReason}).`);
  }
  if (finishReason === 'MAX_TOKENS') {
    throw new Error('The text is too long for a single request — Gemini\'s answer was cut off. Try a shorter fragment.');
  }
  if (!text.trim()) {
    throw new Error('Gemini returned an empty response.');
  }
  return text;
}

async function fetchGeminiModels(apiKey) {
  if (!apiKey) throw new Error('Enter and save a Gemini API key first.');
  // Key in a header rather than the query string, so it does not end up in
  // proxy or request logs.
  const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', {
    headers: { 'x-goog-api-key': apiKey },
    signal: AbortSignal.timeout(MODEL_LIST_TIMEOUT_MS)
  });
  if (!res.ok) {
    throw new Error(`Google API error ${res.status}`);
  }
  const data = await res.json();
  const models = (data.models || [])
    .filter(m => (m.supportedGenerationMethods || []).includes('generateContent'))
    .map(m => ({
      id: String(m.name || '').replace(/^models\//, ''),
      name: m.displayName || String(m.name || '').replace(/^models\//, '')
    }))
    // Image generators such as gemini-*-flash-image report generateContent too,
    // so they have to be excluded by name as well.
    .filter(m => m.id && !NON_TEXT_MODEL_PATTERN.test(m.id) && !NON_TEXT_MODEL_PATTERN.test(m.name));

  if (!models.length) throw new Error('No usable models returned by the API.');
  return models;
}

// --- OpenRouter ---
/**
 * Incremental parser for a text/event-stream body. Feed it decoded chunks in
 * any split; it calls onData with the payload of every complete `data:` line
 * and ignores comments (": keep-alive") and other fields.
 */
function createSseParser(onData) {
  let buffer = '';
  return {
    push(chunk) {
      buffer += chunk;
      let newline;
      while ((newline = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newline).replace(/\r$/, '');
        buffer = buffer.slice(newline + 1);
        if (line.startsWith('data:')) onData(line.slice(5).trimStart());
      }
    }
  };
}

/**
 * Applies one OpenRouter streaming payload. Returns the text delta, '' for
 * payloads that carry none, or null for the terminating "[DONE]". Errors that
 * arrive mid-stream (after HTTP 200) are thrown.
 */
function parseOpenRouterChunk(payload) {
  if (payload === '[DONE]') return null;
  let data;
  try {
    data = JSON.parse(payload);
  } catch (e) {
    return '';
  }
  if (data && data.error) {
    throw new Error(`OpenRouter error: ${String(data.error.message || 'unknown error').slice(0, 300)}`);
  }
  const delta = data?.choices?.[0]?.delta?.content;
  return typeof delta === 'string' ? delta : '';
}

async function generateWithOpenRouter({ system, user, image }, apiKey, modelName, { signal, onDelta } = {}) {
  if (!apiKey) {
    throw new Error('OpenRouter API key is not set. Please enter it in the settings.');
  }
  if (!modelName) {
    throw new Error('No OpenRouter model selected. Pick one in the settings.');
  }

  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': `https://github.com/${GITHUB_REPO}`,
      'X-Title': 'AI Translator'
    },
    body: JSON.stringify({
      model: modelName,
      stream: true,
      messages: [
        { role: 'system', content: system },
        {
          role: 'user',
          content: image
            ? [{ type: 'image_url', image_url: { url: `data:${image.mediaType};base64,${image.data}` } }, { type: 'text', text: user }]
            : user
        }
      ]
    }),
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    let detail = body;
    try {
      detail = JSON.parse(body)?.error?.message || body;
    } catch (e) { /* keep the raw body */ }
    // Text-only models are routed nowhere when the request carries an image.
    if (image && /image/i.test(String(detail))) {
      throw new Error('This OpenRouter model cannot read images. Pick a vision model, for example a Claude or Gemini one.');
    }
    throw new Error(`OpenRouter error ${res.status}: ${String(detail).slice(0, 300)}`);
  }

  let text = '';
  let done = false;
  const parser = createSseParser((payload) => {
    if (done) return;
    const delta = parseOpenRouterChunk(payload);
    if (delta === null) {
      done = true;
    } else if (delta) {
      text += delta;
      if (onDelta) onDelta(delta);
    }
  });

  const decoder = new TextDecoder();
  for await (const chunk of res.body) {
    parser.push(decoder.decode(chunk, { stream: true }));
    if (done) break;
  }
  parser.push(decoder.decode() + '\n');

  if (!text.trim()) {
    throw new Error('OpenRouter returned an empty response.');
  }
  return text;
}

// OpenRouter describes each model's modalities. Keep the ones that answer with
// text and drop anything that emits images (gemini-*-image, gpt-*-image, and the
// auto-routers, which advertise image output because they may route to one).
function openRouterReturnsText(model) {
  const arch = model.architecture || {};

  if (Array.isArray(arch.output_modalities) && arch.output_modalities.length) {
    return arch.output_modalities.includes('text') && !arch.output_modalities.includes('image');
  }

  // Older shape: "text+image->text"
  if (typeof arch.modality === 'string' && arch.modality.includes('->')) {
    const outputs = arch.modality.split('->')[1].split('+');
    return outputs.includes('text') && !outputs.includes('image');
  }

  // Unknown shape — keep it rather than hiding a usable model.
  return true;
}

async function fetchOpenRouterModels(apiKey) {
  const headers = apiKey ? { 'Authorization': `Bearer ${apiKey}` } : {};
  const res = await fetch('https://openrouter.ai/api/v1/models', {
    headers,
    signal: AbortSignal.timeout(MODEL_LIST_TIMEOUT_MS)
  });
  if (!res.ok) {
    throw new Error(`OpenRouter error ${res.status}`);
  }
  const data = await res.json();
  const models = (data.data || [])
    .filter(openRouterReturnsText)
    .map(m => ({ id: m.id, name: m.name || m.id }))
    .filter(m => m.id);

  if (!models.length) throw new Error('No models returned by OpenRouter.');
  models.sort((a, b) => a.name.localeCompare(b.name));
  return models;
}

// --- Anthropic (Claude) ---
let cachedAnthropic = null;
let cachedAnthropicKey = null;

function getAnthropicClient(apiKey) {
  if (apiKey !== cachedAnthropicKey || !cachedAnthropic) {
    // The SDK retries 408/409/429/5xx and connection errors twice by default.
    cachedAnthropic = new Anthropic({ apiKey, timeout: REQUEST_TIMEOUT_MS });
    cachedAnthropicKey = apiKey;
  }
  return cachedAnthropic;
}

// Turns SDK errors into something a user can act on, most specific first.
function describeAnthropicError(err) {
  // A cancelled request is not a failure to explain; let it through as is.
  if (err instanceof Anthropic.APIUserAbortError) return err;
  if (err instanceof Anthropic.AuthenticationError) {
    return new Error('Anthropic rejected the API key. Check it in the settings.');
  }
  if (err instanceof Anthropic.PermissionDeniedError) {
    return new Error('This Anthropic API key has no access to the selected model.');
  }
  if (err instanceof Anthropic.NotFoundError) {
    return new Error('Claude model not found. Pick another model in the settings.');
  }
  if (err instanceof Anthropic.RateLimitError) {
    return new Error('Anthropic rate limit reached. Wait a moment and try again.');
  }
  if (err instanceof Anthropic.APIConnectionTimeoutError) {
    return new Error('The request to Anthropic timed out.');
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return new Error('Could not reach the Anthropic API. Check your internet connection.');
  }
  if (err instanceof Anthropic.APIError) {
    return new Error(`Anthropic error ${err.status ?? ''}: ${String(err.message).slice(0, 300)}`.trim());
  }
  return err;
}

function extractClaudeText(response) {
  // Branch on stop_reason before reading content: a declined request comes
  // back as HTTP 200 with no usable text.
  if (response.stop_reason === 'refusal') {
    const category = response.stop_details?.category;
    throw new Error(`Claude declined to process this text${category ? ` (${category})` : ''}.`);
  }
  if (response.stop_reason === 'max_tokens') {
    throw new Error('The text is too long for a single request — Claude\'s answer was cut off. Try a shorter fragment.');
  }

  // With adaptive thinking the content can also carry thinking blocks;
  // only the text blocks are the answer.
  const text = (response.content || [])
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('');

  if (!text.trim()) throw new Error('Claude returned an empty response.');
  return text;
}

async function generateWithAnthropic({ system, user, image }, apiKey, modelName, { signal, onDelta } = {}) {
  if (!apiKey) {
    throw new Error('Anthropic API key is not set. Please enter it in the settings.');
  }
  const model = modelName || DEFAULT_ANTHROPIC_MODEL;
  const client = getAnthropicClient(apiKey);

  const params = {
    model,
    max_tokens: ANTHROPIC_MAX_TOKENS,
    system,
    messages: [{
      role: 'user',
      content: image
        ? [{ type: 'image', source: { type: 'base64', media_type: image.mediaType, data: image.data } }, { type: 'text', text: user }]
        : user
    }]
  };

  try {
    // With server-side fallbacks a mid-stream decline keeps the streamed
    // partial and the fallback model continues from it on the same stream,
    // so the text deltas still read as one answer.
    const stream = ANTHROPIC_FALLBACK_MODELS.has(model)
      ? client.beta.messages.stream({
        ...params,
        betas: [ANTHROPIC_FALLBACK_BETA],
        fallbacks: 'default'
      }, { signal })
      : client.messages.stream(params, { signal });

    if (onDelta) stream.on('text', (delta) => onDelta(delta));

    // finalMessage() settles on completion, error and abort alike.
    return extractClaudeText(await stream.finalMessage());
  } catch (err) {
    throw describeAnthropicError(err);
  }
}

async function fetchAnthropicModels(apiKey) {
  if (!apiKey) throw new Error('Enter and save an Anthropic API key first.');
  const client = getAnthropicClient(apiKey);
  const models = [];
  try {
    // The SDK auto-paginates when iterated.
    for await (const model of client.models.list({ limit: 100 }, { timeout: MODEL_LIST_TIMEOUT_MS })) {
      models.push({ id: model.id, name: model.display_name || model.id });
    }
  } catch (err) {
    throw describeAnthropicError(err);
  }
  if (!models.length) throw new Error('No models returned by Anthropic.');
  return models;
}

const PROVIDERS = {
  gemini: { generate: generateWithGemini, listModels: fetchGeminiModels, defaultModels: DEFAULT_GEMINI_MODELS },
  openrouter: { generate: generateWithOpenRouter, listModels: fetchOpenRouterModels, defaultModels: [] },
  anthropic: { generate: generateWithAnthropic, listModels: fetchAnthropicModels, defaultModels: DEFAULT_ANTHROPIC_MODELS }
};

function getProvider(name) {
  return Object.prototype.hasOwnProperty.call(PROVIDERS, name) ? PROVIDERS[name] : PROVIDERS.gemini;
}

module.exports = {
  GITHUB_REPO,
  DEFAULT_GEMINI_MODELS,
  DEFAULT_ANTHROPIC_MODEL,
  DEFAULT_ANTHROPIC_MODELS,
  ANTHROPIC_FALLBACK_MODELS,
  NON_TEXT_MODEL_PATTERN,
  openRouterReturnsText,
  extractClaudeText,
  describeAnthropicError,
  describeGeminiError,
  createSseParser,
  parseOpenRouterChunk,
  getProvider
};
