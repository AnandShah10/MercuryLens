import { WorkspaceIndex } from '../symbols/workspaceIndex';
import { buildCallGraph, CallGraph } from '../callgraph/callGraph';

/**
 * `buildCallGraph` walks every clause in every indexed document (and, for
 * each call site, scans every declared symbol looking for arity matches) —
 * O(files × clauses × symbols) in the worst case. It's invoked on every
 * `mercury/callGraph` request, and indirectly (via `countCallers`/
 * `countReferences`, which do their own comparable workspace-wide scans)
 * on every CodeLens refresh for every predicate/function in an open file.
 * On a large workspace this is real, repeated, avoidable work between
 * edits — exactly the "cache parsed/compiled information where
 * appropriate" this project's engineering principles ask for.
 *
 * This cache is intentionally simple: keyed by `WorkspaceIndex.version`
 * (bumped on every document update/removal) plus the optional module
 * filter, so it's invalidated automatically and correctly on any edit
 * anywhere in the workspace — no manual invalidation calls to forget, at
 * the cost of not being fine-grained (any edit anywhere invalidates the
 * whole cache, not just the affected module). For a fuller implementation,
 * a finer-grained cache keyed per-module would avoid invalidating on
 * unrelated edits, but the current coarse invalidation is correct and
 * simple, which matters more at this scale than the extra hit rate would.
 */
export class CallGraphCache {
    private cached: { version: number; moduleFilter: string | undefined; graph: CallGraph } | undefined;

    get(index: WorkspaceIndex, moduleFilter: string | undefined): CallGraph {
        if (this.cached && this.cached.version === index.version && this.cached.moduleFilter === moduleFilter) {
            return this.cached.graph;
        }
        const graph = buildCallGraph(index, { moduleFilter });
        this.cached = { version: index.version, moduleFilter, graph };
        return graph;
    }

    /** For tests: reports whether the last `get()` call was served from
     * cache (true) or recomputed (false is impossible to observe directly
     * without this, since `get` always returns a valid graph either way). */
    isFresh(index: WorkspaceIndex, moduleFilter: string | undefined): boolean {
        return !!this.cached && this.cached.version === index.version && this.cached.moduleFilter === moduleFilter;
    }
}
