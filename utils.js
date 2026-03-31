/**
 * Pure utility functions for the translator.
 * Separated from renderer.js to be testable in Node.js.
 */

/**
 * Escapes HTML special characters in a string.
 * This version doesn't rely on the DOM (document.createElement).
 * @param {string} text - The text to escape.
 * @returns {string} The escaped HTML.
 */
function escapeHtml(text) {
    if (typeof text !== 'string') return '';
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { escapeHtml };
}
