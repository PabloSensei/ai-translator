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

// KeyboardEvent.code values that need translating into Electron accelerator
// key names. Letters, digits and F-keys are handled by pattern below.
const ACCELERATOR_KEYS = {
    Space: 'Space', Enter: 'Enter', Tab: 'Tab', Backspace: 'Backspace',
    Delete: 'Delete', Insert: 'Insert', Home: 'Home', End: 'End',
    PageUp: 'PageUp', PageDown: 'PageDown',
    ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
    Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\',
    Semicolon: ';', Quote: '\'', Comma: ',', Period: '.', Slash: '/', Backquote: '`',
    NumpadAdd: 'numadd', NumpadSubtract: 'numsub', NumpadMultiply: 'nummult',
    NumpadDivide: 'numdiv', NumpadDecimal: 'numdec', NumpadEnter: 'Enter'
};

/**
 * Converts a keydown event into an Electron accelerator string.
 *
 * Uses the physical key (event.code) rather than event.key: with Shift held,
 * event.key reports the shifted character ("Ctrl+Shift+!" instead of
 * "Ctrl+Shift+1"), and arrow keys come through as "ArrowUp", neither of which
 * globalShortcut accepts.
 *
 * @param {{ctrlKey?: boolean, altKey?: boolean, shiftKey?: boolean, metaKey?: boolean, code?: string}} e
 * @returns {{ modifiers: string[], key: string|null, accelerator: string|null }}
 *   `accelerator` is null until a non-modifier key is pressed together with at
 *   least one modifier.
 */
function keyEventToAccelerator(e) {
    const modifiers = [];
    if (e.ctrlKey) modifiers.push('Ctrl');
    if (e.altKey) modifiers.push('Alt');
    if (e.shiftKey) modifiers.push('Shift');
    // "Super" is the Windows key on Windows/Linux and Cmd on macOS.
    if (e.metaKey) modifiers.push('Super');

    const code = typeof e.code === 'string' ? e.code : '';
    let key = null;
    if (/^Key[A-Z]$/.test(code)) key = code.slice(3);
    else if (/^Digit[0-9]$/.test(code)) key = code.slice(5);
    else if (/^Numpad[0-9]$/.test(code)) key = `num${code.slice(6)}`;
    else if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) key = code;
    else if (Object.prototype.hasOwnProperty.call(ACCELERATOR_KEYS, code)) key = ACCELERATOR_KEYS[code];

    const accelerator = key && modifiers.length ? [...modifiers, key].join('+') : null;
    return { modifiers, key, accelerator };
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { escapeHtml, keyEventToAccelerator };
}
