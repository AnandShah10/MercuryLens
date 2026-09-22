import * as vscode from 'vscode';
import { htmlShell } from './webviewUtils';
import { WireModuleDoc } from '../utils/wireTypes';
export { WireModuleDoc } from '../utils/wireTypes';

export function createAstExplorerPanel(uri: vscode.Uri, sourceText: string, doc: WireModuleDoc): void {
    const panel = vscode.window.createWebviewPanel('mercuryAstExplorer', `Mercury AST — ${uri.path.split('/').pop()}`, vscode.ViewColumn.Beside, {
        enableScripts: true,
        retainContextWhenHidden: true,
    });
    panel.webview.onDidReceiveMessage((msg: { type: string; text?: string }) => {
        if (msg.type === 'copyAst' && msg.text) {
            void vscode.env.clipboard.writeText(msg.text);
            void vscode.window.showInformationMessage('AST copied as JSON.');
        }
    });
    panel.webview.html = render(panel.webview, sourceText, doc);
}

function esc(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

interface AstItem {
    label: string;
    range: { startLine: number; startCol: number; endLine: number; endCol: number };
    detail?: string;
    children?: AstItem[];
}

function buildAstTree(doc: WireModuleDoc): AstItem[] {
    const items: AstItem[] = [];
    for (const sym of doc.symbols) {
        items.push({
            label: `${sym.kind}: ${sym.name}${sym.arity !== undefined ? '/' + sym.arity : ''}`,
            range: sym.range,
            detail: sym.raw.length > 200 ? sym.raw.slice(0, 200) + '…' : sym.raw,
            children: (sym.args ?? []).map((a, i) => ({
                label: `arg ${i + 1}: ${a.raw}`,
                range: sym.range,
            })),
        });
    }
    for (const clause of doc.clauses) {
        items.push({
            label: `clause: ${clause.name}/${clause.arity}`,
            range: clause.range,
            detail: clause.raw.length > 300 ? clause.raw.slice(0, 300) + '…' : clause.raw,
            children: clause.calls.map((c) => ({ label: `call: ${c.name}`, range: c.range })),
        });
    }
    items.sort((a, b) => a.range.startLine - b.range.startLine);
    return items;
}

function renderTree(items: AstItem[], idPrefix: string): string {
    return items
        .map((item, i) => {
            const id = `${idPrefix}-${i}`;
            const hasChildren = item.children && item.children.length > 0;
            return `<li>
        <div class="ast-node" data-id="${id}" data-start-line="${item.range.startLine}" data-start-col="${item.range.startCol}" data-end-line="${item.range.endLine}" data-end-col="${item.range.endCol}">
          ${hasChildren ? '<span class="twisty">▸</span>' : '<span class="twisty" style="visibility:hidden">▸</span>'} ${esc(item.label)}
        </div>
        ${item.detail ? `<pre class="detail" style="display:none">${esc(item.detail)}</pre>` : ''}
        ${hasChildren ? `<ul style="display:none">${renderTree(item.children!, id)}</ul>` : ''}
      </li>`;
        })
        .join('\n');
}

function render(webview: vscode.Webview, sourceText: string, doc: WireModuleDoc): string {
    const tree = buildAstTree(doc);
    const lines = sourceText.split(/\r\n|\n/);
    const sourceHtml = lines.map((l, i) => `<div class="src-line" data-line="${i}"><span class="ln">${i + 1}</span><span class="txt">${esc(l) || ' '}</span></div>`).join('\n');

    const body = `
    <div class="toolbar">
      <input id="search" placeholder="Search AST nodes..." />
      <button id="copyAst">Copy AST as JSON</button>
      <span class="muted">Structural AST (declarations, clause heads, call sites) — not a full compiler parse tree. See docs/architecture.md.</span>
    </div>
    <div style="display:flex; height:calc(100vh - 46px);">
      <div id="sourcePane" style="flex:1; overflow:auto; border-right:1px solid var(--vscode-panel-border); font-family: var(--vscode-editor-font-family); font-size: 13px;">${sourceHtml}</div>
      <div id="astPane" style="flex:1; overflow:auto; padding: 8px;"><ul id="astRoot">${renderTree(tree, 'n')}</ul></div>
    </div>`;

    const astJson = JSON.stringify(doc, null, 2);
    const script = `
    const astData = ${JSON.stringify(astJson)};
    document.getElementById('copyAst').addEventListener('click', () => vscode.postMessage({ type: 'copyAst', text: astData }));

    for (const el of document.querySelectorAll('.ast-node')) {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const parentLi = el.closest('li');
        const childUl = parentLi.querySelector(':scope > ul');
        const detail = parentLi.querySelector(':scope > .detail');
        const twisty = el.querySelector('.twisty');
        if (childUl) {
          const showing = childUl.style.display !== 'none';
          childUl.style.display = showing ? 'none' : 'block';
          if (twisty) twisty.textContent = showing ? '▸' : '▾';
        } else if (detail) {
          detail.style.display = detail.style.display === 'none' ? 'block' : 'none';
        }
        document.querySelectorAll('.src-line.highlight').forEach((n) => n.classList.remove('highlight'));
        const startLine = parseInt(el.getAttribute('data-start-line'), 10);
        const endLine = parseInt(el.getAttribute('data-end-line'), 10);
        for (let i = startLine; i <= endLine; i++) {
          const lineEl = document.querySelector('.src-line[data-line="' + i + '"]');
          if (lineEl) lineEl.classList.add('highlight');
        }
        const first = document.querySelector('.src-line[data-line="' + startLine + '"]');
        if (first) first.scrollIntoView({ block: 'center' });
      });
    }
    for (const el of document.querySelectorAll('.src-line')) {
      el.addEventListener('click', () => {
        const line = parseInt(el.getAttribute('data-line'), 10);
        let best = null;
        for (const node of document.querySelectorAll('.ast-node')) {
          const s = parseInt(node.getAttribute('data-start-line'), 10);
          const en = parseInt(node.getAttribute('data-end-line'), 10);
          if (line >= s && line <= en) { best = node; }
        }
        if (best) { best.scrollIntoView({ block: 'center' }); best.style.background = 'var(--vscode-editor-selectionBackground)'; setTimeout(() => best.style.background = '', 800); }
      });
    }
    document.getElementById('search').addEventListener('input', (e) => {
      const q = e.target.value.toLowerCase();
      for (const li of document.querySelectorAll('#astRoot li')) {
        const label = li.querySelector('.ast-node').textContent.toLowerCase();
        li.style.display = (!q || label.includes(q)) ? '' : 'none';
      }
    });
  `;

    return htmlShell(
        webview,
        body,
        script,
        `.src-line { display:flex; padding: 0 4px; white-space: pre; cursor: pointer; }
     .src-line .ln { width: 40px; color: var(--vscode-editorLineNumber-foreground); user-select: none; text-align: right; margin-right: 8px; }
     .src-line.highlight { background: var(--vscode-editor-selectionBackground); }
     .src-line:hover { background: var(--vscode-list-hoverBackground); }
     ul { list-style: none; padding-left: 16px; }
     .ast-node { cursor: pointer; padding: 2px 0; }
     .ast-node:hover { background: var(--vscode-list-hoverBackground); }
     .twisty { display: inline-block; width: 12px; }`,
    );
}
