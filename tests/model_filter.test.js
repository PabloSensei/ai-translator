const assert = require('assert');

// Implementations mirrored from main.js
const NON_TEXT_MODEL_PATTERN = /embedding|image|imagen|audio|-tts|\btts\b|veo|lyria|live|aqa|learnlm/i;

function openRouterReturnsText(model) {
  const arch = model.architecture || {};

  if (Array.isArray(arch.output_modalities) && arch.output_modalities.length) {
    return arch.output_modalities.includes('text') && !arch.output_modalities.includes('image');
  }

  if (typeof arch.modality === 'string' && arch.modality.includes('->')) {
    const outputs = arch.modality.split('->')[1].split('+');
    return outputs.includes('text') && !outputs.includes('image');
  }

  return true;
}

console.log('--- Testing the Gemini non-text model filter ---');

// Text models the picker must keep.
for (const id of [
  'gemini-3.8-flash',
  'gemini-3.7-flash',
  'gemini-3.5-flash-lite',
  'gemini-3.1-pro-preview',
  'gemini-2.5-flash',
  'gemini-2.5-pro',
  'gemma-3-27b-it'
]) {
  assert.strictEqual(NON_TEXT_MODEL_PATTERN.test(id), false, `should keep ${id}`);
}
console.log('PASSED: Text models are kept');

// Image, audio, video, music, embedding and retrieval models must be hidden.
// Several of these report generateContent support, so the name check is what
// actually removes them.
for (const id of [
  'gemini-2.5-flash-image',
  'gemini-3.1-flash-image-preview',
  'gemini-2.0-flash-preview-image-generation',
  'imagen-4.0-generate-001',
  'veo-3.0-generate-001',
  'lyria-3-pro-preview',
  'gemini-2.5-flash-preview-tts',
  'gemini-2.5-flash-preview-native-audio-dialog',
  'gemini-2.0-flash-live-001',
  'gemini-embedding-001',
  'text-embedding-004',
  'aqa',
  'learnlm-2.0-flash-experimental'
]) {
  assert.strictEqual(NON_TEXT_MODEL_PATTERN.test(id), true, `should drop ${id}`);
}
console.log('PASSED: Image/audio/video/embedding models are dropped');

console.log('--- Testing the OpenRouter modality filter ---');

const keep = (output_modalities) => openRouterReturnsText({ architecture: { output_modalities } });

assert.strictEqual(keep(['text']), true);
assert.strictEqual(keep(['text', 'audio']), true);
assert.strictEqual(keep(['image', 'text']), false);
assert.strictEqual(keep(['text', 'image']), false);
assert.strictEqual(keep(['image']), false);
console.log('PASSED: Image-producing models are dropped, text ones kept');

// Legacy "inputs->outputs" shape.
const legacy = (modality) => openRouterReturnsText({ architecture: { modality } });
assert.strictEqual(legacy('text+image+file+audio+video->text'), true);
assert.strictEqual(legacy('text->text'), true);
assert.strictEqual(legacy('text->image'), false);
assert.strictEqual(legacy('text->image+text'), false);
console.log('PASSED: Legacy modality strings handled');

// An unknown or missing shape should not silently hide a usable model.
assert.strictEqual(openRouterReturnsText({}), true);
assert.strictEqual(openRouterReturnsText({ architecture: {} }), true);
assert.strictEqual(openRouterReturnsText({ architecture: { output_modalities: [] } }), true);
assert.strictEqual(openRouterReturnsText({ architecture: { modality: 'weird' } }), true);
console.log('PASSED: Unknown shapes are kept rather than hidden');

console.log('--- All Tests Passed ---');
