import * as vscode from 'vscode';

/** Compiler status view: shows detection status as a flat informational list. */
export class MercuryCompilerStatusProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
    private status: { found: boolean; executable?: string; version?: string; error?: string } | undefined;

    setStatus(status: { found: boolean; executable?: string; version?: string; error?: string }): void {
        this.status = status;
        this._onDidChangeTreeData.fire();
    }

    getChildren(): vscode.TreeItem[] {
        if (!this.status) return [new vscode.TreeItem('Detecting Mercury compiler…')];
        if (!this.status.found) {
            const item = new vscode.TreeItem(this.status.error ?? 'mmc not found');
            item.iconPath = new vscode.ThemeIcon('warning');
            return [item];
        }
        const pathItem = new vscode.TreeItem(`Compiler: ${this.status.executable}`);
        pathItem.iconPath = new vscode.ThemeIcon('check');
        const items = [pathItem];
        if (this.status.version) items.push(new vscode.TreeItem(`Version: ${this.status.version}`));
        return items;
    }

    getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
        return element;
    }
}
