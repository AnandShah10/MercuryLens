import { spawn, ChildProcessWithoutNullStreams } from 'child_process';

export interface ProcessResult {
    stdout: string;
    stderr: string;
    exitCode: number | null;
    signal: NodeJS.Signals | null;
    durationMs: number;
    timedOut: boolean;
}

export interface RunOptions {
    cwd: string;
    timeoutMs?: number;
    onStdout?: (chunk: string) => void;
    onStderr?: (chunk: string) => void;
    token?: { isCancellationRequested: boolean; onCancellationRequested?: (cb: () => void) => void };
}

/**
 * Spawns a process using an argument array (never a shell string), so
 * arguments are never subject to shell interpretation/injection. This is
 * the single choke point through which this extension executes external
 * commands (mmc, built executables); see docs/architecture.md#security.
 */
export function runProcess(command: string, args: string[], options: RunOptions): Promise<ProcessResult> {
    return new Promise((resolve) => {
        const start = Date.now();
        let stdout = '';
        let stderr = '';
        let timedOut = false;
        let child: ChildProcessWithoutNullStreams;
        try {
            child = spawn(command, args, { cwd: options.cwd, shell: false });
        } catch (err) {
            resolve({ stdout: '', stderr: `Failed to launch '${command}': ${String(err)}`, exitCode: null, signal: null, durationMs: 0, timedOut: false });
            return;
        }

        const timer = options.timeoutMs
            ? setTimeout(() => {
                  timedOut = true;
                  child.kill();
              }, options.timeoutMs)
            : undefined;

        options.token?.onCancellationRequested?.(() => child.kill());

        child.stdout.on('data', (d: Buffer) => {
            const s = d.toString();
            stdout += s;
            options.onStdout?.(s);
        });
        child.stderr.on('data', (d: Buffer) => {
            const s = d.toString();
            stderr += s;
            options.onStderr?.(s);
        });
        child.on('error', (err) => {
            if (timer) clearTimeout(timer);
            resolve({ stdout, stderr: stderr + String(err), exitCode: null, signal: null, durationMs: Date.now() - start, timedOut });
        });
        child.on('close', (code, signal) => {
            if (timer) clearTimeout(timer);
            resolve({ stdout, stderr, exitCode: code, signal, durationMs: Date.now() - start, timedOut });
        });
    });
}
