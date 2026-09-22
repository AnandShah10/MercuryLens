import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import { LanguageClient } from 'vscode-languageclient/node';
import { createCallGraphPanel, CallGraphData } from '../views/callGraphPanel';
import { verifyCallGraph } from '../compiler/verifyCallGraph';
import { createModuleDependencyPanel, ModuleDependencyData } from '../views/moduleDependencyPanel';
import { createAstExplorerPanel, WireModuleDoc } from '../views/astExplorerPanel';
import { createModeInformationPanel, createTypeInformationPanel, createDeterminismPanel, SymbolInfoForPanel } from '../views/infoPanels';
import { createPerformanceProfilePanel } from '../views/performanceProfilePanel';
import { createDeepProfilePanel } from '../views/deepProfilePanel';
import { detectCompiler } from '../compiler/detector';
import { runProcess } from '../utils/process';
import { moduleNameForFile, findMainModuleCandidates } from '../workspace/projectDetector';

async function currentWordAndDoc(): Promise<{ uri: vscode.Uri; word: string } | undefined> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return undefined;
    const range = editor.document.getWordRangeAtPosition(editor.selection.active, /[A-Za-z_][A-Za-z0-9_.]*/);
    if (!range) { vscode.window.showInformationMessage('Place the cursor on a Mercury identifier first.'); return undefined; }
    return { uri: editor.document.uri, word: editor.document.getText(range) };
}

function toSymbolInfo(sym: {
    kind: string;
    name: string;
    arity?: number;
    determinism?: string;
    purity?: string;
    args?: { raw: string; type?: string; mode?: string }[];
    typeDefinition?: string;
    doc?: { text: string };
}): SymbolInfoForPanel {
    return {
        kind: sym.kind,
        name: sym.name,
        arity: sym.arity,
        determinism: sym.determinism,
        purity: sym.purity,
        args: sym.args,
        typeDefinition: sym.typeDefinition,
        doc: sym.doc?.text,
    };
}

function findSymbol(doc: WireModuleDoc, name: string, kinds: string[]): SymbolInfoForPanel | undefined {
    const bare = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1) : name;
    const sym = doc.symbols.find((s) => kinds.includes(s.kind) && s.name === bare);
    return sym ? toSymbolInfo(sym) : undefined;
}

/**
 * Looks up a declaration first in the current file (fast path — no extra
 * round trip), then falls back to a workspace-wide search via the server's
 * `mercury/findDeclaration` request. This matters whenever the command is
 * invoked with the cursor on a *use* of a symbol (e.g. a call site) rather
 * than its declaration: the declaration commonly lives in a different file
 * (an imported module), which a current-file-only lookup would silently
 * miss and misreport as "not found" even though the symbol is real.
 */
async function findSymbolAcrossWorkspace(
    client: LanguageClient,
    uri: vscode.Uri,
    word: string,
    kinds: string[],
): Promise<SymbolInfoForPanel | undefined> {
    const doc = await client.sendRequest<WireModuleDoc | null>('mercury/moduleDoc', { uri: uri.toString() });
    const local = doc && findSymbol(doc, word, kinds);
    if (local) return local;

    const bare = word.includes('.') ? word.slice(word.lastIndexOf('.') + 1) : word;
    const remote = await client.sendRequest<{ symbol: Parameters<typeof toSymbolInfo>[0] } | null>('mercury/findDeclaration', { name: bare, kinds });
    return remote ? toSymbolInfo(remote.symbol) : undefined;
}

