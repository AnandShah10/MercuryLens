import * as vscode from 'vscode';
import * as path from 'path';
import { detectCompiler, compilerMissingMessage } from '../compiler/detector';
import { findMainModuleCandidates } from '../workspace/projectDetector';
import { runProcess } from '../utils/process';
import { getCompilerOutputChannel, setStatusBar } from '../utils/output';
import { getCompilerArguments } from '../configuration/settings';

async function pickMainModule(folder: vscode.WorkspaceFolder): Promise<{ moduleName: string; uri: vscode.Uri } | undefined> {
    const candidates = await findMainModuleCandidates(folder);
    if (candidates.length === 0) {
        vscode.window.showWarningMessage("No module defining 'main/2' was found in this workspace. Mercury Tools cannot guess a build target.");
        return undefined;
    }
    if (candidates.length === 1) return candidates[0];
    const pick = await vscode.window.showQuickPick(
        candidates.map((c) => ({ label: c.moduleName, description: vscode.workspace.asRelativePath(c.uri), candidate: c })),
        { placeHolder: 'Select the main module to build/run' },
    );
    return pick?.candidate;
}

function requireTrustedWorkspace(): boolean {
    if (!vscode.workspace.isTrusted) {
        vscode.window.showErrorMessage('Mercury Tools: build/run commands are disabled in untrusted workspaces.');
        return false;
    }
    return true;
}

async function ensureCompiler(cwd: string): Promise<string | undefined> {
    const detection = await detectCompiler(cwd);
    if (!detection.found || !detection.executable) {
        vscode.window.showErrorMessage(compilerMissingMessage());
        return undefined;
    }
    return detection.executable;
}

function extraArgs(): string[] {
    return getCompilerArguments();
}

export async function buildProject(): Promise<void> {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) { vscode.window.showErrorMessage('Open a folder to build a Mercury project.'); return; }
    if (!requireTrustedWorkspace()) return;
    const main = await pickMainModule(folder);
    if (!main) return;
    const mmc = await ensureCompiler(folder.uri.fsPath);
    if (!mmc) return;

    const channel = getCompilerOutputChannel();
    channel.show(true);
    channel.appendLine(`$ mmc --make ${[...extraArgs(), main.moduleName].join(' ')}`);
    setStatusBar('$(sync~spin) Mercury: building…', `Building ${main.moduleName}`);

    const result = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: `Mercury: building ${main.moduleName}`, cancellable: true },
        (_progress, token) =>
            runProcess(mmc, ['--make', ...extraArgs(), main.moduleName], {
                cwd: folder.uri.fsPath,
                timeoutMs: 5 * 60 * 1000,
                onStdout: (s) => channel.append(s),
                onStderr: (s) => channel.append(s),
                token,
            }),
    );

    if (result.exitCode === 0) {
        setStatusBar('$(check) Mercury: build succeeded', `${main.moduleName} built successfully`);
        vscode.window.showInformationMessage(`Mercury: '${main.moduleName}' built successfully.`);
    } else {
        setStatusBar('$(error) Mercury: build failed', `Build of ${main.moduleName} failed`);
        vscode.window.showErrorMessage(`Mercury: build of '${main.moduleName}' failed (see 'Mercury Compiler' output).`);
    }
}

export async function checkProject(): Promise<void> {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) { vscode.window.showErrorMessage('Open a folder to check a Mercury project.'); return; }
    const mmc = await ensureCompiler(folder.uri.fsPath);
    if (!mmc) return;
    const files = await vscode.workspace.findFiles(new vscode.RelativePattern(folder, '**/*.m'), '**/Mercury/**');
    if (files.length === 0) { vscode.window.showWarningMessage('No .m files found in this workspace.'); return; }

    const channel = getCompilerOutputChannel();
    channel.show(true);
    const relativePaths = files.map((f) => path.relative(folder.uri.fsPath, f.fsPath));
    channel.appendLine(`$ mmc --errorcheck-only ${[...extraArgs(), ...relativePaths].join(' ')}`);
    setStatusBar('$(sync~spin) Mercury: checking…', 'Running --errorcheck-only');

    const result = await runProcess(mmc, ['--errorcheck-only', ...extraArgs(), ...relativePaths], {
        cwd: folder.uri.fsPath,
        timeoutMs: 2 * 60 * 1000,
        onStdout: (s) => channel.append(s),
        onStderr: (s) => channel.append(s),
    });

    if (result.exitCode === 0) {
        setStatusBar('$(check) Mercury: check passed', 'No errors reported by mmc');
        vscode.window.showInformationMessage('Mercury: no errors found.');
    } else {
        setStatusBar('$(warning) Mercury: check found problems', 'See the Problems panel and Mercury Compiler output');
        vscode.window.showWarningMessage('Mercury: mmc reported problems (see Problems panel / Mercury Compiler output). Diagnostics are also shown inline via the language server.');
    }
}

export async function cleanProject(): Promise<void> {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) return;
    if (!requireTrustedWorkspace()) return;
    const main = await pickMainModule(folder);
    if (!main) return;
    const mmc = await ensureCompiler(folder.uri.fsPath);
    if (!mmc) return;
    const confirm = await vscode.window.showWarningMessage(`Run 'mmc --make ${main.moduleName}.clean' in ${folder.name}?`, { modal: true }, 'Clean');
    if (confirm !== 'Clean') return;

    const channel = getCompilerOutputChannel();
    channel.show(true);
    channel.appendLine(`$ mmc --make ${main.moduleName}.clean`);
    const result = await runProcess(mmc, ['--make', `${main.moduleName}.clean`], {
        cwd: folder.uri.fsPath,
        timeoutMs: 60 * 1000,
        onStdout: (s) => channel.append(s),
        onStderr: (s) => channel.append(s),
    });
    vscode.window.showInformationMessage(result.exitCode === 0 ? 'Mercury: clean completed.' : 'Mercury: clean reported an error (see output).');
}

export async function runProject(): Promise<void> {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) return;
    if (!requireTrustedWorkspace()) return;
    const main = await pickMainModule(folder);
    if (!main) return;
    const mmc = await ensureCompiler(folder.uri.fsPath);
    if (!mmc) return;

    const channel = getCompilerOutputChannel();
    channel.show(true);
    channel.appendLine(`$ mmc --make ${main.moduleName}`);
    const buildResult = await runProcess(mmc, ['--make', ...extraArgs(), main.moduleName], {
        cwd: folder.uri.fsPath,
        timeoutMs: 5 * 60 * 1000,
        onStdout: (s) => channel.append(s),
        onStderr: (s) => channel.append(s),
    });
    if (buildResult.exitCode !== 0) {
        vscode.window.showErrorMessage(`Mercury: build of '${main.moduleName}' failed; not running.`);
        return;
    }

    const executable = process.platform === 'win32' ? `${main.moduleName}.exe` : `./${main.moduleName}`;
    channel.appendLine(`$ ${executable}`);
    const runResult = await runProcess(process.platform === 'win32' ? `${main.moduleName}.exe` : path.join(folder.uri.fsPath, main.moduleName), [], {
        cwd: folder.uri.fsPath,
        timeoutMs: 60 * 1000,
        onStdout: (s) => channel.append(s),
        onStderr: (s) => channel.append(s),
    });
    channel.appendLine(`\n[exit code: ${runResult.exitCode}, ${runResult.durationMs}ms]`);
}
