import { runProcess } from '../utils/process';
import { getCompilerPath } from '../configuration/settings';

export interface DetectedCompiler {
    found: boolean;
    executable?: string;
    version?: string;
    error?: string;
}

/** Detects `mmc` using (in order): the configured `mercuryTools.compilerPath`
 * setting, then the `PATH`. Never assumes a compiler exists — every caller
 * must handle `found: false` and degrade gracefully. */
export async function detectCompiler(cwd: string): Promise<DetectedCompiler> {
    const configured = getCompilerPath();
    const candidates = configured ? [configured] : ['mmc'];

    for (const candidate of candidates) {
        const result = await runProcess(candidate, ['--version'], { cwd, timeoutMs: 5000 });
        if (result.exitCode === 0 || /Mercury Compiler/i.test(result.stdout + result.stderr)) {
            const versionMatch = (result.stdout + result.stderr).match(/version\s+([0-9][0-9.\-a-zA-Z]*)/i);
            return { found: true, executable: candidate, version: versionMatch?.[1] };
        }
    }
    return {
        found: false,
        error: configured
            ? `Could not run '${configured}'. Check mercuryTools.compilerPath.`
            : "mmc was not found on PATH. Install the Mercury compiler or set mercuryTools.compilerPath.",
    };
}

export function compilerMissingMessage(): string {
    return 'Mercury compiler not found. Syntax and basic language features remain available. Configure mercuryTools.compilerPath or install Mercury.';
}
