const { URL } = require('url');

// Mock ipcMain and shell behavior
const shell = {
  openExternal: (url) => {
    console.log(`[SUCCESS] Opening: ${url}`);
    return Promise.resolve();
  }
};

const ipcMain = {
  on: (channel, handler) => {
    // We store the handler to call it manually
    global.handler = handler;
  }
};

// Simulate the fixed logic
// This logic will be copied into main.js
ipcMain.on('open-external', async (event, url) => {
  if (!url || typeof url !== 'string') return;
  try {
    const parsed = new URL(url);
    if (['http:', 'https:'].includes(parsed.protocol)) {
      await shell.openExternal(url);
    } else {
      console.warn(`[BLOCKED] Protocol not allowed: ${url}`);
    }
  } catch (err) {
    console.warn(`[BLOCKED] Invalid URL: ${url}`);
  }
});

// Run tests
(async () => {
  console.log('--- Testing URL Validation Logic ---');

  const tests = [
    { input: 'https://google.com', expected: true },
    { input: 'http://example.com', expected: true },
    { input: 'file:///etc/passwd', expected: false },
    { input: 'javascript:alert(1)', expected: false },
    { input: 'sftp://example.com', expected: false },
    { input: 'invalid-url', expected: false },
    { input: '', expected: false },
    { input: null, expected: false },
    { input: 123, expected: false },
  ];

  let passed = true;
  const originalLog = console.log;
  const originalWarn = console.warn;

  for (const t of tests) {
    let allowed = false;

    // Mock console to capture output
    console.log = (msg) => {
      if (msg.includes('[SUCCESS]')) allowed = true;
    };
    console.warn = (msg) => {
      if (msg.includes('[BLOCKED]')) allowed = false;
    };

    try {
      await global.handler({}, t.input);
    } catch (e) {
      console.error(e);
      allowed = false;
    }

    // Restore console
    console.log = originalLog;
    console.warn = originalWarn;

    if (allowed !== t.expected) {
      console.error(`FAILED: Input "${t.input}" -> Expected ${t.expected}, got ${allowed}`);
      passed = false;
    } else {
      console.log(`PASSED: Input "${t.input}" -> ${allowed ? 'Allowed' : 'Blocked'}`);
    }
  }

  if (passed) {
    console.log('--- All Tests Passed ---');
    process.exit(0);
  } else {
    console.error('--- Some Tests Failed ---');
    process.exit(1);
  }
})();
