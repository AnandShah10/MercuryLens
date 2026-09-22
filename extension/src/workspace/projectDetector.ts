import * as vscode from 'vscode';
import * as path from 'path';

/**
 * Finds a plausible "main module" for build/run commands: a module whose
 * name matches a top-level `.m` file and whose body defines `main(...)`.
 * This is a heuristic used only to pre-fill/suggest a target — the user is
 * always shown (and can override) what will actually be built/run, per the
 * SECURITY requirements around not silently running commands.
 */
export async function findMainModuleCandidates(folder: vscode.WorkspaceFolder): Promise<{ moduleName: string; uri: vscode.Uri }[]> {
    const files = await vscode.workspace.findFiles(new vscode.RelativePattern(folder, '**/*.m'), '**/Mercury/**');
    const candidates: { moduleName: string; uri: vscode.Uri }[] = [];
    for (const uri of files) {
        try {
            const bytes = await vscode.workspace.fs.readFile(uri);
            const text = Buffer.from(bytes).toString('utf8');
            if (/:-\s*pred\s+main\s*\(/.test(text) || /\bmain\s*\(\s*!IO\s*\)\s*:-/.test(text)) {
                const moduleMatch = text.match(/:-\s*module\s+([A-Za-z_][A-Za-z0-9_.]*)/);
                const moduleName = moduleMatch ? moduleMatch[1] : path.basename(uri.fsPath, '.m');
                candidates.push({ moduleName, uri });
            }
        } catch {
            // unreadable file; skip rather than fail the whole scan
        }
    }
    return candidates;
}

export function moduleNameForFile(fileUri: vscode.Uri, text: string): string {
    const moduleMatch = text.match(/:-\s*module\s+([A-Za-z_][A-Za-z0-9_.]*)/);
    return moduleMatch ? moduleMatch[1] : path.basename(fileUri.fsPath, path.extname(fileUri.fsPath));
}

export function isWorkspaceTrusted(): boolean {
    return vscode.workspace.isTrusted;
}
