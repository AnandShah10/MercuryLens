import * as vscode from 'vscode';

/**
 * Single point of access for every `mercuryTools.*` setting. Before this
 * module existed, `vscode.workspace.getConfiguration('mercuryTools')` was
 * called ad hoc from several files (with the extra-arguments getter
 * literally duplicated verbatim in two of them) — that's exactly the kind
 * of drift-prone duplication a `configuration/` module is meant to
 * prevent: a typo in a setting key, or a default value that gets updated
 * in one call site but not another, would otherwise be easy to miss.
 *
 * The language server keeps its own, separate settings snapshot (see
 * server/src/server.ts's `Settings` interface) since it receives
 * configuration over `workspace/didChangeConfiguration` rather than
 * calling into `vscode.workspace` directly (the server process has no
 * `vscode` API — see docs/architecture.md).
 */

function config(): vscode.WorkspaceConfiguration {
    return vscode.workspace.getConfiguration('mercuryTools');
}

export function getCompilerPath(): string {
    return config().get<string>('compilerPath', '').trim();
}

export function getCompilerArguments(): string[] {
    return config().get<string[]>('compilerArguments', []);
}

export function getBuildCommand(): string {
    return config().get<string>('buildCommand', '');
}

export function isDiagnosticsEnabled(): boolean {
    return config().get<boolean>('enableDiagnostics', true);
}

export function isSemanticTokensEnabled(): boolean {
    return config().get<boolean>('enableSemanticTokens', true);
}

export function isModeInformationEnabled(): boolean {
    return config().get<boolean>('showModeInformation', true);
}

export function isDeterminismCodeLensEnabled(): boolean {
    return config().get<boolean>('showDeterminismCodeLens', true);
}

export function isCallGraphCodeLensEnabled(): boolean {
    return config().get<boolean>('showCallGraphCodeLens', true);
}

export function isProfilingEnabled(): boolean {
    return config().get<boolean>('enableProfiling', false);
}

export function getTraceServerLevel(): 'off' | 'messages' | 'verbose' {
    return config().get<'off' | 'messages' | 'verbose'>('trace.server', 'off');
}

export function getMaxAnalysisTime(): number {
    return config().get<number>('maxAnalysisTime', 10000);
}

export function isAutoBuildEnabled(): boolean {
    return config().get<boolean>('autoBuild', false);
}

export function isFormatterEnabled(): boolean {
    return config().get<boolean>('formatter.enabled', true);
}
