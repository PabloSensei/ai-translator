// --- History helpers ---
// Pure functions, shared by the main process and the tests.

// Caps the history at `max` entries, newest first. Favourites are never
// dropped to make room: only the oldest non-favourite entries go.
function trimHistory(items, max) {
  if (!Array.isArray(items) || items.length <= max) return items;
  let budget = max - items.filter(item => item && item.favorite).length;
  return items.filter(item => {
    if (item && item.favorite) return true;
    return budget-- > 0;
  });
}

const EXPORT_FORMATS = ['json', 'csv', 'md'];

// RFC 4180: quote every field, double embedded quotes. A leading =, +, - or @
// is prefixed with an apostrophe so spreadsheet apps do not run it as a formula.
function csvField(value) {
  let text = value === undefined || value === null ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

/**
 * Serialises history entries for export.
 * @param {object[]} items  history entries, as stored
 * @param {'json'|'csv'|'md'} format
 * @param {(code: string) => string} [langName]  turns a language code into a display name
 */
function formatHistoryExport(items, format, langName = code => code) {
  const rows = (Array.isArray(items) ? items : []).map(item => ({
    date: item.timestamp || '',
    mode: item.mode === 'fix' ? 'fix' : 'translate',
    source: langName(item.sourceLang || ''),
    target: item.mode === 'fix' ? '' : langName(item.targetLang || ''),
    favorite: Boolean(item.favorite),
    sourceText: item.image ? '(image)' : (item.sourceText || ''),
    targetText: item.targetText || ''
  }));

  if (format === 'json') {
    return JSON.stringify(rows, null, 2) + '\n';
  }
  if (format === 'csv') {
    const header = ['Date', 'Mode', 'Source language', 'Target language', 'Favorite', 'Original', 'Result'];
    const lines = rows.map(r => [r.date, r.mode, r.source, r.target, r.favorite ? 'yes' : '', r.sourceText, r.targetText].map(csvField).join(','));
    // The BOM makes Excel read the file as UTF-8 instead of the ANSI code page.
    return '﻿' + [header.map(csvField).join(','), ...lines].join('\r\n') + '\r\n';
  }
  if (format === 'md') {
    const blocks = rows.map(r => {
      const title = r.mode === 'fix' ? `Fix · ${r.source}` : `${r.source} → ${r.target}`;
      const quote = text => text.split('\n').map(line => `> ${line}`).join('\n');
      return `## ${r.favorite ? '★ ' : ''}${title}\n\n_${r.date}_\n\n${quote(r.sourceText)}\n\n${r.targetText}\n`;
    });
    return `# AI Translator history\n\n${blocks.join('\n---\n\n')}`;
  }
  throw new Error(`Unknown export format: ${format}`);
}

module.exports = { trimHistory, formatHistoryExport, EXPORT_FORMATS };
