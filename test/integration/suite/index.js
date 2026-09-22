const path = require('path');
const Mocha = require('mocha');
const glob = require('glob');

exports.run = function run() {
    const mocha = new Mocha({ ui: 'tdd', timeout: 30000 });
    const testsRoot = __dirname;
    return new Promise((resolve, reject) => {
        glob('**/*.test.js', { cwd: testsRoot }, (err, files) => {
            if (err) return reject(err);
            files.forEach((f) => mocha.addFile(path.resolve(testsRoot, f)));
            try {
                mocha.run((failures) => {
                    if (failures > 0) reject(new Error(`${failures} integration tests failed.`));
                    else resolve();
                });
            } catch (err2) {
                reject(err2);
            }
        });
    });
};
