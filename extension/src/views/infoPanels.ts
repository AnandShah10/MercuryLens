import * as vscode from 'vscode';
import { htmlShell } from './webviewUtils';

export interface SymbolInfoForPanel {
    kind: string;
    name: string;
    arity?: number;
    determinism?: string;
    purity?: string;
    args?: { raw: string; type?: string; mode?: string }[];
    typeDefinition?: string;
    doc?: string;
    callers?: number;
    references?: number;
}

function esc(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Renders instantiation-state text for a mode, using only well-defined
 * Mercury semantics (in = already ground; out = free -> ground on success;
 * di/uo = a "unique"/destructively-updated state pair). Anything outside
 * these standard modes is shown as-is rather than guessed. */
function instantiationFor(mode?: string): string {
    switch (mode) {
        case 'in': return 'ground (must already be bound on entry)';
        case 'out': return 'free \u2192 ground (unbound on entry, bound on success)';
        case 'di': return 'unique \u2192 clobbered (destructively updated; e.g. an I/O state)';
        case 'uo': return 'free \u2192 unique (freshly produced unique value; e.g. an I/O state)';
        case 'mdi': return 'mostly-unique \u2192 clobbered';
        case 'muo': return 'free \u2192 mostly-unique';
        case 'unused': return 'not used by this mode of the predicate';
        default: return mode ? `(compound/user-defined mode: ${mode})` : '(mode not specified in this declaration)';
    }
}

export function createModeInformationPanel(info: SymbolInfoForPanel): void {
    const panel = vscode.window.createWebviewPanel('mercuryModeInfo', `Mercury Mode Info: ${info.name}`, vscode.ViewColumn.Beside, { enableScripts: false });
    const rows = (info.args ?? [])
        .map((a, i) => `<tr><td>${i + 1}</td><td><code>${esc(a.type ?? '(unspecified)')}</code></td><td><code>${esc(a.mode ?? '(unspecified)')}</code></td><td>${esc(instantiationFor(a.mode))}</td></tr>`)
        .join('\n');
    const body = `
    <div class="content">
      <h2>${esc(info.name)}${info.arity !== undefined ? '/' + info.arity : ''}</h2>
      <p><strong>Determinism:</strong> ${esc(info.determinism ?? 'unknown (no "is <det>" found in the declaration this extension parsed)')}<br/>
         <strong>Purity:</strong> ${esc(info.purity ?? 'pure')}</p>
      ${info.doc ? `<p>${esc(info.doc)}</p>` : ''}
      <table style="width:100%; border-collapse:collapse;">
        <thead><tr><th>#</th><th>Type</th><th>Mode</th><th>Instantiation</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="4" class="muted">No arguments.</td></tr>'}</tbody>
      </table>
    </div>`;
    panel.webview.html = htmlShell(panel.webview, body, '', 'table, th, td { border: 1px solid var(--vscode-panel-border); padding: 6px; }');
}

export function createTypeInformationPanel(info: SymbolInfoForPanel): void {
    const panel = vscode.window.createWebviewPanel('mercuryTypeInfo', `Mercury Type Info: ${info.name}`, vscode.ViewColumn.Beside, { enableScripts: false });
    const body = `
    <div class="content">
      <h2>${esc(info.name)}${info.arity !== undefined ? '/' + info.arity : ''}</h2>
      ${info.typeDefinition
        ? `<p><strong>Definition:</strong></p><pre>${esc(info.typeDefinition)}</pre>`
        : `<p class="muted">This is an abstract type in this module (no constructors visible here), or the requested identifier is not a type declared in the indexed workspace.</p>`}
      ${info.doc ? `<p>${esc(info.doc)}</p>` : ''}
      <p class="muted">Declared, syntactic type information only. Full inferred types for arbitrary expressions require the compiler's own type checker, which this extension does not reimplement; use "Mercury: Check Project" for compiler-verified type errors.</p>
    </div>`;
    panel.webview.html = htmlShell(panel.webview, body, '');
}

export function createDeterminismPanel(info: SymbolInfoForPanel): void {
    const panel = vscode.window.createWebviewPanel('mercuryDeterminismInfo', `Mercury Determinism: ${info.name}`, vscode.ViewColumn.Beside, { enableScripts: false });
    const DET_DOCS: Record<string, string> = {
        det: 'Succeeds exactly once. Never fails, never produces multiple solutions.',
        semidet: 'Succeeds at most once. May fail.',
        multi: 'Succeeds one or more times. Never fails.',
        nondet: 'Succeeds zero or more times. May fail.',
        failure: 'Never succeeds.',
        erroneous: 'Never returns (always throws/aborts).',
        cc_multi: '"Committed-choice" multi: logically may have multiple solutions, but only the first is committed to.',
        cc_nondet: '"Committed-choice" nondet: logically may have multiple solutions and may fail, but only the first solution found is committed to.',
    };
    const det = info.determinism;
    const body = `
    <div class="content">
      <h2>${esc(info.name)}${info.arity !== undefined ? '/' + info.arity : ''}</h2>
      <p><strong>Determinism:</strong> ${esc(det ?? 'unknown')}</p>
      <p>${det && DET_DOCS[det] ? esc(DET_DOCS[det]) : 'No determinism was declared (or found) for this predicate/function in the indexed source.'}</p>
      <p><strong>Purity:</strong> ${esc(info.purity ?? 'pure')}</p>
      <p><strong>Callers (heuristic, static-text call graph):</strong> ${info.callers ?? 0}</p>
      <p><strong>References:</strong> ${info.references ?? 0}</p>
      <p class="muted">Determinism shown here is read from this predicate's ':- pred'/':- func' declaration. Run "Mercury: Check Project" to have the real compiler verify the implementation actually satisfies it.</p>
    </div>`;
    panel.webview.html = htmlShell(panel.webview, body, '');
}
