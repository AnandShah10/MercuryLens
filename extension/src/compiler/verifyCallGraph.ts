import * as vscode from 'vscode';
import * as path from 'path';
import { detectCompiler } from './detector';
import { runProcess } from '../utils/process';
import { extractNamedPredicateRefs } from '../utils/parseCompilerPredicateRefs';

export interface CallGraphVerification {
    /** True only if a compiler was found and actually run. */
    ranByCompiler: boolean;
    /** "name/arity" tokens (module-unqualified — see caveat below) that a
     * compiler diagnostic specifically named, e.g. from an "undefined
     * predicate `foo/2'" or "ambiguous call to `bar/3'" message. Call graph
     * nodes matching one of these are flagged in the UI as having a
     * compiler-reported problem, rather than presented as an ordinary
     * resolved edge. */
    flaggedPredicates: Set<string>;
    /** True if mmc ran and reported zero errors across the checked files —
     * i.e. the program compiles. This is real evidence that whichever
     * overload Mercury's own resolver picked for each call site was type-
     * and mode-correct, but it does NOT prove this extension's heuristic
     * picked the SAME overload when more than one same-arity candidate
     * exists (a case Mercury itself resolves using full type inference,
     * which this static heuristic cannot replicate). That residual gap is
     * stated in the call graph view's toolbar rather than glossed over. */
    compilesCleanly: boolean;
    error?: string;
}

/**
 * Runs `mmc --errorcheck-only` across every `.m` file in the workspace and
 * extracts any backtick-quoted `name/arity` tokens from error/warning
 * messages (Mercury's compiler consistently quotes predicate/function
 * references this way, e.g. "undefined predicate `foo/2'" or "ambiguous
 * overloading of `bar/3'"). This does not reimplement or guess at Mercury's
 * own name resolution — it only reports what the real compiler already
 * said, keyed by the same `name/arity` identity this extension's heuristic
 * call graph uses for its own nodes, so the UI can flag exactly the nodes
 * the compiler itself had something to say about.
 */
export async function verifyCallGraph(folder: vscode.WorkspaceFolder): Promise<CallGraphVerification> {
    const detection = await detectCompiler(folder.uri.fsPath);
    if (!detection.found || !detection.executable) {
        return { ranByCompiler: false, flaggedPredicates: new Set(), compilesCleanly: false, error: detection.error };
    }

    const files = await vscode.workspace.findFiles(new vscode.RelativePattern(folder, '**/*.m'), '**/Mercury/**');
    if (files.length === 0) {
        return { ranByCompiler: false, flaggedPredicates: new Set(), compilesCleanly: false, error: 'No .m files found in the workspace.' };
    }

    const relativePaths = files.map((f) => path.relative(folder.uri.fsPath, f.fsPath));
    const result = await runProcess(detection.executable, ['--errorcheck-only', ...relativePaths], {
        cwd: folder.uri.fsPath,
        timeoutMs: 60000,
    });

    const combined = result.stdout + '\n' + result.stderr;
    const flagged = extractNamedPredicateRefs(combined);

    return { ranByCompiler: true, flaggedPredicates: flagged, compilesCleanly: result.exitCode === 0 };
}
