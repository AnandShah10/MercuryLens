const path = require('path');
const Mocha = require('mocha');
const { globSync } = require('glob');

exports.run = function run() {
    const mocha = new Mocha({ ui: 'tdd', timeout: 30000 });
    const testsRoot = __dirname;

    // glob v10+ no longer exports a callback-based function by default (ESM-first).
    // Use the synchronous variant to keep the test runner simple.
    const files = globSync('**/*.test.js', { cwd: testsRoot });
    files.forEach((f) => mocha.addFile(path.resolve(testsRoot, f)));

    return new Promise((resolve, reject) => {
        try {
            mocha.run((failures) => {
                if (failures > 0) reject(new Error(`${failures} integration tests failed.`));
                else resolve();
            });
        } catch (err) {
            reject(err);
        }
    });
};
