import * as vscode from 'vscode';

/**
 * Creates a webview panel with a strict CSP: no remote resources, no
 * inline event handlers (scripts are loaded from a nonce-tagged <script>
 * tag only), and no eval. All panels created via this helper communicate
 * with their host extension code only through `postMessage`/`onDidReceiveMessage`
 * using the typed message contracts defined alongside each panel.
 */
export function createSecureWebviewPanel(
    viewType: string,
    title: string,
    extensionUri: vscode.Uri,
    column: vscode.ViewColumn = vscode.ViewColumn.Active,
): vscode.WebviewPanel {
    const panel = vscode.window.createWebviewPanel(viewType, title, column, {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')],
    });
    return panel;
}

export function nonce(): string {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) text += possible.charAt(Math.floor(Math.random() * possible.length));
    return text;
}

export function htmlShell(webview: vscode.Webview, bodyHtml: string, script: string, extraStyle = ''): string {
    const n = nonce();
    const csp = [
        `default-src 'none'`,
        `img-src ${webview.cspSource} data:`,
        `style-src ${webview.cspSource} 'unsafe-inline'`,
        `script-src 'nonce-${n}'`,
        `font-src ${webview.cspSource}`,
    ].join('; ');
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); padding: 0; margin: 0; }
    .toolbar { display: flex; gap: 8px; padding: 8px; border-bottom: 1px solid var(--vscode-panel-border); align-items: center; flex-wrap: wrap; }
    input, select, button { background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border, transparent); padding: 4px 8px; border-radius: 2px; }
    button { cursor: pointer; background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; }
    button:hover { background: var(--vscode-button-hoverBackground); }
    .content { padding: 12px; }
    pre { background: var(--vscode-textCodeBlock-background); padding: 8px; border-radius: 4px; overflow: auto; }
    .muted { color: var(--vscode-descriptionForeground); }
    .node { cursor: pointer; }
    .node:hover rect, .node:hover circle { stroke: var(--vscode-focusBorder); stroke-width: 2; }
    ${extraStyle}
  </style>
</head>
<body>
  ${bodyHtml}
  <script nonce="${n}">
    const vscode = acquireVsCodeApi();
    ${script}
  </script>
</body>
</html>`;
}
