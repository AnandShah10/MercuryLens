import * as vscode from 'vscode';

/**
 * Diagnostics are entirely computed and published by the language server
 * (see docs/language-server.md's "Diagnostics pipeline") — VS Code's
 * Problems panel already shows them natively, so there's nothing for the
 * extension host to compute here. This tree view is purely a convenience
 * mirror of the Problems panel scoped to Mercury files, listed per-file in
 * the dedicated "Mercury" sidebar rather than mixed in with every other
 * language's diagnostics.
 */
export class MercuryDiagnosticsProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    constructor() {
        vscode.languages.onDidChangeDiagnostics(() => this._onDidChangeTreeData.fire());
    }

    getChildren(element?: vscode.TreeItem): vscode.TreeItem[] {
        if (element) return [];
        const items: vscode.TreeItem[] = [];
        for (const [uri, diags] of vscode.languages.getDiagnostics()) {
            if (!uri.path.endsWith('.m') || diags.length === 0) continue;
            const fileItem = new vscode.TreeItem(vscode.workspace.asRelativePath(uri), vscode.TreeItemCollapsibleState.None);
            fileItem.description = `${diags.length} issue${diags.length === 1 ? '' : 's'}`;
            fileItem.command = { title: 'Open', command: 'vscode.open', arguments: [uri] };
            fileItem.iconPath = new vscode.ThemeIcon(diags.some((d) => d.severity === vscode.DiagnosticSeverity.Error) ? 'error' : 'warning');
            items.push(fileItem);
        }
        return items.length ? items : [new vscode.TreeItem('No Mercury diagnostics.')];
    }

    getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
        return element;
    }
}
