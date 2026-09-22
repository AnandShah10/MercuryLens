import { ModuleDoc } from '../parser/ast';
import { WorkspaceIndex } from '../symbols/workspaceIndex';

export interface SyntacticDiagnostic {
    range: { startLine: number; startCol: number; endLine: number; endCol: number };
    severity: 'error' | 'warning' | 'info';
    message: string;
    source: 'mercury-syntax';
}

/**
 * Best-effort diagnostics derived purely from the structural parse, used
 * only as a fallback when the real Mercury compiler is not available (or
 * for instant feedback between compiler runs). These are intentionally
 * narrow in scope — they flag things this extension can determine with
 * confidence from syntax alone, and explicitly avoid claiming to catch
 * type, mode, or determinism errors, which require real semantic analysis
 * that only `mmc` can provide correctly.
 */
export function computeSyntacticDiagnostics(doc: ModuleDoc, index: WorkspaceIndex): SyntacticDiagnostic[] {
    const diagnostics: SyntacticDiagnostic[] = [];

    if (!doc.moduleName) {
        diagnostics.push({
            range: { startLine: 0, startCol: 0, endLine: 0, endCol: 1 },
            severity: 'warning',
            message: "No ':- module <name>.' declaration was found in this file.",
            source: 'mercury-syntax',
        });
    }

    // Unresolved import_module/use_module: the named module is not present
    // anywhere in the workspace index. This can be a false positive for
    // standard-library modules (io, list, int, string, ...), which aren't
    // indexed since their source generally isn't in the user's workspace —
    // so we only warn, and only when the name isn't a well-known stdlib
    // module, to keep the signal-to-noise ratio high.
    const STDLIB = new Set([
        'io', 'list', 'int', 'float', 'string', 'char', 'bool', 'array', 'map', 'set', 'assoc_list',
        'require', 'exception', 'maybe', 'pair', 'std_util', 'univ', 'term', 'varset', 'random',
        'string.builder', 'stream', 'bag', 'bimap', 'bitmap', 'digraph', 'queue', 'rbtree', 'rtree',
        'sparse_bitset', 'tree234', 'version_array', 'thread', 'time', 'benchmarking', 'getopt', 'dir',
    ]);
    for (const sym of doc.symbols) {
        if ((sym.kind === 'import' || sym.kind === 'use_module') && sym.importedModules) {
            for (const mod of sym.importedModules) {
                if (STDLIB.has(mod)) continue;
                if (!index.findModule(mod)) {
                    diagnostics.push({
                        range: sym.nameRange,
                        severity: 'info',
                        message: `Module '${mod}' was not found among the .m files currently indexed in this workspace. If it's a library or standard-library module this is expected; otherwise check the module name and that the file is part of the workspace.`,
                        source: 'mercury-syntax',
                    });
                }
            }
        }
    }

    // Predicate/function declared with a determinism but with no clauses at
    // all in this file. This can be legitimate (declared in one module,
    // defined via a foreign_proc pragma, or defined in another file for a
    // sub-module), so this is surfaced as 'info', not an error.
    for (const sym of doc.symbols) {
        if (sym.kind !== 'predicate' && sym.kind !== 'function') continue;
        const hasClause = doc.clauses.some((c) => c.name === sym.name && (sym.arity === undefined || c.arity === sym.arity));
        const hasForeignProc = doc.symbols.some((s) => s.kind === 'pragma' && s.raw.includes('foreign_proc') && s.raw.includes(sym.name));
        if (!hasClause && !hasForeignProc) {
            diagnostics.push({
                range: sym.nameRange,
                severity: 'info',
                message: `No clause for '${sym.name}/${sym.arity ?? '?'}' was found in this file. It may be defined elsewhere (another file, or a foreign_proc pragma).`,
                source: 'mercury-syntax',
            });
        }
    }

    // Duplicate module declarations within the same file.
    const moduleDecls = doc.symbols.filter((s) => s.kind === 'module');
    if (moduleDecls.length > 1) {
        for (const extra of moduleDecls.slice(1)) {
            diagnostics.push({
                range: extra.nameRange,
                severity: 'warning',
                message: `Duplicate ':- module' declaration; a file should declare exactly one top-level module.`,
                source: 'mercury-syntax',
            });
        }
    }

    return diagnostics;
}
