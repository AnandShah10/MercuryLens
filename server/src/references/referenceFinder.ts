import { WorkspaceIndex } from '../symbols/workspaceIndex';
import { Range } from '../parser/ast';

/**
 * Reference/rename logic, factored out of server.ts so it's testable
 * without an LSP connection. This returns plain `{ uri, range }` data;
 * server.ts's `onReferences`/`onRenameRequest` handlers convert that to the
 * `vscode-languageserver` `Location`/`TextEdit` types, since this module
 * has no LSP dependency of its own.
 *
 * Like the rest of this project's navigation features, this is a
 * name-based (not overload-resolved) match — see
 * docs/language-server.md's call-graph caveat, which applies here too.
 */

export interface RefLocation {
    uri: string;
    range: Range;
}

/** Every call site and declaration site named `name` across the indexed
 * workspace. */
export function findReferences(index: WorkspaceIndex, name: string): RefLocation[] {
    const locations: RefLocation[] = [];
    for (const doc of index.allDocs()) {
        for (const clause of doc.clauses) {
            for (const call of clause.calls) {
                if (call.name === name) locations.push({ uri: doc.uri, range: call.range });
            }
        }
        for (const sym of doc.symbols) {
            if (sym.name === name) locations.push({ uri: doc.uri, range: sym.nameRange });
        }
    }
    return locations;
}

export interface RenameEdit {
    uri: string;
    range: Range;
}

export interface RenameValidation {
    valid: boolean;
    reason?: string;
}

/** A rename target must be a legal Mercury identifier. Mercury predicate/
 * function/type/typeclass names are lowercase-initial atoms; this check is
 * deliberately conservative (rejects anything that isn't a plain
 * lowercase-starting identifier) since renaming to an invalid or
 * differently-cased name would silently produce a program that no longer
 * compiles. */
export function validateRenameTarget(newName: string): RenameValidation {
    if (!/^[a-z][A-Za-z0-9_]*$/.test(newName)) {
        return { valid: false, reason: 'Mercury predicate/function/type/typeclass names must start with a lowercase letter and contain only letters, digits, and underscores.' };
    }
    return { valid: true };
}

/** Computes the edits to rename every declaration and call-site occurrence
 * of `name` (as a predicate, function, type, or typeclass) across the
 * workspace. Does not touch comments, strings, or unrelated identifiers
 * that merely share the same text within a different lexical role. */
export function computeRenameEdits(index: WorkspaceIndex, name: string): RenameEdit[] {
    const edits: RenameEdit[] = [];
    for (const doc of index.allDocs()) {
        for (const sym of doc.symbols) {
            if (sym.name === name && (sym.kind === 'predicate' || sym.kind === 'function' || sym.kind === 'type' || sym.kind === 'typeclass')) {
                edits.push({ uri: doc.uri, range: sym.nameRange });
            }
        }
        for (const clause of doc.clauses) {
            for (const call of clause.calls) {
                if (call.name === name) edits.push({ uri: doc.uri, range: call.range });
            }
        }
    }
    return edits;
}
