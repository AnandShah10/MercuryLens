import { spawn, ChildProcessWithoutNullStreams } from 'child_process';

/**
 * A long-lived, interactive `mdb <program>` child process, distinct from
 * ../utils/process.ts's one-shot `runProcess` (which waits for the process
 * to exit). This wrapper sends commands and resolves once mdb's own prompt
 * reappears in its output.
 *
 * CONFIDENCE NOTE: this assumes mdb's prompt is `mdb> ` — a long-standing,
 * well-documented convention this project has moderate-high but unverified
 * confidence in (no live Mercury installation was available to confirm
 * against — see docs/compiler-integration.md). If a given mdb build uses a
 * different prompt, every `sendCommand` call will time out; the raw output
 * received up to that point is always still forwarded via `onOutput`
 * (surfaced to the Debug Console by mdbSession.ts) so this is diagnosable
 * rather than a silent hang, and the terminal-based
 * `Mercury: Debug with mdb` command remains a fully working fallback that
 * doesn't depend on this assumption at all.
 */

const PROMPT_RE = /mdb>\s*$/;

export interface MdbProcessEvents {
    onOutput?: (chunk: string) => void;
    onExit?: (code: number | null) => void;
}

export class MdbProcess {
    private child: ChildProcessWithoutNullStreams;
    private buffer = '';
    private waiters: { resolve: (output: string) => void }[] = [];
    private events: MdbProcessEvents;

    constructor(program: string, cwd: string, events: MdbProcessEvents, args: string[] = []) {
        this.events = events;
        this.child = spawn('mdb', [program, ...args], { cwd, shell: false });
        this.child.stdout.on('data', (d: Buffer) => this.handleData(d.toString()));
        this.child.stderr.on('data', (d: Buffer) => this.handleData(d.toString()));
        this.child.on('exit', (code) => this.events.onExit?.(code));
        this.child.on('error', () => this.events.onExit?.(null));
    }

    private handleData(chunk: string): void {
        this.buffer += chunk;
        this.events.onOutput?.(chunk);
        if (PROMPT_RE.test(this.buffer) && this.waiters.length > 0) {
            const output = this.buffer;
            this.buffer = '';
            const waiter = this.waiters.shift();
            waiter?.resolve(output);
        }
    }

    /** Resolves once mdb's initial prompt appears (the debug monitor
     * auto-stops at the first trace event on launch), without sending
     * anything. */
    waitForInitialPrompt(timeoutMs = 15000): Promise<string> {
        return new Promise((resolve, reject) => {
            if (PROMPT_RE.test(this.buffer)) {
                const output = this.buffer;
                this.buffer = '';
                resolve(output);
                return;
            }
            const timer = setTimeout(() => reject(new Error(`mdb did not show its initial prompt within ${timeoutMs}ms.`)), timeoutMs);
            this.waiters.push({ resolve: (output) => { clearTimeout(timer); resolve(output); } });
        });
    }

    /** Sends a command and resolves with all output up to (and including)
     * the next prompt. */
    sendCommand(command: string, timeoutMs = 15000): Promise<string> {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(
                () => reject(new Error(`mdb did not respond to '${command}' within ${timeoutMs}ms.`)),
                timeoutMs,
            );
            this.waiters.push({ resolve: (output) => { clearTimeout(timer); resolve(output); } });
            this.child.stdin.write(command + '\n');
        });
    }

    dispose(): void {
        try { this.child.stdin.write('quit\n'); } catch { /* process may already be gone */ }
        setTimeout(() => { if (!this.child.killed) this.child.kill(); }, 500);
    }
}
