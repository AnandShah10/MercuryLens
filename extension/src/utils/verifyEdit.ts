import * as vscode from 'vscode';
import * as path from 'path';
import { detectCompiler } from '../compiler/detector';
import { runProcess } from '../utils/process';

/**
 * Shared by every text-heuristic refactoring in this project (Extract
 * Predicate, Inline Predicate): closes the loop with the real compiler
 * immediately after applying a heuristic edit, rather than leaving "please
 * verify yourself" as the only feedback. If `mmc` is available, this runs
 * `--errorcheck-only` on the edited file right away and reports the actual
 * verdict; on failure it offers a one-key Undo while the edit is still the
 * top of the undo stack. If no compiler is available, it says so plainly
 * instead of implying verification happened.
 */
export async function verifyEditWithCompiler(editor: vscode.TextEditor, describeChange: string): Promise<void> {
    const folder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
    const cwd = folder?.uri.fsPath ?? path.dirname(editor.document.uri.fsPath);
    const detection = await detectCompiler(cwd);
    if (!detection.found || !detection.executable) {
        vscode.window.showInformationMessage(
            `Mercury: ${describeChange}. No Mercury compiler was found, so this could not be auto-verified — run 'Mercury: Check Project' once mmc is configured.`,
        );
        return;
    }

    const result = await runProcess(detection.executable, ['--errorcheck-only', editor.document.uri.fsPath], { cwd, timeoutMs: 30000 });
    const diagnostics = parseDiagnosticLines(result.stdout + '\n' + result.stderr);
    const hasErrors = diagnostics.some((d) => d.severity === 'error') || (result.exitCode !== 0 && diagnostics.length === 0 && (result.stdout + result.stderr).trim().length > 0);

    if (!hasErrors) {
        vscode.window.showInformationMessage(`Mercury: ${describeChange} — verified: mmc --errorcheck-only reports no errors.`);
        return;
    }

    const preview = diagnostics.length > 0
        ? diagnostics.map((d) => d.message).slice(0, 3).join(' | ')
        : (result.stderr || result.stdout).trim().slice(0, 300);
    const choice = await vscode.window.showErrorMessage(
        `Mercury: ${describeChange} does not compile cleanly (mmc --errorcheck-only reported an error). This usually means one of the heuristically-inferred modes was wrong. ${preview}`,
        'Undo',
        'Keep and fix manually',
    );
    if (choice === 'Undo') {
        await vscode.commands.executeCommand('undo');
        await editor.document.save();
        vscode.window.showInformationMessage('Mercury: change undone.');
    }
}

export function parseDiagnosticLines(output: string): { severity: 'error' | 'warning'; message: string }[] {
    const results: { severity: 'error' | 'warning'; message: string }[] = [];
    for (const line of output.split(/\r\n|\n/)) {
        const m = line.match(/^(.+?\.m):(\d+)(?:-(\d+))?:\s*(Error|Warning):\s*(.*)$/);
        if (m) results.push({ severity: m[4].toLowerCase() as 'error' | 'warning', message: m[5].trim() });
    }
    return results;
}
