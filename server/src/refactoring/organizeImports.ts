import { ModuleDoc, Range } from '../parser/ast';
import { WorkspaceIndex } from '../symbols/workspaceIndex';

export interface OrganizeImportsEdit {
    /** The exact source range to replace (spans one original `:- import_module`/
     * `:- use_module` declaration, including its own doc-comment lines and
     * trailing period, per the parser's symbol ranges). */
    range: Range;
    /** Replacement text. Empty string means "delete this declaration". */
    newText: string;
}

/**
 * Computes the edits for "Mercury: Organize Imports": within each of
 * `:- import_module` and `:- use_module` separately (the two are never
 * merged with each other, since they have different qualification
 * semantics), this:
 *
 *   1. Drops a module name if it can be confirmed unused (see the
 *      conservative-safety note below).
 *   2. Deduplicates a module name that appears on more than one
 *      declaration line of the same kind.
 *   3. Sorts the surviving names alphabetically.
 *   4. Rewrites the FIRST declaration line of that kind to hold the full,
 *      deduped, sorted, used-only list (or deletes it if the list is now
 *      empty), and deletes every other declaration line of that kind
 *      entirely — collapsing what may have been several scattered lines
 *      into one clean one, the way "organize imports" conventionally
 *      behaves in other language tooling.
 *
 * CONSERVATIVE SAFETY NOTE: a module can only be confirmed unused if this
 * extension can see its exported predicate/function names — i.e. it's
 * indexed in the current workspace (see `WorkspaceIndex.findModule`).
 * Standard-library and other external modules (`io`, `list`, `string`,
 * ...) are never indexed this way, so this function has no way to rule
 * out an unqualified call to one of their predicates and always keeps
 * them, even if they look unused. This is a deliberate choice, not an
 * oversight: incorrectly deleting a real import is a far worse outcome
 * than leaving an actually-unused one in place, and this extension does
 * not guess at safety-relevant answers it cannot verify (see
 * docs/development.md's engineering principles). A module IS considered
 * used, regardless of index status, if it's referenced anywhere as an
 * explicit qualifier (`modname.something`) or via a call to one of its
 * indexed exported names.
 */
export function computeOrganizeImportsEdits(doc: ModuleDoc, text: string, index: WorkspaceIndex): OrganizeImportsEdit[] {
    const importLines = doc.symbols.filter((s) => s.kind === 'import');
    const useLines = doc.symbols.filter((s) => s.kind === 'use_module');

    // The usage checks below must never see the import/use_module
    // declaration lines themselves — otherwise a declaration like
    // `:- import_module lib.` trivially "proves" `lib` is used by
    // matching its own `lib.` qualifier syntax, making every import look
    // used regardless of whether anything in the actual code references
    // it. Blanking those lines out of the text used for the usage scan
    // (never the ranges returned to the caller, which still come from the
    // real, original declarations) closes that off.
    const textForUsageCheck = blankOutRanges(text, [...importLines, ...useLines].map((s) => s.range));

    const edits: OrganizeImportsEdit[] = [];
    edits.push(...computeEditsForKind(importLines, 'import_module', textForUsageCheck, index));
    edits.push(...computeEditsForKind(useLines, 'use_module', textForUsageCheck, index));
    return edits;
}

/** Replaces every character (except newlines, to keep line numbers intact)
 * within each given range with a space, so later text scans can never
 * "see" that content. */
function blankOutRanges(text: string, ranges: Range[]): string {
    const lines = text.split(/\r\n|\n/);
    for (const range of ranges) {
        for (let line = range.startLine; line <= range.endLine && line < lines.length; line++) {
            const startCol = line === range.startLine ? range.startCol : 0;
            const endCol = line === range.endLine ? range.endCol : lines[line].length;
            const original = lines[line];
            lines[line] = original.slice(0, startCol) + ' '.repeat(Math.max(0, endCol - startCol)) + original.slice(endCol);
        }
    }
    return lines.join('\n');
}

function isModuleUsed(mod: string, text: string, index: WorkspaceIndex): boolean {
    const modDoc = index.findModule(mod);
    const exportedNames = modDoc ? modDoc.symbols.filter((s) => s.kind === 'predicate' || s.kind === 'function').map((s) => s.name) : [];
    const qualifiedRe = new RegExp(`\\b${mod.replace(/\./g, '\\.')}\\.`);
    if (qualifiedRe.test(text)) return true;
    if (exportedNames.length === 0) {
        // Not indexed in this workspace (e.g. a standard-library module) —
        // cannot verify non-use, so conservatively assume used.
        return true;
    }
    const anyCallRe = new RegExp(`\\b(${exportedNames.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\s*\\(`);
    return anyCallRe.test(text);
}

function computeEditsForKind(
    lines: ModuleDoc['symbols'],
    keyword: 'import_module' | 'use_module',
    text: string,
    index: WorkspaceIndex,
): OrganizeImportsEdit[] {
    if (lines.length === 0) return [];

    const allModules: string[] = [];
    for (const sym of lines) {
        for (const mod of sym.importedModules ?? []) {
            if (!allModules.includes(mod)) allModules.push(mod);
        }
    }
    const usedSorted = allModules.filter((m) => isModuleUsed(m, text, index)).sort((a, b) => a.localeCompare(b));

    const currentFirstLineModules = lines[0].importedModules ?? [];
    const firstLineAlreadyCanonical = lines.length === 1 && arraysEqual(currentFirstLineModules, usedSorted);

    const edits: OrganizeImportsEdit[] = [];
    if (!firstLineAlreadyCanonical) {
        edits.push({
            range: lines[0].range,
            newText: usedSorted.length > 0 ? `:- ${keyword} ${usedSorted.join(', ')}.` : '',
        });
    }
    for (const extra of lines.slice(1)) {
        edits.push({ range: extra.range, newText: '' });
    }
    return edits;
}

function arraysEqual(a: string[], b: string[]): boolean {
    return a.length === b.length && a.every((v, i) => v === b[i]);
}
