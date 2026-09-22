import * as vscode from 'vscode';
import { htmlShell } from './webviewUtils';

export interface ProfileData {
    available: boolean;
    reportText?: string;
    reason?: string;
}

function esc(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function createPerformanceProfilePanel(data: ProfileData): void {
    const panel = vscode.window.createWebviewPanel('mercuryProfile', 'Mercury: Performance Profile', vscode.ViewColumn.Beside, { enableScripts: false });
    const body = data.available
        ? `<div class="content"><h3>mprof report</h3><pre>${esc(data.reportText ?? '')}</pre></div>`
        : `<div class="content">
        <h3>No profiling data available</h3>
        <p>${esc(data.reason ?? 'No Prof.Counts/Prof.Decl/Prof.CallPair files were found in the workspace root.')}</p>
        <p>To profile a Mercury program:</p>
        <ol>
          <li>Rebuild with a profiling grade, e.g. <code>mmc --make --grade asm_fast.gc.prof yourprogram</code> (or add <code>--profiling</code> to <code>GRADEFLAGS</code> in your Mmakefile). For much more detailed call-tree data, use <code>--deep-profiling</code> instead (see docs/compiler-integration.md) — note deep profiling isn't compatible with the classic profiling grades and isn't available for every backend.</li>
          <li>Run the resulting executable on representative input. On normal termination it writes <code>Prof.Counts</code>, <code>Prof.Decl</code>, and <code>Prof.CallPair</code> to the current directory.</li>
          <li>Run "Mercury: Open Performance Profile" again from that directory.</li>
        </ol>
        <p class="muted">This extension only displays what <code>mprof</code> itself reports; it does not simulate or estimate profiling data.</p>
      </div>`;
    panel.webview.html = htmlShell(panel.webview, body, '');
}
