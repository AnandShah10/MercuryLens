/** Pure text-analysis helpers for the Extract Predicate refactoring.
 * Deliberately has no dependency on the `vscode` module so it can be unit
 * tested with plain mocha/ts-node (extension/src/commands/*.ts import
 * `vscode`, which is only resolvable inside a running VS Code extension
 * host, so command modules themselves are covered by the integration
 * suite instead — see test/unit/extraction/*.test.ts for these helpers). */

/** Returns the net bracket depth change across `text` (0 means balanced),
 * respecting string/quoted-atom literals so brackets inside them are
 * ignored. */
export function findBracketImbalance(text: string): number {
    let depth = 0;
    let inString = false;
    let inAtom = false;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (inString) { if (ch === '\\') { i++; continue; } if (ch === '"') inString = false; continue; }
        if (inAtom) { if (ch === '\\') { i++; continue; } if (ch === "'") inAtom = false; continue; }
        if (ch === '"') { inString = true; continue; }
        if (ch === "'") { inAtom = true; continue; }
        if (ch === '(' || ch === '[' || ch === '{') depth++;
        else if (ch === ')' || ch === ']' || ch === '}') depth--;
    }
    return depth;
}

/** Collects the set of Mercury variable names (capitalized identifiers, or
 * underscore-prefixed) occurring in `text`. */
export function collectVariables(text: string): Set<string> {
    const set = new Set<string>();
    const re = /\b([A-Z_][A-Za-z0-9_]*)\b/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) set.add(m[1]);
    return set;
}

export function escapeRegExp(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export interface ExtractedArg {
    name: string;
    mode: 'in' | 'out';
    source: 'declared' | 'heuristic';
}

/** Computes the argument list (name, mode, and how the mode was determined)
 * for a predicate to be extracted from `selection`, given the full
 * `clauseText` it was selected from and the relative offsets of the
 * selection within it. `declaredModeFor` supplies ground-truth modes for
 * variables that are the enclosing predicate's own head arguments (see
 * extractPredicateCommand.ts for how that map is built); anything else
 * falls back to the first-occurrence-order heuristic described there. */
export function computeExtractedArgs(
    clauseText: string,
    relStart: number,
    relEnd: number,
    trimmedSelection: string,
    declaredModeFor: Map<string, string>,
): ExtractedArg[] {
    const before = clauseText.slice(0, relStart);
    const after = clauseText.slice(relEnd);
    const insideVars = collectVariables(trimmedSelection);
    const outsideVars = collectVariables(before + after);
    const shared = [...insideVars].filter((v) => outsideVars.has(v)).sort((a, b) => clauseText.indexOf(a) - clauseText.indexOf(b));

    return shared.map((v) => {
        const declared = declaredModeFor.get(v);
        if (declared) {
            const mode: 'in' | 'out' = ['out', 'uo', 'muo'].includes(declared) ? 'out' : 'in';
            return { name: v, mode, source: 'declared' as const };
        }
        const firstIdxMatch = clauseText.match(new RegExp(`\\b${escapeRegExp(v)}\\b`));
        const firstIdx = firstIdxMatch ? firstIdxMatch.index ?? -1 : -1;
        const mode: 'in' | 'out' = firstIdx >= relStart && firstIdx < relEnd ? 'out' : 'in';
        return { name: v, mode, source: 'heuristic' as const };
    });
}
