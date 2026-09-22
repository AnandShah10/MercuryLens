import { WorkspaceIndex } from '../symbols/workspaceIndex';

export interface CallGraphNode {
    id: string; // "module.name/arity" or "name/arity" if module unknown
    name: string;
    module?: string;
    /** Declared arity as this project counts it — for functions this
     * includes the return-value "slot" (see `signatureLabel` in server.ts),
     * which is one more than the number of arguments written at a call
     * site. Use `callSiteArity` to compare against a call's parenthesized
     * argument count. */
    arity?: number;
    kind: 'predicate' | 'function';
    uri: string;
    line: number;
}

/** The number of arguments actually written in parentheses at a call site
 * for this node — `arity` minus 1 for functions (whose return value is
 * never written inside the call's parens), `arity` unchanged for
 * predicates. */
function callSiteArity(node: CallGraphNode): number | undefined {
    if (node.arity === undefined) return undefined;
    return node.kind === 'function' ? Math.max(0, node.arity - 1) : node.arity;
}

export interface CallGraphEdge {
    from: string;
    to: string;
}

export interface CallGraph {
    nodes: CallGraphNode[];
    edges: CallGraphEdge[];
}

/**
 * Builds a predicate/function call graph from the workspace index.
 *
 * This is a static-text heuristic: a call site is recognized as
 * `identifier(` in a clause body, matched by name (and, where unambiguous,
 * arity) against declared predicates/functions in the index. It does not
 * perform overload resolution the way the Mercury compiler would (Mercury
 * allows multiple predicates with the same name but different arity, and
 * higher-order calls cannot be resolved statically at all). Where a call
 * name matches more than one declared arity, an edge is added to each
 * candidate rather than guessing. This is clearly documented to the user in
 * the call graph view rather than presented as compiler-verified data.
 */
export function buildCallGraph(index: WorkspaceIndex, opts?: { moduleFilter?: string }): CallGraph {
    const nodes = new Map<string, CallGraphNode>();
    const edges: CallGraphEdge[] = [];

    for (const doc of index.allDocs()) {
        if (opts?.moduleFilter && doc.moduleName !== opts.moduleFilter) continue;
        for (const sym of doc.symbols) {
            if (sym.kind !== 'predicate' && sym.kind !== 'function') continue;
            const id = nodeId(sym.module, sym.name, sym.arity);
            if (!nodes.has(id)) {
                nodes.set(id, { id, name: sym.name, module: sym.module, arity: sym.arity, kind: sym.kind, uri: doc.uri, line: sym.range.startLine });
            }
        }
    }

    for (const doc of index.allDocs()) {
        if (opts?.moduleFilter && doc.moduleName !== opts.moduleFilter) continue;
        for (const clause of doc.clauses) {
            // clause.arity (from the parser) always counts parameters as
            // written at a call site — it does NOT include a function's
            // return slot — so compare it against callSiteArity(n), not
            // n.arity directly (which does include that slot for functions).
            // This is used only as a *preference*, not a hard requirement,
            // when a file happens to declare more than one predicate/
            // function under the same name (arity overloading): state-
            // variable clause heads (e.g. `!IO`) are now counted precisely
            // (a bare `!Name` counts as 2 — see docs/architecture.md's
            // arity note), so this exact match holds in the common case,
            // but falling back rather than requiring it keeps this
            // resilient to any other clause-head shape this project's
            // structural parser doesn't fully resolve.
            const sameNameInFile = [...nodes.values()].filter((n) => n.name === clause.name && n.uri === doc.uri);
            const arityMatch = sameNameInFile.filter((n) => callSiteArity(n) === clause.arity);
            const callerCandidates = arityMatch.length > 0 ? arityMatch : sameNameInFile;
            if (callerCandidates.length === 0) continue;
            const callerId = callerCandidates[0].id;
            for (const call of clause.calls) {
                const sameName = [...nodes.values()].filter((n) => n.name === call.name);
                // Prefer an exact-arity match when the call site's argument
                // count is known and at least one declared node matches it
                // (this resolves the common "same name, different arity"
                // case exactly rather than heuristically); otherwise fall
                // back to every same-name node, since guessing wrong would
                // silently drop a real edge.
                const exact = call.arity !== undefined ? sameName.filter((n) => callSiteArity(n) === call.arity) : [];
                const targets = exact.length > 0 ? exact : sameName;
                for (const target of targets) {
                    if (!edges.some((e) => e.from === callerId && e.to === target.id)) {
                        edges.push({ from: callerId, to: target.id });
                    }
                }
            }
        }
    }

    return { nodes: [...nodes.values()], edges };
}

function nodeId(module: string | undefined, name: string, arity: number | undefined): string {
    return `${module ?? '?'}.${name}/${arity ?? '?'}`;
}
