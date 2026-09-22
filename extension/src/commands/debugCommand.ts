import * as vscode from 'vscode';
import * as path from 'path';
import { detectCompiler, compilerMissingMessage } from '../compiler/detector';
import { findMainModuleCandidates } from '../workspace/projectDetector';
import { runProcess } from '../utils/process';
import { getCompilerOutputChannel } from '../utils/output';

/**
 * Mercury's debugger (`mdb`) is a full source-level declarative/procedural
 * debugger with its own command language (breakpoints, step, declarative
 * "dd" bug search, etc. — see the Mercury User's Guide). This project
 * offers two ways to use it:
 *
 *   1. `Mercury: Debug with mdb (Terminal)` (this file) — opens `mdb
 *      <executable>` directly in a VS Code integrated terminal. 100%
 *      reliable, since it's just a terminal running the real tool
 *      unmodified; the tradeoff is no breakpoint gutters/step buttons.
 *   2. `Mercury: Start Experimental Debug Session (mdb)` (this file) —
 *      launches the same debug-grade executable through a genuine Debug
 *      Adapter Protocol bridge (see ../debug/mdbSession.ts) so VS Code's
 *      breakpoint gutters and step/continue toolbar drive real `mdb`
 *      commands. This is explicitly labeled EXPERIMENTAL: the commands it
 *      sends are well-documented and reliable, but the OUTPUT PARSING
 *      (trace events, stack frames, variables) could not be verified
 *      against a live `mdb` while building this (no Mercury installation
 *      was available — see docs/compiler-integration.md#debugging).
 *      mdb's own raw output is always forwarded to the Debug Console, so
 *      the feature stays diagnosable/useful even where a specific mdb
 *      version's exact format doesn't match what this bridge expects —
 *      and option 1 remains available as a fully reliable fallback.
 */

interface DebugBuildResult {
    folder: vscode.WorkspaceFolder;
    moduleName: string;
    executablePath: string;
}

/** Shared by both debug commands: picks a main module (if more than one
 * candidate exists) and builds it in a debugging grade. Returns undefined
 * (having already shown the relevant message) if any step fails. */
async function selectAndBuildDebugGrade(): Promise<DebugBuildResult | undefined> {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) { vscode.window.showErrorMessage('Open a folder to debug a Mercury program.'); return undefined; }
    if (!vscode.workspace.isTrusted) { vscode.window.showErrorMessage('Mercury Tools: debugging is disabled in untrusted workspaces.'); return undefined; }

    const candidates = await findMainModuleCandidates(folder);
    if (candidates.length === 0) {
        vscode.window.showWarningMessage("No module defining 'main/2' was found; mdb debugs a runnable program's executable.");
        return undefined;
    }
    const chosen = candidates.length === 1
        ? candidates[0]
        : (await vscode.window.showQuickPick(
              candidates.map((c) => ({ label: c.moduleName, description: vscode.workspace.asRelativePath(c.uri), candidate: c })),
              { placeHolder: 'Select the module to debug' },
          ))?.candidate;
    if (!chosen) return undefined;

    const detection = await detectCompiler(folder.uri.fsPath);
    if (!detection.found || !detection.executable) {
        vscode.window.showErrorMessage(compilerMissingMessage());
        return undefined;
    }

    const channel = getCompilerOutputChannel();
    channel.show(true);
    channel.appendLine(`$ mmc --make --debug ${chosen.moduleName}`);
    const build = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: `Mercury: building ${chosen.moduleName} in a debugging grade`, cancellable: false },
        () =>
            runProcess(detection.executable as string, ['--make', '--debug', chosen.moduleName], {
                cwd: folder.uri.fsPath,
                timeoutMs: 5 * 60 * 1000,
                onStdout: (s) => channel.append(s),
                onStderr: (s) => channel.append(s),
            }),
    );
    if (build.exitCode !== 0) {
        vscode.window.showErrorMessage(`Mercury: debug build of '${chosen.moduleName}' failed (see 'Mercury Compiler' output). Note some backends/platforms don't support every debugging grade — see docs/compiler-integration.md#debugging.`);
        return undefined;
    }

    const executablePath = process.platform === 'win32'
        ? path.join(folder.uri.fsPath, `${chosen.moduleName}.exe`)
        : path.join(folder.uri.fsPath, chosen.moduleName);
    return { folder, moduleName: chosen.moduleName, executablePath };
}

export async function debugWithMdb(): Promise<void> {
    const built = await selectAndBuildDebugGrade();
    if (!built) return;

    const terminal = vscode.window.createTerminal({ name: `mdb: ${built.moduleName}`, cwd: built.folder.uri.fsPath });
    terminal.show();
    const exe = process.platform === 'win32' ? `${built.moduleName}.exe` : `./${built.moduleName}`;
    terminal.sendText(`mdb ${exe}`);
    vscode.window.showInformationMessage(
        `mdb started in the "${built.moduleName}" terminal. This is the real Mercury debugger's own command line (try 'help', 'break', 'step', 'continue', 'dd') — Mercury Tools does not reimplement its controls.`,
    );
}

export async function startExperimentalMdbDebugSession(): Promise<void> {
    const built = await selectAndBuildDebugGrade();
    if (!built) return;

    const proceed = await vscode.window.showWarningMessage(
        `This starts an EXPERIMENTAL debug session using a Debug Adapter Protocol bridge to mdb — the commands it sends are reliable, but its interpretation of mdb's output (stack frames, variables) is best-effort and was not verified against a live mdb (see docs/compiler-integration.md#debugging). Raw mdb output is always shown in the Debug Console. If anything looks wrong, 'Mercury: Debug with mdb (Terminal)' is a fully reliable fallback.`,
        'Start Experimental Session',
        'Use Terminal Instead',
    );
    if (proceed === 'Use Terminal Instead') {
        const terminal = vscode.window.createTerminal({ name: `mdb: ${built.moduleName}`, cwd: built.folder.uri.fsPath });
        terminal.show();
        terminal.sendText(`mdb ${process.platform === 'win32' ? `${built.moduleName}.exe` : `./${built.moduleName}`}`);
        return;
    }
    if (proceed !== 'Start Experimental Session') return;

    await vscode.debug.startDebugging(built.folder, {
        type: 'mercury-mdb',
        name: `Mercury (mdb): ${built.moduleName}`,
        request: 'launch',
        program: built.executablePath,
        cwd: built.folder.uri.fsPath,
        stopOnEntry: true,
    });
}
