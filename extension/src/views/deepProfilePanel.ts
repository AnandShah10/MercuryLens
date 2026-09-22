import * as vscode from 'vscode';
import { runMdprofCgi } from '../utils/mdprofCgi';

/**
 * Renders real `mdprof_cgi` HTML output and lets the user click through its
 * own links: every click is intercepted, the link's query portion is sent
 * back to the extension host, which re-invokes `mdprof_cgi` with that as
 * the new `QUERY_STRING` and pushes the resulting HTML back into the panel.
 * See extension/src/utils/mdprofCgi.ts for why this works without a web
 * server. External links (anything not pointing back at the CGI script
 * itself) are opened in the system browser instead of being fetched.
 *
 * Scripts are disabled in the rendered content itself (stripped below) —
 * only this panel's own small nonce'd navigation script runs. mdprof_cgi's
 * output is plain HTML/tables in every version this was checked against;
 * stripping <script> defensively costs nothing since the tool never relies
 * on client-side script to render its tables.
 */
export function createDeepProfilePanel(cwd: string, dataFilePath: string): void {
    const panel = vscode.window.createWebviewPanel('mercuryDeepProfile', 'Mercury: Deep Profile', vscode.ViewColumn.Beside, {
        enableScripts: true,
        retainContextWhenHidden: true,
    });

    async function load(query: string): Promise<void> {
        panel.webview.html = renderLoading();
        const result = await runMdprofCgi(cwd, query);
        if (!result.ok) {
            panel.webview.html = renderError(result.error ?? 'Unknown error running mdprof_cgi.');
            return;
        }
        panel.webview.html = renderPage(panel.webview, result.html ?? '');
    }

    panel.webview.onDidReceiveMessage(async (msg: { type: string; query?: string; url?: string }) => {
        if (msg.type === 'followLink' && msg.query !== undefined) {
            await load(msg.query);
        } else if (msg.type === 'openExternal' && msg.url) {
            void vscode.env.openExternal(vscode.Uri.parse(msg.url));
        } else if (msg.type === 'home') {
            await load(dataFilePath);
        }
    });

    void load(dataFilePath);
}

function renderLoading(): string {
    return `<!DOCTYPE html><html><body style="font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); padding: 16px;">Running mdprof_cgi…</body></html>`;
}

function renderError(message: string): string {
    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return `<!DOCTYPE html><html><body style="font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); padding: 16px;">
    <h3>Could not load the deep profile</h3><pre>${esc(message)}</pre>
    <p>See docs/compiler-integration.md#profiling for how to produce deep-profiling data and ensure <code>mdprof_cgi</code> is on PATH.</p>
    </body></html>`;
}

function renderPage(webview: vscode.Webview, rawHtml: string): string {
    // Extract just the body content (mdprof_cgi emits full <html> documents).
    const bodyMatch = rawHtml.match(/<body[^>]*>([\s\S]*)<\/body>/i);
    let body = bodyMatch ? bodyMatch[1] : rawHtml;
    // Defensively strip scripts/styles/meta/base tags from the tool's own
    // output; we provide our own styling and navigation script instead.
    body = body
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<meta[^>]*>/gi, '')
        .replace(/<base[^>]*>/gi, '');

    const nonce = Array.from({ length: 32 }, () => 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 62)]).join('');
    const csp = [`default-src 'none'`, `style-src ${webview.cspSource} 'unsafe-inline'`, `script-src 'nonce-${nonce}'`].join('; ');

    return `<!DOCTYPE html>
<html>
<head>
<meta http-equiv="Content-Security-Policy" content="${csp}">
<style>
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); padding: 12px; }
  table { border-collapse: collapse; }
  td, th { border: 1px solid var(--vscode-panel-border); padding: 4px 8px; }
  a { color: var(--vscode-textLink-foreground); cursor: pointer; }
  .toolbar { margin-bottom: 12px; }
  button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 4px 10px; border-radius: 2px; cursor: pointer; }
</style>
</head>
<body>
  <div class="toolbar"><button id="home">Home</button> <span style="color:var(--vscode-descriptionForeground)">Live mdprof_cgi output &mdash; links below re-run the real deep profiler.</span></div>
  ${body}
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    document.getElementById('home').addEventListener('click', () => vscode.postMessage({ type: 'home' }));
    document.body.addEventListener('click', (e) => {
      const a = e.target.closest('a');
      if (!a) return;
      e.preventDefault();
      const href = a.getAttribute('href') || '';
      if (/^https?:\\/\\//i.test(href)) {
        vscode.postMessage({ type: 'openExternal', url: href });
        return;
      }
      const qIdx = href.indexOf('?');
      const query = qIdx >= 0 ? href.slice(qIdx + 1) : href;
      vscode.postMessage({ type: 'followLink', query: decodeURIComponent(query) });
    });
  </script>
</body>
</html>`;
}
