# Changelog

## 2.0.1

### Fixed
- **Translate selection on Windows and macOS** translated whatever was last on the clipboard instead of the selected text. The app now presses `Ctrl+C` (`Cmd+C`) for you, takes the selection and puts your previous clipboard back; with nothing selected it still uses the clipboard. On macOS this needs the Accessibility permission (the system asks for it on first use).
- The settings button no longer looks like a second theme switch: it is now a gear.

## 2.0.0

The biggest update so far: a third AI provider, streamed translations, text from screenshots, a searchable history and automatic updates.

### New
- **Anthropic Claude** as a third provider next to Gemini and OpenRouter (Claude Opus 5.5 by default).
- **Streamed translations** — the result appears as it is generated; **Stop** cancels it.
- **Translate selection** — copy text in any app and press `Ctrl+Shift+Y` (on Linux the highlighted text is used directly).
- **Text from screenshots** — paste, drop or pick an image, or copy a screenshot and press `Ctrl+Shift+Y`; Claude, Gemini and image-capable OpenRouter models read the text in it and translate it.
- **History**: search, ★ favorites that are never pushed out, and export to CSV, JSON or Markdown.
- **Automatic updates** on Windows and Linux: new versions download in the background and install on the next restart. macOS shows a notice with a download link.
- **Keyboard navigation** in the language lists; searching also matches English names ("german" finds "Deutsch").
- New app icon.

### Improved
- API keys never leave the main process; Settings only shows whether a key is saved.
- Gemini uses Google's current SDK (`@google/genai`); blocked and cut-off answers are reported instead of showing up empty or half-finished.
- The Inter font ships with the app: no requests to Google Fonts, and it looks the same offline.
- Clearer error messages for invalid keys, rate limits, unknown models and timeouts.
- Electron 44.8, electron-store 12 and other dependency updates.

### Fixed
- The translate-selection hotkey and the tray's *Translate Clipboard* did nothing on Electron 44.
- Error messages vanished from the output pane right after a failed translation.
- Clear, opening a history entry, attaching an image or Swap during a translation let the old request overwrite the new content.
- Answers cut off by OpenRouter's token limit were accepted as complete.
- A stalled Claude stream was never timed out.
- Text containing `</text>` could break out of the prompt's data block.
- A failed update install left the window unable to hide to the tray.
- Double-clicking the tray icon on Windows opened and immediately hid the window.
- Windows shutdown could be held up by the hide-to-tray window.
- A shortcut taken by another app at startup failed silently; it is now reported.
- Ctrl+V of Office content attached a picture instead of the text.

### Notes
- Releases are not code-signed. Windows SmartScreen and macOS Gatekeeper warn on first launch — see *Installation* in the README.
- Installer file names no longer contain spaces (`AI-Translator-Setup-2.0.0.exe`, …).
- Automatic updates start working from this version on: 1.x has no updater, so install 2.0.0 manually once.