export function makeAnalysisCommands(getClient: () => LanguageClient | undefined) {
    return {
        async showModeInformation(uriArg?: string, nameArg?: string): Promise<void> {
            const client = getClient();
            if (!client) return;
            const ctx = nameArg && uriArg ? { uri: vscode.Uri.parse(uriArg), word: nameArg } : await currentWordAndDoc();
            if (!ctx) return;
            const info = await findSymbolAcrossWorkspace(client, ctx.uri, ctx.word, ['predicate', 'function']);
            if (!info) { vscode.window.showInformationMessage(`No predicate/function declaration found for '${ctx.word}' anywhere in the indexed workspace.`); return; }
            createModeInformationPanel(info);
        },

        async showTypeInformation(): Promise<void> {
            const client = getClient();
            if (!client) return;
            const ctx = await currentWordAndDoc();
            if (!ctx) return;
            const info = await findSymbolAcrossWorkspace(client, ctx.uri, ctx.word, ['type']);
            if (!info) { vscode.window.showInformationMessage(`No type declaration found for '${ctx.word}' anywhere in the indexed workspace.`); return; }
            createTypeInformationPanel(info);
        },

        async showDeterminism(uriArg?: string, nameArg?: string): Promise<void> {
            const client = getClient();
            if (!client) return;
            const ctx = nameArg && uriArg ? { uri: vscode.Uri.parse(uriArg), word: nameArg } : await currentWordAndDoc();
            if (!ctx) return;
            const info = await findSymbolAcrossWorkspace(client, ctx.uri, ctx.word, ['predicate', 'function']);
            if (!info) { vscode.window.showInformationMessage(`No predicate/function declaration found for '${ctx.word}' anywhere in the indexed workspace.`); return; }
            const callers = await client.sendRequest<CallGraphData>('mercury/callGraph', {});
            info.callers = callers.edges.filter((e) => callers.nodes.find((n) => n.id === e.to)?.name === info!.name).length;
            info.references = info.callers;
            createDeterminismPanel(info);
        },

        async showCallGraph(uriArg?: string): Promise<void> {
            const client = getClient();
            if (!client) return;
            let moduleFilter: string | undefined;
            if (uriArg) {
                const doc = await client.sendRequest<WireModuleDoc | null>('mercury/moduleDoc', { uri: uriArg });
                moduleFilter = doc?.moduleName;
            }
            const data = await client.sendRequest<CallGraphData>('mercury/callGraph', {});
            if (data.nodes.length === 0) { vscode.window.showInformationMessage('No predicates/functions indexed yet.'); return; }

            const folder = vscode.workspace.workspaceFolders?.[0];
            const verification = folder
                ? await vscode.window.withProgress(
                      { location: vscode.ProgressLocation.Notification, title: 'Mercury: cross-checking call graph against mmc…', cancellable: false },
                      () => verifyCallGraph(folder),
                  )
                : { ranByCompiler: false, flaggedPredicates: new Set<string>(), compilesCleanly: false };
            // Pre-select the module the CodeLens/command was invoked from,
            // rather than discarding that context — the full (unfiltered)
            // graph is still fetched so switching modules in the webview's
            // own dropdown doesn't need another server round trip.
            createCallGraphPanel(data, moduleFilter, verification);
        },

        async showModuleDependencies(): Promise<void> {
            const client = getClient();
            if (!client) return;
            const folder = vscode.workspace.workspaceFolders?.[0];
            if (!folder) return;
            const candidates = await findMainModuleCandidates(folder);
            if (candidates.length > 0) {
                const resp = await client.sendRequest<{ success: boolean; stderr: string; edges: { from: string; to: string[] }[]; importGraph: { from: string; to: string[] }[] }>(
                    'mercury/moduleDependencies',
                    { mainModule: candidates[0].moduleName, cwd: folder.uri.fsPath },
                );
                const usedCompiler = resp.success && resp.edges.length > 0;
                const data: ModuleDependencyData = { compilerEdges: resp.edges, importEdges: resp.importGraph, usedCompiler, compilerError: resp.success ? undefined : resp.stderr };
                createModuleDependencyPanel(data);
                return;
            }
            const resp = await client.sendRequest<{ importGraph: { from: string; to: string[] }[] }>('mercury/moduleDependencies', { mainModule: '', cwd: folder.uri.fsPath });
            createModuleDependencyPanel({ compilerEdges: [], importEdges: resp.importGraph, usedCompiler: false, compilerError: 'No main module found to run --generate-dependencies against.' });
        },

        async openAstExplorer(): Promise<void> {
            const client = getClient();
            const editor = vscode.window.activeTextEditor;
            if (!client || !editor) return;
            const doc = await client.sendRequest<WireModuleDoc | null>('mercury/ast', { uri: editor.document.uri.toString() });
            if (!doc) { vscode.window.showInformationMessage('This file has not been indexed yet.'); return; }
            createAstExplorerPanel(editor.document.uri, editor.document.getText(), doc);
        },

        async generateDocumentation(): Promise<void> {
            const client = getClient();
            const editor = vscode.window.activeTextEditor;
            if (!client || !editor) return;
            const doc = await client.sendRequest<WireModuleDoc | null>('mercury/moduleDoc', { uri: editor.document.uri.toString() });
            if (!doc) { vscode.window.showInformationMessage('This file has not been indexed yet.'); return; }
            const md = renderModuleMarkdown(doc);
            const folder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
            const docsDir = folder ? path.join(folder.uri.fsPath, 'docs') : path.dirname(editor.document.uri.fsPath);
            await fs.mkdir(docsDir, { recursive: true }).catch(() => undefined);
            const outPath = path.join(docsDir, `${doc.moduleName ?? path.basename(editor.document.uri.fsPath, '.m')}.md`);
            await fs.writeFile(outPath, md, 'utf8');
            const outUri = vscode.Uri.file(outPath);
            await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(outUri), { preview: false });
            vscode.window.showInformationMessage(`Mercury: documentation written to ${vscode.workspace.asRelativePath(outUri)}`);
        },

        async openPerformanceProfile(): Promise<void> {
            const folder = vscode.workspace.workspaceFolders?.[0];
            if (!folder) return;
            const cwd = folder.uri.fsPath;
            const requiredFiles = ['Prof.Counts', 'Prof.Decl', 'Prof.CallPair'];
            const missing: string[] = [];
            for (const f of requiredFiles) {
                try {
                    await fs.access(path.join(cwd, f));
                } catch {
                    missing.push(f);
                }
            }
            if (missing.length > 0) {
                createPerformanceProfilePanel({ available: false, reason: `Missing ${missing.join(', ')} in ${cwd}.` });
                return;
            }
            const detection = await detectCompiler(cwd);
            const result = await runProcess('mprof', [], { cwd, timeoutMs: 15000 });
            if (result.exitCode === null && !detection.found) {
                createPerformanceProfilePanel({ available: false, reason: "Profiling data was found, but 'mprof' could not be run. Ensure your Mercury installation's bin directory (containing mprof) is on PATH." });
                return;
            }
            createPerformanceProfilePanel({ available: true, reportText: (result.stdout + '\n' + result.stderr).trim() || '(mprof produced no output)' });
        },

        async openDeepProfile(): Promise<void> {
            const folder = vscode.workspace.workspaceFolders?.[0];
            if (!folder) return;
            const cwd = folder.uri.fsPath;
            let dataFiles: string[] = [];
            try {
                const entries = await fs.readdir(cwd);
                dataFiles = entries.filter((f) => f.endsWith('.data') && !f.startsWith('Prof.'));
            } catch {
                dataFiles = [];
            }
            if (dataFiles.length === 0) {
                vscode.window.showWarningMessage(
                    "No deep-profiling data file (*.data) was found in the workspace root. Build with '--deep-profiling' (or a deep-profiling grade), run the program to completion, and try again. See docs/compiler-integration.md#profiling.",
                );
                return;
            }
            const chosen = dataFiles.length === 1
                ? dataFiles[0]
                : await vscode.window.showQuickPick(dataFiles, { placeHolder: 'Select a deep-profiling data file' });
            if (!chosen) return;
            createDeepProfilePanel(cwd, path.join(cwd, chosen));
        },

        async explainDiagnostic(explanationArg?: { category: string; explanation: string }): Promise<void> {
            if (explanationArg) {
                vscode.window.showInformationMessage(`${explanationArg.category}: ${explanationArg.explanation}`);
                return;
            }
            const client = getClient();
            const editor = vscode.window.activeTextEditor;
            if (!client || !editor) return;
            const diag = vscode.languages.getDiagnostics(editor.document.uri).find((d) => d.range.contains(editor.selection.active));
            if (!diag) { vscode.window.showInformationMessage('Place the cursor on a diagnostic to explain it.'); return; }
            const explanation = await client.sendRequest<{ category: string; explanation: string } | null>('mercury/explainDiagnostic', { message: diag.message });
            if (!explanation) {
                vscode.window.showInformationMessage(`No specific explanation is available for this diagnostic; showing the compiler's message as-is: "${diag.message}"`);
                return;
            }
            vscode.window.showInformationMessage(`${explanation.category}: ${explanation.explanation}`);
        },
    };
}

