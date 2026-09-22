import * as vscode from 'vscode';
import { LanguageClient } from 'vscode-languageclient/node';

interface WireSymbol {
    kind: string;
    name: string;
    arity?: number;
    module?: string;
}
interface WireModuleDoc {
    uri: string;
    moduleName?: string;
    symbols: WireSymbol[];
}

export class MercuryExplorerItem extends vscode.TreeItem {
    constructor(
        label: string,
        collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly kind: 'module' | 'category' | 'symbol',
        public readonly uri?: vscode.Uri,
        public readonly line?: number,
    ) {
        super(label, collapsibleState);
        if (kind === 'symbol' && uri) {
            this.command = { title: 'Open', command: 'vscode.open', arguments: [uri, { selection: new vscode.Range(line ?? 0, 0, line ?? 0, 0) }] };
        }
    }
}

/** Workspace view: Module -> {Predicates, Functions, Types, Typeclasses} -> symbol. */
export class MercuryWorkspaceProvider implements vscode.TreeDataProvider<MercuryExplorerItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<MercuryExplorerItem | undefined>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
    private docs: WireModuleDoc[] = [];

    constructor(private client: () => LanguageClient | undefined) {}

    refresh(): void {
        this._onDidChangeTreeData.fire(undefined);
    }

    async getChildren(element?: MercuryExplorerItem): Promise<MercuryExplorerItem[]> {
        const client = this.client();
        if (!client) return [];
        if (!element) {
            // top level: one item per indexed module
            this.docs = await Promise.all(
                (await vscode.workspace.findFiles('**/*.m', '**/{node_modules,Mercury}/**')).map(async (uri) => {
                    return client.sendRequest<WireModuleDoc | null>('mercury/moduleDoc', { uri: uri.toString() });
                }),
            ).then((results) => results.filter((r): r is WireModuleDoc => !!r));
            return this.docs
                .filter((d) => d.moduleName)
                .map((d) => new MercuryExplorerItem(d.moduleName as string, vscode.TreeItemCollapsibleState.Collapsed, 'module', vscode.Uri.parse(d.uri)));
        }
        if (element.kind === 'module') {
            const doc = this.docs.find((d) => d.moduleName === element.label);
            if (!doc) return [];
            const categories: { label: string; kinds: string[] }[] = [
                { label: 'Predicates', kinds: ['predicate'] },
                { label: 'Functions', kinds: ['function'] },
                { label: 'Types', kinds: ['type'] },
                { label: 'Type classes / Instances', kinds: ['typeclass', 'instance'] },
            ];
            return categories
                .filter((c) => doc.symbols.some((s) => c.kinds.includes(s.kind)))
                .map((c) => new MercuryExplorerItem(c.label, vscode.TreeItemCollapsibleState.Collapsed, 'category', element.uri));
        }
        if (element.kind === 'category') {
            const doc = this.docs.find((d) => d.uri === element.uri?.toString());
            if (!doc) return [];
            const kinds = element.label === 'Predicates' ? ['predicate'] : element.label === 'Functions' ? ['function'] : element.label === 'Types' ? ['type'] : ['typeclass', 'instance'];
            return doc.symbols
                .filter((s) => kinds.includes(s.kind))
                .map((s) => new MercuryExplorerItem(s.arity !== undefined ? `${s.name}/${s.arity}` : s.name, vscode.TreeItemCollapsibleState.None, 'symbol', element.uri, 0));
        }
        return [];
    }

    getTreeItem(element: MercuryExplorerItem): vscode.TreeItem {
        return element;
    }
}
