import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { detectCompiler, compilerMissingMessage } from '../compiler/detector';
import { runProcess } from '../utils/process';
import { moduleNameForFile } from '../workspace/projectDetector';
import { createPlaygroundPanel, PlaygroundResult } from '../views/playgroundPanel';
import { getCompilerArguments } from '../configuration/settings';

function extraArgs(): string[] {
    return getCompilerArguments();
}

async function compileAndRun(moduleName: string, tempDir: string, args: string[] = []): Promise<PlaygroundResult> {
    const detection = await detectCompiler(tempDir);
    if (!detection.found || !detection.executable) {
        return { compileOutput: compilerMissingMessage(), stdout: '', stderr: '', exitCode: null, durationMs: 0, success: false };
    }
    const buildStart = Date.now();
    const build = await runProcess(detection.executable, ['--make', ...extraArgs(), moduleName], { cwd: tempDir, timeoutMs: 60_000 });
    if (build.exitCode !== 0) {
        return {
            compileOutput: build.stdout + '\n' + build.stderr,
            stdout: '',
            stderr: '',
            exitCode: build.exitCode,
            durationMs: Date.now() - buildStart,
            success: false,
        };
    }
    const exe = process.platform === 'win32' ? path.join(tempDir, `${moduleName}.exe`) : path.join(tempDir, moduleName);
    const runStart = Date.now();
    const run = await runProcess(exe, args, { cwd: tempDir, timeoutMs: 30_000 });
    return {
        compileOutput: build.stdout + build.stderr,
        stdout: run.stdout,
        stderr: run.stderr,
        exitCode: run.exitCode,
        durationMs: Date.now() - runStart,
        success: run.exitCode === 0,
    };
}

/** Runs the current file as-is: copies it (and its workspace-local
 * dependencies, best-effort) into a scratch temp directory so build
 * artifacts never pollute the user's workspace, compiles it with the real
 * Mercury compiler, and runs the result. */
export async function runFile(uriArg?: vscode.Uri): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    const uri = uriArg ?? editor?.document.uri;
    if (!uri) { vscode.window.showErrorMessage('No Mercury file to run.'); return; }
    if (!vscode.workspace.isTrusted) { vscode.window.showErrorMessage('Mercury Tools: running code is disabled in untrusted workspaces.'); return; }

    const doc = await vscode.workspace.openTextDocument(uri);
    const text = doc.getText();
    const moduleName = moduleNameForFile(uri, text);
    if (!/:-\s*pred\s+main\s*\(/.test(text) && !/\bmain\s*\(\s*!IO\s*\)\s*:-/.test(text)) {
        const proceed = await vscode.window.showWarningMessage(
            `'${moduleName}' does not appear to define main/2. Mercury requires an entry point to produce a runnable program. Try anyway?`,
            'Try anyway',
            'Cancel',
        );
        if (proceed !== 'Try anyway') return;
    }

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mercury-playground-'));
    try {
        await fs.writeFile(path.join(tempDir, `${moduleName}.m`), text, 'utf8');
        // best-effort: copy sibling .m files in the same folder, since the
        // module under test may import them.
        const folderUri = vscode.Uri.file(path.dirname(uri.fsPath));
        try {
            const entries = await vscode.workspace.fs.readDirectory(folderUri);
            for (const [name, type] of entries) {
                if (type === vscode.FileType.File && name.endsWith('.m') && name !== path.basename(uri.fsPath)) {
                    const bytes = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(folderUri, name));
                    await fs.writeFile(path.join(tempDir, name), Buffer.from(bytes));
                }
            }
        } catch {
            // sibling copy is best-effort only
        }

        const result = await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title: `Mercury Playground: running ${moduleName}`, cancellable: false },
            () => compileAndRun(moduleName, tempDir),
        );
        createPlaygroundPanel(`Mercury Playground — ${moduleName}`, '', result);
    } finally {
        await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    }
}

/** Runs the current selection by wrapping it in a temporary module with a
 * synthesized `main/2` that writes the selection's result. This only works
 * when the selection is a self-contained goal that binds an `X` (or
 * similar) the harness can print — it cannot run arbitrary code fragments
 * without a valid program around them, which is a property of Mercury's
 * module system, not a limitation of this extension. */
export async function runSelection(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.selection.isEmpty) { vscode.window.showErrorMessage('Select a Mercury goal to run.'); return; }
    if (!vscode.workspace.isTrusted) { vscode.window.showErrorMessage('Mercury Tools: running code is disabled in untrusted workspaces.'); return; }

    const selectedText = editor.document.getText(editor.selection).trim().replace(/\.\s*$/, '');
    const moduleName = `playground_${Date.now()}`;
    const harness = [
        `:- module ${moduleName}.`,
        `:- interface.`,
        `:- import_module io.`,
        `:- pred main(io::di, io::uo) is det.`,
        `:- implementation.`,
        `:- import_module int, string, list, float.`,
        ``,
        `main(!IO) :-`,
        `    ( if (${selectedText}) then`,
        `        io.write_string("Selection succeeded.\\n", !IO)`,
        `    else`,
        `        io.write_string("Selection failed.\\n", !IO)`,
        `    ).`,
        ``,
    ].join('\n');

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mercury-playground-'));
    try {
        await fs.writeFile(path.join(tempDir, `${moduleName}.m`), harness, 'utf8');
        const result = await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title: 'Mercury Playground: running selection', cancellable: false },
            () => compileAndRun(moduleName, tempDir),
        );
        createPlaygroundPanel('Mercury Playground — selection', harness, result);
    } finally {
        await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    }
}

interface PredicateSignature {
    name: string;
    arity: number;
    args: { type?: string; mode?: string }[];
}

