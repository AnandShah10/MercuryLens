// Integration test runner. Launches a real VS Code instance with this
// extension installed and runs test/integration/suite/index.js inside it.
//
// This requires a graphical/headless-X environment and network access to
// download a VS Code test binary on first run, neither of which is
// available in every CI/sandbox environment. It is intentionally kept
// separate from `npm run test:unit`, which has no such dependency.
const path = require('path');
const { runTests } = require('@vscode/test-electron');

async function main() {
    try {
        const extensionDevelopmentPath = path.resolve(__dirname, '..', '..');
        const extensionTestsPath = path.resolve(__dirname, 'suite', 'index.js');
        const workspacePath = path.resolve(__dirname, '..', '..', 'fixtures', 'multi_module');
        await runTests({
            extensionDevelopmentPath,
            extensionTestsPath,
            launchArgs: [workspacePath, '--disable-extensions'],
        });
    } catch (err) {
        console.error('Failed to run integration tests:', err);
        process.exit(1);
    }
}

main();
