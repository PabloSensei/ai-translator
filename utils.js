/**
 * Validates a URL to ensure it uses allowed protocols.
 * @param {string} url - The URL to validate.
 * @returns {boolean} - True if the URL is valid and uses an allowed protocol, false otherwise.
 */
function isValidUrl(url) {
  if (!url || typeof url !== 'string') return false;
  try {
    const parsed = new URL(url);
    return ['http:', 'https:'].includes(parsed.protocol);
  } catch (err) {
    return false;
  }
}

/**
 * Updates the list of recent languages, ensuring the most recent are at the front
 * and the list is limited to 10 unique entries.
 * @param {string[]} recent - Current list of recent languages.
 * @param {string} source - Source language code.
 * @param {string} target - Target language code.
 * @returns {string[]} - Updated list of recent languages.
 */
function updateRecentLanguagesList(recent, source, target) {
  // Move to start, removing any existing occurrences
  let filtered = (recent || []).filter(l => l !== source && l !== target);

  if (source === target) {
    filtered.unshift(source);
  } else {
    filtered.unshift(target);
    filtered.unshift(source);
  }

  // Max 10
  if (filtered.length > 10) filtered.length = 10;
  return filtered;
}

module.exports = {
  isValidUrl,
  updateRecentLanguagesList
};
