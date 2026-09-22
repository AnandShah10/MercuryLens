import { spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

/**
 * Adapter over the real Mercury compiler (`mmc`). This module never
 * fabricates compiler output: every field below is either parsed directly
 * from `mmc`'s own stdout/stderr, or explicitly left undefined/absent when
 * the compiler cannot be found or the requested facility is unavailable.
 *
 * Reference: `mmc --errorcheck-only` type-checks and mode-checks a program
 * without generating code (see the Mercury User's Guide, "Build system
 * options" / "Using mmc"). Diagnostic lines from mmc take the form:
 *   <file>:<line>: In `pred'(...): <message...>
 *   <file>:<line>-<line>: Error: <message>
 *   <file>:<line>: Warning: <message>
 * The exact wording of messages is compiler-owned and version-dependent;
 * this adapter parses the `<file>:<line>[-<line>]: (Error|Warning): ` prefix
 * generically rather than pattern-matching specific historical wordings.
 */

export interface CompilerDiagnostic {
    file: string;
    startLine: number; // 0-based
    endLine: number; // 0-based
    severity: 'error' | 'warning' | 'info';
    message: string;
    raw: string;
}

export interface CompileResult {
    success: boolean;
    diagnostics: CompilerDiagnostic[];
    stdout: string;
    stderr: string;
    exitCode: number | null;
    durationMs: number;
    timedOut: boolean;
}

export interface RunResult {
    stdout: string;
    stderr: string;
    exitCode: number | null;
    durationMs: number;
}

export interface DetectionResult {
    found: boolean;
    path?: string;
    version?: string;
    error?: string;
}

function runProcess(
    command: string,
    args: string[],
    cwd: string,
    timeoutMs: number,
): Promise<{ stdout: string; stderr: string; exitCode: number | null; timedOut: boolean; durationMs: number }> {
    return new Promise((resolve) => {
        const start = Date.now();
        let stdout = '';
        let stderr = '';
        let timedOut = false;
        let child;
        try {
            child = spawn(command, args, { cwd, shell: false });
        } catch (err) {
            resolve({ stdout: '', stderr: String(err), exitCode: null, timedOut: false, durationMs: Date.now() - start });
            return;
        }
        const timer = setTimeout(() => {
            timedOut = true;
            child.kill();
        }, timeoutMs);
        child.stdout?.on('data', (d) => (stdout += d.toString()));
        child.stderr?.on('data', (d) => (stderr += d.toString()));
        child.on('error', (err) => {
            clearTimeout(timer);
            resolve({ stdout, stderr: stderr + String(err), exitCode: null, timedOut, durationMs: Date.now() - start });
        });
        child.on('close', (code) => {
            clearTimeout(timer);
            resolve({ stdout, stderr, exitCode: code, timedOut, durationMs: Date.now() - start });
        });
    });
}

const DIAGNOSTIC_LINE = /^(.+?):(\d+)(?:-(\d+))?:\s*(Error|Warning|error|warning)?:?\s*(.*)$/;

export function parseCompilerOutput(output: string): CompilerDiagnostic[] {
    const diagnostics: CompilerDiagnostic[] = [];
    const lines = output.split(/\r\n|\n/);
    let current: CompilerDiagnostic | null = null;

    for (const line of lines) {
        const m = line.match(DIAGNOSTIC_LINE);
        if (m) {
            const [, file, startLineStr, endLineStr, sevWord, rest] = m;
            // Only treat this as a new diagnostic if it looks like a real
            // Mercury source path (has an extension) to avoid false
            // positives on unrelated colon-containing output lines.
            if (!/\.(m|moo)$/i.test(file.trim())) {
                if (current) current.raw += '\n' + line;
                continue;
            }
            if (current) diagnostics.push(current);
            const startLine = Math.max(0, parseInt(startLineStr, 10) - 1);
            const endLine = endLineStr ? Math.max(0, parseInt(endLineStr, 10) - 1) : startLine;
            const severity: CompilerDiagnostic['severity'] =
                /error/i.test(sevWord ?? '') ? 'error' : /warning/i.test(sevWord ?? '') ? 'warning' : 'info';
            current = {
                file: file.trim(),
                startLine,
                endLine,
                severity,
                message: rest.trim(),
                raw: line,
            };
        } else if (current && /^\s+\S/.test(line)) {
            // continuation line of a multi-line compiler message
            current.message += ' ' + line.trim();
            current.raw += '\n' + line;
        }
    }
    if (current) diagnostics.push(current);
    return diagnostics;
}

export class MercuryCompilerAdapter {
    constructor(private configuredPath: string | undefined) {}

    setConfiguredPath(p: string | undefined): void {
        this.configuredPath = p;
    }

    private candidatePaths(): string[] {
        const candidates: string[] = [];
        if (this.configuredPath) candidates.push(this.configuredPath);
        candidates.push('mmc');
        return candidates;
    }

    async detect(timeoutMs = 5000): Promise<DetectionResult> {
        for (const candidate of this.candidatePaths()) {
            const result = await runProcess(candidate, ['--version'], process.cwd(), timeoutMs);
            if (result.exitCode === 0 || /Mercury Compiler/i.test(result.stdout + result.stderr)) {
                const versionMatch = (result.stdout + result.stderr).match(/version\s+([0-9][0-9.\-a-zA-Z]*)/i);
                return { found: true, path: candidate, version: versionMatch ? versionMatch[1] : undefined };
            }
        }
        return { found: false, error: 'mmc was not found on PATH and mercuryTools.compilerPath is not set.' };
    }

    /** Runs `mmc --errorcheck-only` (type/mode/determinism checking without
     * code generation) over the given source files. */
    async check(files: string[], cwd: string, extraArgs: string[], timeoutMs: number): Promise<CompileResult> {
        const detection = await this.detect();
        if (!detection.found || !detection.path) {
            return { success: false, diagnostics: [], stdout: '', stderr: detection.error ?? 'mmc not found', exitCode: null, durationMs: 0, timedOut: false };
        }
        const result = await runProcess(detection.path, ['--errorcheck-only', ...extraArgs, ...files], cwd, timeoutMs);
        const diagnostics = parseCompilerOutput(result.stdout + '\n' + result.stderr);
        return {
            success: result.exitCode === 0 && !result.timedOut,
            diagnostics,
            stdout: result.stdout,
            stderr: result.stderr,
            exitCode: result.exitCode,
            durationMs: result.durationMs,
            timedOut: result.timedOut,
        };
    }

    /** Runs `mmc --make <mainModule>` to build an executable. */
    async build(mainModule: string, cwd: string, extraArgs: string[], timeoutMs: number): Promise<CompileResult> {
        const detection = await this.detect();
        if (!detection.found || !detection.path) {
            return { success: false, diagnostics: [], stdout: '', stderr: detection.error ?? 'mmc not found', exitCode: null, durationMs: 0, timedOut: false };
        }
        const result = await runProcess(detection.path, ['--make', ...extraArgs, mainModule], cwd, timeoutMs);
        const diagnostics = parseCompilerOutput(result.stdout + '\n' + result.stderr);
        return {
            success: result.exitCode === 0 && !result.timedOut,
            diagnostics,
            stdout: result.stdout,
            stderr: result.stderr,
            exitCode: result.exitCode,
            durationMs: result.durationMs,
            timedOut: result.timedOut,
        };
    }

    /** Removes build artifacts via `mmc --make <mainModule>.clean` (and
     * `.realclean` is intentionally not used by default, since it also
     * removes installed interface files that may be shared). */
    async clean(mainModule: string, cwd: string, timeoutMs: number): Promise<CompileResult> {
        const detection = await this.detect();
        if (!detection.found || !detection.path) {
            return { success: false, diagnostics: [], stdout: '', stderr: detection.error ?? 'mmc not found', exitCode: null, durationMs: 0, timedOut: false };
        }
        const result = await runProcess(detection.path, ['--make', `${mainModule}.clean`], cwd, timeoutMs);
        return {
            success: result.exitCode === 0,
            diagnostics: [],
            stdout: result.stdout,
            stderr: result.stderr,
            exitCode: result.exitCode,
            durationMs: result.durationMs,
            timedOut: result.timedOut,
        };
    }

    /** Runs a previously built executable. Does not build it first. */
    async run(executablePath: string, args: string[], cwd: string, timeoutMs: number): Promise<RunResult> {
        const result = await runProcess(executablePath, args, cwd, timeoutMs);
        return { stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode, durationMs: result.durationMs };
    }

    /** Runs `mmc --generate-dependencies <mainModule>` and parses the
     * resulting `.d` file for module dependency edges. This is a real,
     * compiler-backed source of dependency information (unlike the
     * heuristic predicate call graph). */
    async getDependencyInfo(mainModule: string, cwd: string, timeoutMs: number): Promise<{ edges: Map<string, string[]>; stderr: string; success: boolean }> {
        const detection = await this.detect();
        const edges = new Map<string, string[]>();
        if (!detection.found || !detection.path) {
            return { edges, stderr: detection.error ?? 'mmc not found', success: false };
        }
        const result = await runProcess(detection.path, ['--generate-dependencies', mainModule], cwd, timeoutMs);
        const depFile = path.join(cwd, `${mainModule}.dep`);
        const dFile = path.join(cwd, `${mainModule}.d`);
        try {
            const target = fs.existsSync(depFile) ? depFile : fs.existsSync(dFile) ? dFile : undefined;
            if (target) {
                const content = fs.readFileSync(target, 'utf8');
                // .d/.dep files contain Make-style rules like:
                //   module.some_target : dep1.m dep2.m ...
                const ruleRe = /^([\w.]+)\s*:\s*(.+)$/gm;
                let m: RegExpExecArray | null;
                while ((m = ruleRe.exec(content))) {
                    const target2 = m[1];
                    const depsRaw = m[2].split(/\s+/).filter(Boolean);
                    const moduleDeps = depsRaw
                        .filter((d) => d.endsWith('.m'))
                        .map((d) => path.basename(d, '.m'));
                    if (moduleDeps.length) edges.set(target2.split('.')[0], moduleDeps);
                }
            }
        } catch (err) {
            return { edges, stderr: String(err), success: false };
        }
        return { edges, stderr: result.stderr, success: result.exitCode === 0 };
    }
}
