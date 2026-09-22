import { ModuleDoc, SymbolNode } from '../parser/ast';
import { parseModule } from '../parser/parser';

export interface IndexedSymbol {
    symbol: SymbolNode;
    uri: string;
}

/**
 * Maintains a parsed-document + symbol index across the whole workspace.
 * Re-parsing is per-document and incremental at the granularity of "a
 * document changed" (we do not re-parse unrelated files), which keeps
 * indexing responsive on large workspaces without needing a persistent
 * on-disk cache for this scope.
 */
export class WorkspaceIndex {
    private docs = new Map<string, ModuleDoc>();
    /** Bumped on every `update`/`remove`. Lets downstream consumers (e.g.
     * server/src/cache/callGraphCache.ts) cheaply detect "has anything
     * changed since I last computed something expensive" without diffing
     * document contents. */
    private _version = 0;

    get version(): number {
        return this._version;
    }

    update(uri: string, text: string): ModuleDoc {
        const doc = parseModule(uri, text);
        this.docs.set(uri, doc);
        this._version++;
        return doc;
    }

    remove(uri: string): void {
        this.docs.delete(uri);
        this._version++;
    }

    get(uri: string): ModuleDoc | undefined {
        return this.docs.get(uri);
    }

    allDocs(): ModuleDoc[] {
        return [...this.docs.values()];
    }

    /** Finds the module doc that declares `:- module <name>.` */
    findModule(name: string): ModuleDoc | undefined {
        return this.allDocs().find((d) => d.moduleName === name);
    }

    /** Finds all predicate/function declarations matching a name (optionally
     * qualified as Module.name), optionally filtered by arity. */
    findDeclarations(name: string, arity?: number): IndexedSymbol[] {
        const dotIdx = name.lastIndexOf('.');
        const moduleQualifier = dotIdx >= 0 ? name.slice(0, dotIdx) : undefined;
        const bareName = dotIdx >= 0 ? name.slice(dotIdx + 1) : name;

        const results: IndexedSymbol[] = [];
        for (const doc of this.allDocs()) {
            if (moduleQualifier && doc.moduleName !== moduleQualifier) continue;
            for (const sym of doc.symbols) {
                if ((sym.kind === 'predicate' || sym.kind === 'function') && sym.name === bareName) {
                    if (arity !== undefined && sym.arity !== undefined && sym.arity !== arity) continue;
                    results.push({ symbol: sym, uri: doc.uri });
                }
            }
        }
        return results;
    }

    /** Finds a type, typeclass, module, or other named declaration (not
     * predicates/functions — use findDeclarations for those). */
    findNonCallable(name: string, kinds: SymbolNode['kind'][]): IndexedSymbol[] {
        const dotIdx = name.lastIndexOf('.');
        const moduleQualifier = dotIdx >= 0 ? name.slice(0, dotIdx) : undefined;
        const bareName = dotIdx >= 0 ? name.slice(dotIdx + 1) : name;
        const results: IndexedSymbol[] = [];
        for (const doc of this.allDocs()) {
            if (moduleQualifier && doc.moduleName !== moduleQualifier) continue;
            for (const sym of doc.symbols) {
                if (kinds.includes(sym.kind) && sym.name === bareName) {
                    results.push({ symbol: sym, uri: doc.uri });
                }
            }
        }
        return results;
    }

    /** Best-effort caller count: how many clause bodies across the
     * workspace contain a call site matching this predicate/function name.
     * This is a static-text heuristic (see server/src/callgraph), not a
     * semantic call count from the compiler. When `arity` is given, call
     * sites whose computed argument count is known and differs from it are
     * excluded — call sites where the argument count could not be
     * determined (e.g. a higher-order partial application) still count,
     * since excluding them would silently under-report rather than being
     * conservatively inclusive about what this heuristic can't resolve. */
    countCallers(name: string, arity?: number): number {
        let count = 0;
        for (const doc of this.allDocs()) {
            for (const clause of doc.clauses) {
                if (clause.calls.some((c) => c.name === name && (arity === undefined || c.arity === undefined || c.arity === arity))) count++;
            }
        }
        return count;
    }

    /** Best-effort reference count: call sites (arity-filtered per
     * `countCallers`'s rules when `arity` is given, where `arity` is
     * interpreted as a call-site argument count — see server.ts's
     * `callSiteArity` for how a function's declared arity is converted to
     * this before calling in) plus this name's own declaration sites
     * (never arity-filtered, since a declaration's arity is in different
     * units for functions — see `countCallers`'s doc comment; this only
     * affects the second-order "declarations that share this name" count,
     * not the call-site count that matters for CodeLens accuracy). */
    countReferences(name: string, arity?: number): number {
        let count = 0;
        for (const doc of this.allDocs()) {
            for (const clause of doc.clauses) {
                count += clause.calls.filter((c) => c.name === name && (arity === undefined || c.arity === undefined || c.arity === arity)).length;
            }
            for (const sym of doc.symbols) {
                if (sym.name === name) count++;
            }
        }
        return count;
    }
}
