import * as vscode from 'vscode';
import { LanguageClient } from 'vscode-languageclient/node';

export async function organizeImports(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;
    const fullRange = new vscode.Range(0, 0, editor.document.lineCount, 0);
    const actions = await vscode.commands.executeCommand<(vscode.CodeAction | vscode.Command)[]>(
        'vscode.executeCodeActionProvider',
        editor.document.uri,
        fullRange,
        vscode.CodeActionKind.SourceOrganizeImports.value,
    );
    const action = actions?.find((a): a is vscode.CodeAction => 'edit' in a && !!a.edit);
    if (!action?.edit) {
        vscode.window.showInformationMessage('Mercury: nothing to organize (no unused imports detected).');
        return;
    }
    await vscode.workspace.applyEdit(action.edit);
}

export function makeRestartServerCommand(restart: () => Promise<void>) {
    return async (): Promise<void> => {
        await restart();
        vscode.window.showInformationMessage('Mercury language server restarted.');
    };
}

export function makeGetClientRef() {
    let client: LanguageClient | undefined;
    return {
        get: () => client,
        set: (c: LanguageClient | undefined) => { client = c; },
    };
}
