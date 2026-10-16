const { GoogleGenerativeAI } = require('@google/generative-ai');
const Anthropic = require('@anthropic-ai/sdk');

const GITHUB_REPO = 'PabloSensei/ai-translator';

// Without a ceiling a stalled connection leaves the UI on "Translating..." forever.
const REQUEST_TIMEOUT_MS = 120000;
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

// Non-streaming requests must stay under the SDK's HTTP timeout; a translation
// never comes close to this, and adaptive thinking still has room.
const ANTHROPIC_MAX_TOKENS = 16000;

// This app only ever asks a model for text. Anything that generates images,
// audio, video or music, plus embedding/retrieval-only models, is filtered out
// of the picker even when the API reports it as supporting generateContent.
const NON_TEXT_MODEL_PATTERN = /embedding|image|imagen|audio|-tts|\btts\b|veo|lyria|live|aqa|learnlm/i;

// --- Gemini ---
let cachedGenAI = null;
let cachedGeminiKey = null;

async function generateWithGemini({ system, user }, apiKey, modelName) {
  if (!apiKey) {
    throw new Error('Gemini API key is not set. Please enter it in the settings.');
  }

  if (apiKey !== cachedGeminiKey || !cachedGenAI) {
    cachedGenAI = new GoogleGenerativeAI(apiKey);
    cachedGeminiKey = apiKey;
  }

  // The system instruction changes with style and language, so the model
  // handle is created per request — it is a plain config object, not a connection.
  const model = cachedGenAI.getGenerativeModel(
    { model: modelName, systemInstruction: system },
    { timeout: REQUEST_TIMEOUT_MS }
  );

  const result = await model.generateContent(user);
  const text = result.response.text();
  if (!text || !text.trim()) {
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
async function generateWithOpenRouter({ system, user }, apiKey, modelName) {
  if (!apiKey) {
    throw new Error('OpenRouter API key is not set. Please enter it in the settings.');
  }
  if (!modelName) {
    throw new Error('No OpenRouter model selected. Pick one in the settings.');
  }

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
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user }
      ]
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    let detail = body;
    try {
      detail = JSON.parse(body)?.error?.message || body;
    } catch (e) { /* keep the raw body */ }
    throw new Error(`OpenRouter error ${res.status}: ${String(detail).slice(0, 300)}`);
  }

  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) {
    throw new Error('OpenRouter returned an empty response.');
  }
  return content;
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

async function generateWithAnthropic({ system, user }, apiKey, modelName) {
  if (!apiKey) {
    throw new Error('Anthropic API key is not set. Please enter it in the settings.');
  }
  const model = modelName || DEFAULT_ANTHROPIC_MODEL;
  const client = getAnthropicClient(apiKey);

  const params = {
    model,
    max_tokens: ANTHROPIC_MAX_TOKENS,
    system,
    messages: [{ role: 'user', content: user }]
  };

  try {
    const response = ANTHROPIC_FALLBACK_MODELS.has(model)
      ? await client.beta.messages.create({
        ...params,
        betas: [ANTHROPIC_FALLBACK_BETA],
        fallbacks: 'default'
      })
      : await client.messages.create(params);
    return extractClaudeText(response);
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
  getProvider
};
