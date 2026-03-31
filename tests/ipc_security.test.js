const { isValidUrl } = require('../utils');

// Run tests
(() => {
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

  for (const t of tests) {
    const result = isValidUrl(t.input);
    if (result !== t.expected) {
      console.error(`FAILED: Input "${t.input}" -> Expected ${t.expected}, got ${result}`);
      passed = false;
    } else {
      console.log(`PASSED: Input "${t.input}" -> ${result ? 'Allowed' : 'Blocked'}`);
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