/** Attempts to invoke a specific predicate by generating a small harness
 * module that imports the source file's module and calls the predicate
 * with user-supplied literal arguments for primitive `in` parameters.
 * When an argument's type is not a recognizable primitive (int/float/
 * string/char/bool), or an argument is `out`/`di`/`uo` with no way for the
 * harness to display it generically, this is surfaced to the user rather
 * than silently guessed. */
export async function runPredicate(uriArg?: string, nameArg?: string, arityArg?: number): Promise<void> {
    if (!vscode.workspace.isTrusted) { vscode.window.showErrorMessage('Mercury Tools: running code is disabled in untrusted workspaces.'); return; }
    const editor = vscode.window.activeTextEditor;
    const uri = uriArg ? vscode.Uri.parse(uriArg) : editor?.document.uri;
    if (!uri) return;
    const doc = await vscode.workspace.openTextDocument(uri);
    const text = doc.getText();
    const moduleName = moduleNameForFile(uri, text);

    let name = nameArg;
    if (!name) {
        name = await vscode.window.showInputBox({ prompt: 'Predicate or function name to run' });
        if (!name) return;
    }

    const declMatch = text.match(new RegExp(`:-\\s*(pred|func)\\s+${escapeRe(name)}\\s*\\(([^]*?)\\)\\s*(?:=\\s*[^\\s]+)?\\s*(?:is\\s+(\\w+))?\\s*\\.`));
    if (!declMatch) {
        vscode.window.showErrorMessage(`Could not find a ':- pred'/':- func' declaration for '${name}' to determine its argument types.`);
        return;
    }
    const kind = declMatch[1] as 'pred' | 'func';
    
    const argsRaw = splitArgs(declMatch[2]);
    const sig: PredicateSignature = {
        name,
        arity: argsRaw.length,
        args: argsRaw.map((a) => {
            const [t, m] = a.split('::').map((s) => s.trim());
            return { type: t, mode: m };
        }),
    };
    void arityArg;

    const PRIMITIVES = new Set(['int', 'float', 'string', 'char', 'bool']);
    const inArgs = sig.args.filter((a) => !a.mode || a.mode === 'in');
    const outArgs = sig.args.filter((a) => a.mode === 'out');
    const unsupported = inArgs.filter((a) => !a.type || !PRIMITIVES.has(a.type));
    if (unsupported.length > 0 || sig.args.some((a) => a.mode && !['in', 'out'].includes(a.mode))) {
        vscode.window.showWarningMessage(
            `Mercury: '${name}' has argument(s) this extension cannot safely auto-invoke (non-primitive type, or a di/uo/mdi/muo mode such as an I/O state). ` +
            `Run Predicate only supports predicates/functions whose 'in' arguments are int/float/string/char/bool and whose remaining arguments are 'out'. ` +
            `Consider using 'Mercury: Run Selection' with a hand-written call instead.`,
        );
        return;
    }

    const values: string[] = [];
    for (const arg of inArgs) {
        const value = await vscode.window.showInputBox({ prompt: `Value for ${arg.type} argument (Mercury literal syntax)`, placeHolder: arg.type === 'string' ? '"example"' : '0' });
        if (value === undefined) return;
        values.push(value);
    }

    const outVars = outArgs.map((_, i) => `Out${i}`);
    const callArgs = [...values, ...outVars].join(', ');
    const printStmts = kind === 'func'
        ? [`    io.print(Result, !IO), io.nl(!IO)`]
        : outVars.length > 0
            ? outVars.map((v) => `    io.print(${v}, !IO), io.nl(!IO)`)
            : [`    io.write_string("(predicate succeeded; no output arguments to display)\\n", !IO)`];

    const harnessModule = `run_${name}_${Date.now()}`;
    const callLine = kind === 'func'
        ? `Result = ${moduleName}.${name}(${values.join(', ')})`
        : `${moduleName}.${name}(${callArgs})`;

    const harness = [
        `:- module ${harnessModule}.`,
        `:- interface.`,
        `:- import_module io.`,
        `:- pred main(io::di, io::uo) is cc_multi.`,
        `:- implementation.`,
        `:- import_module ${moduleName}.`,
        `:- import_module int, string, list, float, bool, char.`,
        ``,
        `main(!IO) :-`,
        `    ( if ${callLine} then`,
        ...printStmts.map((s) => s + (s === printStmts[printStmts.length - 1] ? '' : ',')),
        `    else`,
        `        io.write_string("Call failed or produced no solution.\\n", !IO)`,
        `    ).`,
        ``,
    ].join('\n');

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mercury-playground-'));
    try {
        await fs.writeFile(path.join(tempDir, `${moduleName}.m`), text, 'utf8');
        await fs.writeFile(path.join(tempDir, `${harnessModule}.m`), harness, 'utf8');
        const result = await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title: `Mercury Playground: running ${name}`, cancellable: false },
            () => compileAndRun(harnessModule, tempDir),
        );
        createPlaygroundPanel(`Mercury Playground — ${name}/${sig.arity}`, harness, result);
    } finally {
        await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    }
}

function splitArgs(s: string): string[] {
    const parts: string[] = [];
    let depth = 0, start = 0;
    for (let i = 0; i < s.length; i++) {
        if ('([{'.includes(s[i])) depth++;
        else if (')]}'.includes(s[i])) depth--;
        else if (s[i] === ',' && depth === 0) { parts.push(s.slice(start, i)); start = i + 1; }
    }
    const last = s.slice(start).trim();
    if (last) parts.push(last);
    return parts.map((p) => p.trim()).filter(Boolean);
}

function escapeRe(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export async function openPlayground(): Promise<void> {
    createPlaygroundPanel('Mercury Playground', '', undefined);
}
