// --- Reading the selected text of another app ---
// Windows and macOS have no PRIMARY selection, so the only way to get what
// is highlighted in another app is to copy it: press Ctrl+C (Cmd+C) for the
// user, read the clipboard, and put back what was there before.
//
// Everything that touches the OS is passed in, so the logic runs in tests
// with fakes: `clipboard` is Electron's (async) clipboard module, `keyboard`
// presses keys, `sleep(ms)` waits.

const COPY_TIMEOUT_MS = 400;
const POLL_MS = 25;

/**
 * The modifiers an Electron accelerator holds down, as canonical names
 * ('Ctrl' | 'Alt' | 'Shift' | 'Meta'). They are still physically pressed
 * when the global shortcut fires, and have to be lifted before Ctrl+C: with
 * Shift held it would arrive as Ctrl+Shift+C, which browsers bind to the
 * element inspector.
 */
function acceleratorModifiers(accelerator, platform = process.platform) {
  const names = {
    ctrl: 'Ctrl', control: 'Ctrl',
    alt: 'Alt', option: 'Alt', altgr: 'Alt',
    shift: 'Shift',
    super: 'Meta', meta: 'Meta', cmd: 'Meta', command: 'Meta',
    cmdorctrl: platform === 'darwin' ? 'Meta' : 'Ctrl',
    commandorcontrol: platform === 'darwin' ? 'Meta' : 'Ctrl'
  };
  const held = new Set();
  for (const part of String(accelerator || '').split('+')) {
    const name = names[part.trim().toLowerCase()];
    if (name) held.add(name);
  }
  return [...held];
}

/**
 * Snapshot of the clipboard that can be written back exactly, or null when
 * some of its content cannot be read (files copied in Explorer or Finder,
 * private formats). Such a clipboard is left holding the selection rather
 * than "restored" to a partial copy of itself.
 */
async function snapshotClipboard(clipboard, ClipboardItem) {
  try {
    const items = await clipboard.read();
    const restored = [];
    for (const item of items) {
      const data = {};
      for (const type of item.types) {
        const value = await item.getType(type);
        if (!(value instanceof Blob)) return null;
        data[type] = value;
      }
      if (Object.keys(data).length) restored.push(new ClipboardItem(data));
    }
    return restored;
  } catch (err) {
    return null;
  }
}

/**
 * Copies the selection of the focused app and returns it as text, or '' when
 * nothing new was copied (no selection, or an app that ignores Ctrl+C).
 *
 * @param {object} deps
 * @param {object} deps.clipboard - Electron clipboard (readText/read/write/clear, all async)
 * @param {Function} deps.ClipboardItem - Electron's ClipboardItem class
 * @param {{ pressCopy: Function }} deps.keyboard - presses Ctrl+C (Cmd+C on
 *   macOS) in the focused app, lifting the hotkey's modifiers first
 * @param {(ms: number) => Promise<void>} deps.sleep
 */
async function copySelectedText({ clipboard, ClipboardItem, keyboard, sleep, timeoutMs = COPY_TIMEOUT_MS }) {
  const before = await clipboard.readText().catch(() => '');
  const snapshot = await snapshotClipboard(clipboard, ClipboardItem);

  keyboard.pressCopy();

  let copied = '';
  for (let waited = 0; waited < timeoutMs; waited += POLL_MS) {
    await sleep(POLL_MS);
    const now = await clipboard.readText().catch(() => '');
    if (now !== before) {
      copied = now;
      break;
    }
  }

  // Put back what the user had copied before, when it can be done exactly.
  if (copied && snapshot) {
    try {
      if (snapshot.length) {
        await clipboard.write(snapshot);
      } else {
        await clipboard.clear();
      }
    } catch (err) {
      // The selection stays on the clipboard, as after a normal Ctrl+C.
    }
  }
  return copied;
}

module.exports = { copySelectedText, snapshotClipboard, acceleratorModifiers, COPY_TIMEOUT_MS };
