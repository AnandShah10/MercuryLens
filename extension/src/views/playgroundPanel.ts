import * as vscode from 'vscode';
import { htmlShell } from './webviewUtils';

export interface PlaygroundResult {
    compileOutput: string;
    stdout: string;
    stderr: string;
    exitCode: number | null;
    durationMs: number;
    success: boolean;
}

let currentPanel: vscode.WebviewPanel | undefined;

export function createPlaygroundPanel(title: string, sourceShown: string, result: PlaygroundResult | undefined): void {
    if (!currentPanel) {
        currentPanel = vscode.window.createWebviewPanel('mercuryPlayground', title, vscode.ViewColumn.Beside, {
            enableScripts: true,
            retainContextWhenHidden: true,
        });
        currentPanel.onDidDispose(() => (currentPanel = undefined));
    } else {
        currentPanel.title = title;
        currentPanel.reveal(vscode.ViewColumn.Beside);
    }
    currentPanel.webview.html = render(currentPanel.webview, title, sourceShown, result);
}

function esc(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function render(webview: vscode.Webview, title: string, sourceShown: string, result: PlaygroundResult | undefined): string {
    const body = `
    <div class="toolbar"><strong>${esc(title)}</strong></div>
    <div class="content">
      ${sourceShown ? `<h4>Generated harness</h4><pre>${esc(sourceShown)}</pre>` : `<p class="muted">Use "Mercury: Run File", "Mercury: Run Selection", or "Mercury: Run Predicate" to populate this panel.</p>`}
      ${result ? renderResult(result) : ''}
    </div>`;
    return htmlShell(webview, body, '');
}

function renderResult(r: PlaygroundResult): string {
    return `
    <h4>Compiler Output</h4>
    <pre>${esc(r.compileOutput || '(no compiler output)')}</pre>
    <h4>Output</h4>
    <pre>${esc(r.stdout || '(no stdout)')}</pre>
    ${r.stderr ? `<h4>Stderr</h4><pre>${esc(r.stderr)}</pre>` : ''}
    <p><strong>Exit code:</strong> ${r.exitCode === null ? '(process did not complete normally)' : r.exitCode} &nbsp; <strong>Execution time:</strong> ${r.durationMs}ms</p>
  `;
}
