const { escapeHtml } = require('../utils.js');
const assert = require('assert');

/**
 * Unit tests for escapeHtml function in utils.js
 */
function testEscapeHtml() {
    console.log('--- Testing escapeHtml ---');

    const testCases = [
        { input: 'hello world', expected: 'hello world' },
        { input: '<div>', expected: '&lt;div&gt;' },
        { input: 'script < > & " \'', expected: 'script &lt; &gt; &amp; &quot; &#039;' },
        { input: 'multiple   spaces', expected: 'multiple   spaces' },
        { input: '', expected: '' },
        { input: null, expected: '' },
        { input: undefined, expected: '' },
        { input: 123, expected: '' },
    ];

    let passedCount = 0;
    for (const tc of testCases) {
        const result = escapeHtml(tc.input);
        if (result === tc.expected) {
            console.log(`PASSED: Input '${tc.input}' -> '${result}'`);
            passedCount++;
        } else {
            console.error(`FAILED: Input '${tc.input}' -> Expected '${tc.expected}', got '${result}'`);
        }
    }

    if (passedCount === testCases.length) {
        console.log('--- All escapeHtml Tests Passed ---');
        process.exit(0);
    } else {
        console.error(`--- ${testCases.length - passedCount} escapeHtml Tests Failed ---`);
        process.exit(1);
    }
}

testEscapeHtml();
