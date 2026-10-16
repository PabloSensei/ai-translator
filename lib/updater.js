// --- Automatic updates ---
// A thin state machine over electron-updater's autoUpdater. The updater is
// passed in rather than required here, so the logic runs in tests with a fake
// and electron-updater is only loaded inside a packaged app.

const CHECK_DELAY_MS = 10 * 1000;
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

const RELEASES_URL = (repo) => `https://github.com/${repo}/releases/latest`;

// Turns updater failures into something a user can act on.
function describeUpdateError(err) {
  const message = String((err && err.message) || err || 'Unknown error');
  if (/code signature|not signed|SecCodeCheckValidity|ShipIt/i.test(message)) {
    return 'This build is not signed, so macOS cannot install updates automatically. Download the new version from the releases page.';
  }
  if (/ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|net::ERR_/i.test(message)) {
    return 'Could not reach GitHub to check for updates. Check your internet connection.';
  }
  if (/latest(-mac|-linux)?\.yml/i.test(message) && /404|Cannot find/i.test(message)) {
    return 'The latest release has no update information yet. Try again later or download it from the releases page.';
  }
  return message.split('\n')[0].slice(0, 200);
}

/**
 * @param {object} options
 * @param {import('events').EventEmitter & {checkForUpdates: Function, downloadUpdate: Function, quitAndInstall: Function}} options.updater
 * @param {string} options.currentVersion
 * @param {boolean} [options.autoDownload]
 * @param {(status: object) => void} [options.onStatus]
 */
function createUpdater({ updater, currentVersion, autoDownload = true, onStatus = () => {} }) {
  // state: idle | checking | latest | available | downloading | downloaded | error
  let status = { state: 'idle', currentVersion };

  const set = (patch) => {
    status = { currentVersion, ...patch };
    onStatus(status);
  };

  updater.autoDownload = autoDownload;
  // A downloaded update is applied the next time the app quits anyway.
  updater.autoInstallOnAppQuit = true;

  updater.on('checking-for-update', () => set({ state: 'checking' }));
  updater.on('update-available', (info) => {
    set({ state: updater.autoDownload ? 'downloading' : 'available', version: info && info.version, percent: 0 });
  });
  updater.on('update-not-available', () => set({ state: 'latest' }));
  updater.on('download-progress', (progress) => {
    set({ state: 'downloading', version: status.version, percent: Math.round((progress && progress.percent) || 0) });
  });
  updater.on('update-downloaded', (info) => set({ state: 'downloaded', version: (info && info.version) || status.version }));
  updater.on('error', (err) => set({ state: 'error', version: status.version, error: describeUpdateError(err) }));

  return {
    get status() {
      return status;
    },

    async check() {
      // Nothing to learn while a download is running or waiting to install.
      if (status.state === 'downloading' || status.state === 'downloaded' || status.state === 'checking') {
        return status;
      }
      try {
        await updater.checkForUpdates();
      } catch (err) {
        // Usually reported through the 'error' event as well; set() is idempotent.
        set({ state: 'error', version: status.version, error: describeUpdateError(err) });
      }
      return status;
    },

    async download() {
      if (status.state !== 'available' && status.state !== 'error') return status;
      set({ state: 'downloading', version: status.version, percent: 0 });
      try {
        await updater.downloadUpdate();
      } catch (err) {
        set({ state: 'error', version: status.version, error: describeUpdateError(err) });
      }
      return status;
    },

    install() {
      if (status.state !== 'downloaded') return false;
      // isSilent=false shows the installer UI on Windows; isForceRunAfter
      // starts the updated app again.
      updater.quitAndInstall(false, true);
      return true;
    },

    setAutoDownload(value) {
      updater.autoDownload = Boolean(value);
    }
  };
}

module.exports = { createUpdater, describeUpdateError, CHECK_DELAY_MS, CHECK_INTERVAL_MS, RELEASES_URL };
