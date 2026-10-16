const test = require('node:test');
const assert = require('node:assert');
const { EventEmitter } = require('node:events');
const { createUpdater, describeUpdateError } = require('../lib/updater');

// Stands in for electron-updater's autoUpdater: emits the same events.
function fakeUpdater({ latest = '1.2.0', fail = null } = {}) {
  const u = new EventEmitter();
  u.calls = [];
  u.checkForUpdates = async () => {
    u.calls.push('check');
    u.emit('checking-for-update');
    if (fail) {
      const err = new Error(fail);
      u.emit('error', err);
      throw err;
    }
    if (latest === '1.1.0') {
      u.emit('update-not-available', { version: latest });
      return;
    }
    u.emit('update-available', { version: latest });
    if (u.autoDownload) {
      u.emit('download-progress', { percent: 42.4 });
      u.emit('update-downloaded', { version: latest });
    }
  };
  u.downloadUpdate = async () => {
    u.calls.push('download');
    u.emit('download-progress', { percent: 100 });
    u.emit('update-downloaded', { version: latest });
  };
  u.quitAndInstall = (...args) => u.calls.push(['install', ...args]);
  return u;
}

test('auto-download: available → downloading → downloaded, then install', async () => {
  const updater = fakeUpdater();
  const seen = [];
  const u = createUpdater({ updater, currentVersion: '1.1.0', onStatus: s => seen.push(s.state + (s.percent ? `:${s.percent}` : '')) });
  assert.strictEqual(updater.autoInstallOnAppQuit, true);

  const status = await u.check();
  assert.deepStrictEqual(seen, ['checking', 'downloading', 'downloading:42', 'downloaded']);
  assert.deepStrictEqual(status, { currentVersion: '1.1.0', state: 'downloaded', version: '1.2.0' });

  // A downloaded update is not checked again.
  await u.check();
  assert.deepStrictEqual(updater.calls, ['check']);

  assert.strictEqual(u.install(), true);
  assert.deepStrictEqual(updater.calls[1], ['install', false, true]);
});

test('manual download: available waits for the user', async () => {
  const updater = fakeUpdater();
  const u = createUpdater({ updater, currentVersion: '1.1.0', autoDownload: false });
  assert.strictEqual((await u.check()).state, 'available');
  assert.strictEqual(u.install(), false, 'nothing to install yet');

  const status = await u.download();
  assert.strictEqual(status.state, 'downloaded');
  assert.deepStrictEqual(updater.calls, ['check', 'download']);
});

test('setAutoDownload switches the behaviour of the next check', async () => {
  const updater = fakeUpdater();
  const u = createUpdater({ updater, currentVersion: '1.1.0', autoDownload: false });
  u.setAutoDownload(true);
  assert.strictEqual(updater.autoDownload, true);
  assert.strictEqual((await u.check()).state, 'downloaded');
});

test('up to date and failures are reported as states', async () => {
  const latest = createUpdater({ updater: fakeUpdater({ latest: '1.1.0' }), currentVersion: '1.1.0' });
  assert.strictEqual((await latest.check()).state, 'latest');

  const broken = createUpdater({ updater: fakeUpdater({ fail: 'getaddrinfo ENOTFOUND github.com' }), currentVersion: '1.1.0' });
  const status = await broken.check();
  assert.strictEqual(status.state, 'error');
  assert.match(status.error, /Could not reach GitHub/);
  // An error does not block the next attempt.
  await broken.check();
});

test('describeUpdateError explains the common failures', () => {
  assert.match(describeUpdateError(new Error('Could not get code signature for running application')), /not signed/);
  assert.match(describeUpdateError(new Error('net::ERR_INTERNET_DISCONNECTED')), /internet connection/);
  assert.match(describeUpdateError(new Error('Cannot find latest-mac.yml in the latest release artifacts (https://...): HttpError: 404')), /no update information/);
  assert.strictEqual(describeUpdateError(new Error('first line\nstack')), 'first line');
  assert.strictEqual(describeUpdateError(undefined), 'Unknown error');
});

test('where the app cannot install updates, it only announces them', async () => {
  const updater = fakeUpdater();
  const u = createUpdater({ updater, currentVersion: '1.1.0', autoDownload: true, canInstall: false });
  assert.strictEqual(updater.autoDownload, false);
  const status = await u.check();
  assert.deepStrictEqual(status, { currentVersion: '1.1.0', state: 'available', version: '1.2.0', percent: 0, manual: true });

  u.setAutoDownload(true);
  assert.strictEqual(updater.autoDownload, false);
  await u.download();
  assert.deepStrictEqual(updater.calls, ['check'], 'never downloads');
  assert.strictEqual(u.install(), false);
});

test('a failed background download is reported, not left as an unhandled rejection', async () => {
  const updater = fakeUpdater();
  updater.checkForUpdates = async () => {
    updater.emit('update-available', { version: '1.2.0' });
    const downloadPromise = new Promise((resolve, reject) => setTimeout(() => {
      const err = new Error('net::ERR_CONNECTION_RESET');
      updater.emit('error', err);
      reject(err);
    }, 5));
    return { updateInfo: { version: '1.2.0' }, downloadPromise };
  };
  let unhandled = null;
  const onUnhandled = (err) => { unhandled = err; };
  process.on('unhandledRejection', onUnhandled);
  try {
    const u = createUpdater({ updater, currentVersion: '1.1.0' });
    await u.check();
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.strictEqual(u.status.state, 'error');
    assert.match(u.status.error, /internet connection/);
    assert.strictEqual(unhandled, null);
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }
});
