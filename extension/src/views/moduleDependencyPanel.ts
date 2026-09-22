import * as vscode from 'vscode';
import { htmlShell } from './webviewUtils';

export interface ModuleDependencyData {
    /** Edges derived from real compiler output (mmc --generate-dependencies), when available. */
    compilerEdges: { from: string; to: string[] }[];
    /** Fallback/supplementary edges derived from indexed `:- import_module`/`:- use_module` declarations. */
    importEdges: { from: string; to: string[] }[];
    usedCompiler: boolean;
    compilerError?: string;
}

function detectCycles(edges: Map<string, Set<string>>): string[][] {
    const cycles: string[][] = [];
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const stack: string[] = [];

    function dfs(node: string): void {
        visiting.add(node);
        stack.push(node);
        for (const next of edges.get(node) ?? []) {
            if (visiting.has(next)) {
                const idx = stack.indexOf(next);
                if (idx >= 0) cycles.push(stack.slice(idx).concat(next));
            } else if (!visited.has(next)) {
                dfs(next);
            }
        }
        stack.pop();
        visiting.delete(node);
        visited.add(node);
    }
    for (const node of edges.keys()) if (!visited.has(node)) dfs(node);
    return cycles;
}

export function createModuleDependencyPanel(data: ModuleDependencyData): void {
    const panel = vscode.window.createWebviewPanel('mercuryModuleDeps', 'Mercury: Module Dependencies', vscode.ViewColumn.Beside, {
        enableScripts: true,
        retainContextWhenHidden: true,
    });
    panel.webview.html = render(panel.webview, data);
}

function esc(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function render(webview: vscode.Webview, data: ModuleDependencyData): string {
    const edgeList = data.usedCompiler && data.compilerEdges.length > 0 ? data.compilerEdges : data.importEdges;
    const edgeMap = new Map<string, Set<string>>();
    for (const e of edgeList) {
        if (!edgeMap.has(e.from)) edgeMap.set(e.from, new Set());
        for (const t of e.to) edgeMap.get(e.from)!.add(t);
    }
    const allModules = new Set<string>();
    for (const [from, tos] of edgeMap) {
        allModules.add(from);
        for (const t of tos) allModules.add(t);
    }
    const cycles = detectCycles(edgeMap);

    const rows = [...allModules].sort().map((m) => {
        const deps = [...(edgeMap.get(m) ?? [])].sort();
        return `<tr><td><code>${esc(m)}</code></td><td>${deps.length ? deps.map((d) => `<code>${esc(d)}</code>`).join(', ') : '<span class="muted">(none indexed)</span>'}</td></tr>`;
    }).join('\n');

    const cycleHtml = cycles.length
        ? `<div class="content"><h4>⚠ Circular dependencies detected</h4>${cycles
              .map((c) => `<pre>${esc(c.join(' → '))}</pre>`)
              .join('')}<p class="muted">A cycle among Mercury modules usually means the module boundaries should be reconsidered, or that the shared parts belong in a common module both can import. Mercury does allow mutually-recursive submodules within a single source file (nested modules), so a cycle is only a real problem for otherwise-independent top-level modules.</p></div>`
        : `<div class="content"><p class="muted">No circular dependencies detected among indexed modules.</p></div>`;

    const source = data.usedCompiler && data.compilerEdges.length > 0
        ? `<span class="muted">Source: <code>mmc --generate-dependencies</code> (compiler-backed).</span>`
        : `<span class="muted">Source: <code>:- import_module</code> / <code>:- use_module</code> declarations indexed from the workspace${data.compilerError ? ` (compiler dependency generation was unavailable: ${esc(data.compilerError)})` : ''}.</span>`;

    const body = `
    <div class="toolbar">${source}</div>
    ${cycleHtml}
    <div class="content">
      <table style="width:100%; border-collapse: collapse;">
        <thead><tr><th style="text-align:left; border-bottom:1px solid var(--vscode-panel-border); padding:4px;">Module</th><th style="text-align:left; border-bottom:1px solid var(--vscode-panel-border); padding:4px;">Depends on</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
    return htmlShell(webview, body, '', 'td { padding: 4px; vertical-align: top; border-bottom: 1px solid var(--vscode-panel-border); }');
}