function renderModuleMarkdown(doc: WireModuleDoc): string {
    const lines: string[] = [`# Module \`${doc.moduleName ?? '(unknown)'}\``, ''];
    const types = doc.symbols.filter((s) => s.kind === 'type');
    const preds = doc.symbols.filter((s) => s.kind === 'predicate');
    const funcs = doc.symbols.filter((s) => s.kind === 'function');
    const classes = doc.symbols.filter((s) => s.kind === 'typeclass' || s.kind === 'instance');

    if (types.length) {
        lines.push('## Types', '');
        for (const t of types) {
            lines.push(`### \`${t.name}${t.arity ? '/' + t.arity : ''}\``);
            if (t.doc?.text) lines.push('', t.doc.text);
            if (t.typeDefinition) lines.push('', '```mercury', `:- type ${t.name} ---> ${t.typeDefinition}.`, '```');
            lines.push('');
        }
    }
    if (preds.length) {
        lines.push('## Predicates', '');
        for (const p of preds) {
            lines.push(`### \`${p.name}/${p.arity ?? '?'}\``);
            if (p.doc?.text) lines.push('', p.doc.text);
            lines.push('', '```mercury', p.raw, '```', '');
        }
    }
    if (funcs.length) {
        lines.push('## Functions', '');
        for (const f of funcs) {
            lines.push(`### \`${f.name}/${f.arity ?? '?'}\``);
            if (f.doc?.text) lines.push('', f.doc.text);
            lines.push('', '```mercury', f.raw, '```', '');
        }
    }
    if (classes.length) {
        lines.push('## Type classes / Instances', '');
        for (const c of classes) {
            lines.push(`### \`${c.name}\` (${c.kind})`, '', '```mercury', c.raw, '```', '');
        }
    }
    lines.push('', '---', `_Generated by MercuryLens from the declarations and doc comments in \`${path.basename(doc.uri)}\`._`);
    return lines.join('\n');
}

export function moduleNameForCurrentFile(uri: vscode.Uri, text: string): string {
    return moduleNameForFile(uri, text);
}
