import * as vscode from 'vscode';
import { htmlShell } from './webviewUtils';
import { CallGraphVerification } from '../compiler/verifyCallGraph';

export interface CallGraphData {
    nodes: { id: string; name: string; module?: string; arity?: number; uri: string; line: number }[];
    edges: { from: string; to: string }[];
}

export function createCallGraphPanel(data: CallGraphData, initialModuleFilter: string | undefined, verification?: CallGraphVerification): vscode.WebviewPanel {
    const panel = vscode.window.createWebviewPanel('mercuryCallGraph', 'Mercury: Predicate Call Graph', vscode.ViewColumn.Beside, {
        enableScripts: true,
        retainContextWhenHidden: true,
    });
    panel.webview.onDidReceiveMessage(async (msg: { type: string; uri?: string; line?: number }) => {
        if (msg.type === 'openNode' && msg.uri) {
            const doc = await vscode.workspace.openTextDocument(vscode.Uri.parse(msg.uri));
            const editor = await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);
            const line = msg.line ?? 0;
            const pos = new vscode.Position(line, 0);
            editor.selection = new vscode.Selection(pos, pos);
            editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
        }
    });
    panel.webview.html = render(panel.webview, data, initialModuleFilter, verification);
    return panel;
}

function layout(data: CallGraphData): { positions: Map<string, { x: number; y: number }>; width: number; height: number } {
    const incoming = new Map<string, number>();
    for (const n of data.nodes) incoming.set(n.id, 0);
    for (const e of data.edges) incoming.set(e.to, (incoming.get(e.to) ?? 0) + 1);

    const level = new Map<string, number>();
    const queue: string[] = data.nodes.filter((n) => (incoming.get(n.id) ?? 0) === 0).map((n) => n.id);
    for (const id of queue) level.set(id, 0);
    const adj = new Map<string, string[]>();
    for (const e of data.edges) {
        if (!adj.has(e.from)) adj.set(e.from, []);
        adj.get(e.from)!.push(e.to);
    }
    const visited = new Set<string>(queue);
    let i = 0;
    const MAX_ITERS = data.nodes.length * 4 + 10;
    let iters = 0;
    while (i < queue.length && iters < MAX_ITERS) {
        iters++;
        const cur = queue[i++];
        const curLevel = level.get(cur) ?? 0;
        for (const next of adj.get(cur) ?? []) {
            const proposed = curLevel + 1;
            if (!visited.has(next) || (level.get(next) ?? 0) < proposed) {
                level.set(next, Math.max(level.get(next) ?? 0, proposed));
                if (!visited.has(next)) {
                    visited.add(next);
                    queue.push(next);
                }
            }
        }
    }
    // any remaining unvisited nodes (pure cycles with no zero-indegree entry) get level 0
    for (const n of data.nodes) if (!level.has(n.id)) level.set(n.id, 0);

    const levels = new Map<number, string[]>();
    for (const n of data.nodes) {
        const l = level.get(n.id) ?? 0;
        if (!levels.has(l)) levels.set(l, []);
        levels.get(l)!.push(n.id);
    }
    const NODE_W = 180, NODE_H = 44, H_GAP = 60, V_GAP = 40;
    const positions = new Map<string, { x: number; y: number }>();
    let maxWidth = 0;
    const maxLevel = Math.max(0, ...[...levels.keys()]);
    for (let l = 0; l <= maxLevel; l++) {
        const ids = levels.get(l) ?? [];
        ids.forEach((id, idx) => {
            positions.set(id, { x: idx * (NODE_W + H_GAP) + 40, y: l * (NODE_H + V_GAP) + 40 });
        });
        maxWidth = Math.max(maxWidth, ids.length * (NODE_W + H_GAP));
    }
    return { positions, width: maxWidth + 80, height: (maxLevel + 1) * (NODE_H + V_GAP) + 80 };
}

