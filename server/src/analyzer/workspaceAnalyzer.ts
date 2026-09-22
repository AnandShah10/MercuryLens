import * as path from 'path';
import { promises as fs } from 'fs';
import { URI } from 'vscode-uri';

import { WorkspaceIndex } from '../symbols/workspaceIndex';
import { MercuryCompilerAdapter } from '../compiler/mercuryCompilerAdapter';
import { computeSyntacticDiagnostics } from '../diagnostics/syntacticDiagnostics';
import { Range } from '../parser/ast';

/**
 * Orchestrates the pieces `parser/` and `symbols/` can't decide on their
 * own: walking the workspace for `.m` files to build the initial index, and
 * choosing (per docs/compiler-integration.md) between compiler-backed and
 * syntactic-fallback diagnostics for a given document. server.ts owns LSP
 * wiring (connection events, LSP-typed request/response shapes) and
 * delegates the actual analysis work here, so this class has no dependency
 * on `vscode-languageserver` and can be unit tested directly (see
 * test/unit/analyzer/workspaceAnalyzer.test.ts).
 */

export interface AnalyzerDiagnostic {
    range: Range;
    severity: 'error' | 'warning' | 'info';
    message: string;
    source: 'mmc' | 'mercury-syntax';
}

export interface AnalyzerSettings {
    compilerArguments: string[];
    maxAnalysisTime: number;
}

export class WorkspaceAnalyzer {
    readonly index = new WorkspaceIndex();
    readonly compiler: MercuryCompilerAdapter;

    constructor(compilerPath: string | undefined = undefined) {
        this.compiler = new MercuryCompilerAdapter(compilerPath);
    }

    /** Recursively walks `root` for `.m` files (skipping `node_modules`,
     * dotfiles/dirs, and the compiler's own `Mercury/` build-artifact
     * directory) and parses each into the index. Read failures on
     * individual files are reported via `onWarning` and otherwise
     * skipped — one unreadable file must not abort indexing the rest of
     * the workspace. */
    async indexWorkspace(root: string, onWarning?: (message: string) => void): Promise<number> {
        const files: string[] = [];
        const walk = async (dir: string): Promise<void> => {
            let entries;
            try {
                entries = await fs.readdir(dir, { withFileTypes: true });
            } catch {
                return;
            }
            for (const entry of entries) {
                if (entry.name === 'node_modules' || entry.name.startsWith('.') || entry.name === 'Mercury') continue;
                const full = path.join(dir, entry.name);
                if (entry.isDirectory()) await walk(full);
                else if (entry.name.endsWith('.m')) files.push(full);
            }
        };
        await walk(root);

        for (const file of files) {
            try {
                const text = await fs.readFile(file, 'utf8');
                this.index.update(URI.file(file).toString(), text);
            } catch (err) {
                onWarning?.(`Failed to index ${file}: ${String(err)}`);
            }
        }
        return files.length;
    }

    /** Computes diagnostics for one document: compiler-backed
     * (`mmc --errorcheck-only`) when a compiler is detected, filtered to
     * just this file; syntactic fallback otherwise. Never throws — a
     * compiler crash/timeout surfaces as a single informational diagnostic
     * rather than losing all feedback for the file. */
    async computeDiagnostics(uri: string, text: string, workspaceRoot: string | undefined, settings: AnalyzerSettings): Promise<AnalyzerDiagnostic[]> {
        const parsed = this.index.get(uri) ?? this.index.update(uri, text);
        const fsPath = URI.parse(uri).fsPath;
        const detection = await this.compiler.detect();

        if (detection.found) {
            const cwd = workspaceRoot ?? path.dirname(fsPath);
            const result = await this.compiler.check([fsPath], cwd, settings.compilerArguments, settings.maxAnalysisTime);
            const diagnostics: AnalyzerDiagnostic[] = [];
            for (const d of result.diagnostics) {
                if (path.resolve(d.file) !== path.resolve(fsPath) && !fsPath.endsWith(d.file)) continue;
                diagnostics.push({
                    range: { startLine: d.startLine, startCol: 0, endLine: d.endLine, endCol: 1000 },
                    severity: d.severity,
                    message: d.message,
                    source: 'mmc',
                });
            }
            if (!result.success && result.diagnostics.length === 0 && result.stderr) {
                diagnostics.push({
                    range: { startLine: 0, startCol: 0, endLine: 0, endCol: 1 },
                    severity: 'warning',
                    message: `mmc reported a problem that could not be parsed into a per-line diagnostic: ${result.stderr.trim().slice(0, 500)}`,
                    source: 'mmc',
                });
            }
            return diagnostics;
        }

        return computeSyntacticDiagnostics(parsed, this.index).map((d) => ({
            range: d.range,
            severity: d.severity,
            message: `${d.message} (syntactic check only — install/configure mmc for full type, mode, and determinism checking.)`,
            source: 'mercury-syntax' as const,
        }));
    }
}
