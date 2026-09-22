import * as vscode from 'vscode';
import * as path from 'path';
import { LanguageClient, LanguageClientOptions, ServerOptions, TransportKind } from 'vscode-languageclient/node';

import { buildProject, checkProject, cleanProject, runProject } from './commands/buildCommands';
import { runFile, runSelection, runPredicate, openPlayground } from './commands/playgroundCommands';
import { debugWithMdb, startExperimentalMdbDebugSession } from './commands/debugCommand';
import { registerMercuryDebugAdapter } from './debug/debugAdapterFactory';
import { makeAnalysisCommands } from './commands/analysisCommands';
import { organizeImports, makeRestartServerCommand, makeGetClientRef } from './commands/miscCommands';
import { makeExtractPredicateCommand } from './commands/extractPredicateCommand';
import { makeInlinePredicateCommand } from './commands/inlinePredicateCommand';
import { detectCompiler, compilerMissingMessage } from './compiler/detector';
import { getTraceServerLevel, isAutoBuildEnabled } from './configuration/settings';
import { getCompilerOutputChannel, setStatusBar } from './utils/output';
import { MercuryWorkspaceProvider } from './providers/workspaceTreeProvider';
import { MercuryCompilerStatusProvider } from './providers/compilerStatusProvider';
import { MercuryDiagnosticsProvider } from './diagnostics/diagnosticsTreeProvider';

const clientRef = makeGetClientRef();

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    const outputChannel = getCompilerOutputChannel();

    async function startClient(): Promise<LanguageClient> {
        const serverModule = context.asAbsolutePath(path.join('server', 'out', 'server.js'));
        const serverOptions: ServerOptions = {
            run: { module: serverModule, transport: TransportKind.ipc },
            debug: { module: serverModule, transport: TransportKind.ipc, options: { execArgv: ['--nolazy', '--inspect=6009'] } },
        };
        const traceLevel = getTraceServerLevel();
        const clientOptions: LanguageClientOptions = {
            documentSelector: [{ scheme: 'file', language: 'mercury' }],
            synchronize: {
                fileEvents: vscode.workspace.createFileSystemWatcher('**/*.m'),
                configurationSection: 'mercuryTools',
            },
            outputChannel,
            traceOutputChannel: traceLevel !== 'off' ? outputChannel : undefined,
        };
        const client = new LanguageClient('mercuryTools', 'Mercury Language Server', serverOptions, clientOptions);
        await client.start();
        clientRef.set(client);
        return client;
    }

    async function restartClient(): Promise<void> {
        const existing = clientRef.get();
        if (existing) await existing.stop();
        await startClient();
    }

    await startClient();

    // ---- Status bar + compiler detection ----
    const compilerStatusProvider = new MercuryCompilerStatusProvider();
    context.subscriptions.push(vscode.window.registerTreeDataProvider('mercuryToolsCompiler', compilerStatusProvider));

    async function refreshCompilerStatus(): Promise<void> {
        const folder = vscode.workspace.workspaceFolders?.[0];
        const detection = await detectCompiler(folder?.uri.fsPath ?? process.cwd());
        compilerStatusProvider.setStatus(detection);
        if (detection.found) {
            setStatusBar(`$(check) Mercury: ${detection.version ? `mmc ${detection.version}` : 'mmc detected'}`, `Compiler: ${detection.executable}`);
        } else {
            setStatusBar('$(warning) Mercury: compiler not found', compilerMissingMessage());
        }
    }
    await refreshCompilerStatus();
    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('mercuryTools.compilerPath')) void refreshCompilerStatus();
    }));

    // ---- Sidebar views ----
    const workspaceProvider = new MercuryWorkspaceProvider(() => clientRef.get());
    context.subscriptions.push(vscode.window.registerTreeDataProvider('mercuryToolsExplorer', workspaceProvider));
    const diagnosticsProvider = new MercuryDiagnosticsProvider();
    context.subscriptions.push(vscode.window.registerTreeDataProvider('mercuryToolsDiagnostics', diagnosticsProvider));

    context.subscriptions.push(
        vscode.workspace.onDidSaveTextDocument((doc) => {
            if (doc.languageId === 'mercury') {
                workspaceProvider.refresh();
                if (isAutoBuildEnabled()) {
                    void checkProject();
                }
            }
        }),
    );

    // ---- Commands ----
    const analysis = makeAnalysisCommands(() => clientRef.get());
    const registrations: [string, (...args: any[]) => unknown][] = [
        ['mercuryTools.buildProject', buildProject],
        ['mercuryTools.checkProject', checkProject],
        ['mercuryTools.cleanProject', cleanProject],
        ['mercuryTools.runProject', runProject],
        ['mercuryTools.runFile', (uri?: vscode.Uri) => runFile(uri)],
        ['mercuryTools.runSelection', runSelection],
        ['mercuryTools.runPredicate', (uri?: string, name?: string, arity?: number) => runPredicate(uri, name, arity)],
        ['mercuryTools.openPlayground', openPlayground],
        ['mercuryTools.debugWithMdb', debugWithMdb],
        ['mercuryTools.startExperimentalMdbDebugSession', startExperimentalMdbDebugSession],
        ['mercuryTools.showModeInformation', (uri?: string, name?: string) => analysis.showModeInformation(uri, name)],
        ['mercuryTools.showTypeInformation', analysis.showTypeInformation],
        ['mercuryTools.showDeterminism', (uri?: string, name?: string) => analysis.showDeterminism(uri, name)],
        ['mercuryTools.showCallGraph', (uri?: string) => analysis.showCallGraph(uri)],
        ['mercuryTools.showModuleDependencies', analysis.showModuleDependencies],
        ['mercuryTools.openAstExplorer', analysis.openAstExplorer],
        ['mercuryTools.generateDocumentation', analysis.generateDocumentation],
        ['mercuryTools.openPerformanceProfile', analysis.openPerformanceProfile],
        ['mercuryTools.openDeepProfile', analysis.openDeepProfile],
        ['mercuryTools.extractPredicate', makeExtractPredicateCommand(() => clientRef.get())],
        ['mercuryTools.inlinePredicate', makeInlinePredicateCommand(() => clientRef.get())],
        ['mercuryTools.explainDiagnostic', (explanation?: { category: string; explanation: string }) => analysis.explainDiagnostic(explanation)],
        ['mercuryTools.openCompilerOutput', () => outputChannel.show()],
        ['mercuryTools.organizeImports', organizeImports],
        ['mercuryTools.restartServer', makeRestartServerCommand(restartClient)],
    ];
    for (const [id, handler] of registrations) {
        context.subscriptions.push(vscode.commands.registerCommand(id, handler));
    }

    registerMercuryDebugAdapter(context, () => clientRef.get());

    context.subscriptions.push({ dispose: () => { void clientRef.get()?.stop(); } });
}

export async function deactivate(): Promise<void> {
    await clientRef.get()?.stop();
}