function esc(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function render(webview: vscode.Webview, data: CallGraphData, initialModuleFilter: string | undefined, verification?: CallGraphVerification): string {
    const { positions, width, height } = layout(data);
    const NODE_W = 180, NODE_H = 44;
    const modules = [...new Set(data.nodes.map((n) => n.module).filter((m): m is string => !!m))].sort();
    const flagged = verification?.flaggedPredicates ?? new Set<string>();

    const nodesSvg = data.nodes
        .map((n) => {
            const pos = positions.get(n.id) ?? { x: 0, y: 0 };
            const label = `${n.name}/${n.arity ?? '?'}`;
            // Mercury sometimes reports a function's arity as its argument
            // count and sometimes as that count plus one (its internal
            // predicate-style translation, which folds the return value
            // into the argument list) depending on the diagnostic — check
            // both so a real match isn't missed for either convention.
            const candidateKeys = n.arity !== undefined ? [`${n.name}/${n.arity}`, `${n.name}/${Math.max(0, n.arity - 1)}`] : [`${n.name}/`];
            const isFlagged = candidateKeys.some((k) => flagged.has(k));
            const stroke = isFlagged ? 'var(--vscode-editorError-foreground, #f14c4c)' : 'var(--vscode-widget-border, #888)';
            const strokeWidth = isFlagged ? '2' : '1';
            const warningMark = isFlagged
                ? `<text x="${NODE_W - 14}" y="16" font-size="13" fill="var(--vscode-editorError-foreground, #f14c4c)">⚠</text>`
                : '';
            const titleSuffix = isFlagged ? ' — mmc reported a problem naming this predicate/function; see Problems panel.' : '';
            return `<g class="node" data-id="${esc(n.id)}" data-module="${esc(n.module ?? '')}" data-uri="${esc(n.uri)}" data-line="${n.line}" transform="translate(${pos.x},${pos.y})">
        <rect width="${NODE_W}" height="${NODE_H}" rx="6" fill="var(--vscode-editorWidget-background)" stroke="${stroke}" stroke-width="${strokeWidth}"/>
        ${warningMark}
        <text x="${NODE_W / 2}" y="${NODE_H / 2 + 4}" text-anchor="middle" font-size="12" fill="var(--vscode-editor-foreground)">${esc(label)}</text>
        <title>${esc(n.module ?? '(unknown module)')}.${esc(label)}${titleSuffix}</title>
      </g>`;
        })
        .join('\n');

    const edgesSvg = data.edges
        .map((e) => {
            const from = positions.get(e.from);
            const to = positions.get(e.to);
            if (!from || !to) return '';
            const x1 = from.x + NODE_W / 2, y1 = from.y + NODE_H;
            const x2 = to.x + NODE_W / 2, y2 = to.y;
            const midY = (y1 + y2) / 2;
            return `<path class="edge" data-from="${esc(e.from)}" data-to="${esc(e.to)}" d="M${x1},${y1} C${x1},${midY} ${x2},${midY} ${x2},${y2}" fill="none" stroke="var(--vscode-charts-blue, #6a9fd8)" stroke-width="1.5" marker-end="url(#arrow)"/>`;
        })
        .join('\n');

    const verificationLine = !verification || !verification.ranByCompiler
        ? `No Mercury compiler was found to cross-check this graph against${verification?.error ? ` (${esc(verification.error)})` : ''} — showing the unverified static-text heuristic only.`
        : verification.compilesCleanly && flagged.size === 0
            ? `Cross-checked against mmc --errorcheck-only: the workspace compiles cleanly and no predicate/function shown here was named in a compiler error.`
            : `Cross-checked against mmc --errorcheck-only: ${flagged.size} predicate/function${flagged.size === 1 ? '' : 's'} shown here (marked ⚠) ${flagged.size === 1 ? 'was' : 'were'} named in a real compiler diagnostic — see the Problems panel for details.`;
    const verificationCaveat = verification?.ranByCompiler
        ? ` A clean compile confirms the program as a whole is correct; it does not by itself prove every edge below points at the exact overload mmc resolved when a name has more than one same-arity candidate.`
        : '';

    const body = `
    <div class="toolbar">
      <input id="search" type="text" placeholder="Search predicate..." />
      <select id="moduleFilter">
        <option value="">All modules</option>
        ${modules.map((m) => `<option value="${esc(m)}" ${m === initialModuleFilter ? 'selected' : ''}>${esc(m)}</option>`).join('')}
      </select>
      <button id="zoomIn">Zoom in</button>
      <button id="zoomOut">Zoom out</button>
      <button id="reset">Reset view</button>
      <span class="muted">${data.nodes.length} predicates/functions, ${data.edges.length} call edges — heuristic, static-text call graph (see docs/architecture.md). ${verificationLine}${verificationCaveat}</span>
    </div>
    <div id="viewport" style="width:100%; height:calc(100vh - 46px); overflow:hidden; cursor:grab;">
      <svg id="canvas" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" style="transform-origin: 0 0;">
        <defs>
          <marker id="arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
            <path d="M0,0 L8,4 L0,8 Z" fill="var(--vscode-charts-blue, #6a9fd8)"/>
          </marker>
        </defs>
        <g id="edges">${edgesSvg}</g>
        <g id="nodes">${nodesSvg}</g>
      </svg>
    </div>`;

    const script = `
    const viewport = document.getElementById('viewport');
    const canvas = document.getElementById('canvas');
    let scale = 1, panX = 0, panY = 0, dragging = false, lastX = 0, lastY = 0;
    function applyTransform() { canvas.style.transform = 'translate(' + panX + 'px,' + panY + 'px) scale(' + scale + ')'; }
    viewport.addEventListener('mousedown', (e) => { dragging = true; lastX = e.clientX; lastY = e.clientY; viewport.style.cursor = 'grabbing'; });
    window.addEventListener('mouseup', () => { dragging = false; viewport.style.cursor = 'grab'; });
    window.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      panX += e.clientX - lastX; panY += e.clientY - lastY; lastX = e.clientX; lastY = e.clientY;
      applyTransform();
    });
    viewport.addEventListener('wheel', (e) => {
      e.preventDefault();
      scale = Math.min(3, Math.max(0.2, scale + (e.deltaY < 0 ? 0.1 : -0.1)));
      applyTransform();
    }, { passive: false });
    document.getElementById('zoomIn').addEventListener('click', () => { scale = Math.min(3, scale + 0.2); applyTransform(); });
    document.getElementById('zoomOut').addEventListener('click', () => { scale = Math.max(0.2, scale - 0.2); applyTransform(); });
    document.getElementById('reset').addEventListener('click', () => { scale = 1; panX = 0; panY = 0; applyTransform(); });

    for (const node of document.querySelectorAll('.node')) {
      node.addEventListener('click', () => {
        vscode.postMessage({ type: 'openNode', uri: node.getAttribute('data-uri'), line: parseInt(node.getAttribute('data-line'), 10) });
      });
    }

    const search = document.getElementById('search');
    const moduleFilter = document.getElementById('moduleFilter');
    function applyFilter() {
      const q = search.value.trim().toLowerCase();
      const mod = moduleFilter.value;
      for (const node of document.querySelectorAll('.node')) {
        const text = node.textContent.toLowerCase();
        const nodeModule = node.getAttribute('data-module');
        const matches = (!q || text.includes(q)) && (!mod || nodeModule === mod);
        node.style.opacity = matches ? '1' : '0.15';
      }
    }
    search.addEventListener('input', applyFilter);
    moduleFilter.addEventListener('change', applyFilter);
    applyFilter();
  `;

    return htmlShell(webview, body, script);
}
