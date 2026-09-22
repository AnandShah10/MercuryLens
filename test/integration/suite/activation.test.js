const assert = require('assert');
const vscode = require('vscode');

suite('Mercury Tools: extension activation', () => {
    test('activates on a .m file and registers its commands', async () => {
        const ext = vscode.extensions.getExtension('AnandShah.MercuryLens');
        assert.ok(ext, 'extension should be discoverable by publisher.name');
        await ext.activate();
        assert.strictEqual(ext.isActive, true);

        const commands = await vscode.commands.getCommands(true);
        const expected = [
            'mercuryTools.buildProject',
            'mercuryTools.checkProject',
            'mercuryTools.runFile',
            'mercuryTools.showModeInformation',
            'mercuryTools.showCallGraph',
            'mercuryTools.openAstExplorer',
            'mercuryTools.extractPredicate',
            'mercuryTools.debugWithMdb',
            'mercuryTools.openDeepProfile',
            'mercuryTools.restartServer',
        ];
        for (const cmd of expected) {
            assert.ok(commands.includes(cmd), `expected command ${cmd} to be registered`);
        }
    });

    test('recognizes a .m file as the mercury language', async () => {
        const uri = vscode.Uri.joinPath(vscode.workspace.workspaceFolders[0].uri, 'main.m');
        const doc = await vscode.workspace.openTextDocument(uri);
        assert.strictEqual(doc.languageId, 'mercury');
    });
});
