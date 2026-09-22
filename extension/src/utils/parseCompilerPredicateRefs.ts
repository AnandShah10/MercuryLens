/** Pure text-analysis helper — no `vscode` dependency, so it's independently
 * unit-testable (see test/unit/verification/*.test.ts). Used by
 * ../compiler/verifyCallGraph.ts. */

/**
 * Extracts every backtick-quoted `name/arity` token from raw `mmc` output
 * (e.g. "undefined predicate `foo/2'" or "ambiguous overloading of
 * `bar/3'"). Mercury's compiler consistently quotes predicate/function
 * references this way. Names are unqualified (the part after the last '.'
 * is kept) so they match this project's own unqualified node-name
 * convention.
 */
export function extractNamedPredicateRefs(text: string): Set<string> {
    const refs = new Set<string>();
    const re = /`([A-Za-z_][A-Za-z0-9_.]*)\/(\d+)'/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
        const name = m[1].includes('.') ? m[1].slice(m[1].lastIndexOf('.') + 1) : m[1];
        refs.add(`${name}/${m[2]}`);
    }
    return refs;
}
