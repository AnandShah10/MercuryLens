import { CompileResult, CompilerDiagnostic } from '../../../server/src/compiler/mercuryCompilerAdapter';

/**
 * A deterministic stand-in for MercuryCompilerAdapter, used by unit tests
 * that need to exercise diagnostic plumbing without depending on whether
 * `mmc` is installed on the machine running the tests. Integration tests
 * (test/integration) use the real compiler when available instead.
 */
export class MockCompilerAdapter {
    constructor(private fixtures: Record<string, CompilerDiagnostic[]>) {}

    async detect(): Promise<{ found: boolean; path?: string; version?: string }> {
        return { found: true, path: '/mock/mmc', version: '22.01.8 (mock)' };
    }

    async check(files: string[]): Promise<CompileResult> {
        const diagnostics = files.flatMap((f) => this.fixtures[f] ?? []);
        return {
            success: diagnostics.every((d) => d.severity !== 'error'),
            diagnostics,
            stdout: '',
            stderr: '',
            exitCode: diagnostics.some((d) => d.severity === 'error') ? 1 : 0,
            durationMs: 1,
            timedOut: false,
        };
    }
}
