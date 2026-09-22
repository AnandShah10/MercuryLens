/** Shared structural representation produced by the lightweight parser.
 *
 * This is a "structural AST": it captures declarations, clause heads, and
 * import/module structure precisely enough for navigation, symbol indexing,
 * CodeLens, hover, and the AST Explorer — but it does NOT represent full
 * term structure (operator precedence, nested expression trees) the way the
 * real Mercury compiler's AST does. Where a feature needs that level of
 * semantic fidelity (e.g. authoritative type/mode checking), this extension
 * defers to the real `mmc` compiler (see server/src/compiler) rather than
 * inventing it.
 */

export interface Range {
    startLine: number;
    startCol: number;
    endLine: number;
    endCol: number;
}

export type Determinism =
    | 'det' | 'semidet' | 'multi' | 'nondet' | 'failure' | 'erroneous' | 'cc_multi' | 'cc_nondet';

export type Purity = 'pure' | 'semipure' | 'impure';

export interface ArgMode {
    /** Textual type as written, e.g. "int", "list(T)". May be empty if only a mode/inst was given. */
    type?: string;
    /** Textual mode as written, e.g. "in", "out", "di", "uo", or a compound mode. */
    mode?: string;
    raw: string;
}

export interface DocComment {
    text: string;
    range: Range;
}

export type SymbolNodeKind =
    | 'module'
    | 'predicate'
    | 'function'
    | 'mode'
    | 'type'
    | 'typeclass'
    | 'instance'
    | 'import'
    | 'use_module'
    | 'clause'
    | 'pragma'
    | 'initialise'
    | 'finalise'
    | 'unknown';

export interface SymbolNode {
    kind: SymbolNodeKind;
    /** Unqualified name, e.g. "greet" */
    name: string;
    /** Module the symbol is declared in, if known. */
    module?: string;
    arity?: number;
    args?: ArgMode[];
    determinism?: Determinism;
    purity?: Purity;
    /** For 'type': the raw RHS (constructors) as written. */
    typeDefinition?: string;
    /** For 'import'/'use_module': the imported module name(s). */
    importedModules?: string[];
    range: Range;
    /** Range covering just the name token, for definition/rename/hover. */
    nameRange: Range;
    doc?: DocComment;
    raw: string;
}

export interface ClauseNode {
    /** Name of the predicate/function this clause implements. */
    name: string;
    arity: number;
    /** Free variables (by textual name) appearing in the clause head, in order. */
    headVars: string[];
    /** All variable occurrences in the clause (head + body), for reference/rename support. */
    variableOccurrences: { name: string; range: Range }[];
    /** Best-effort list of callee atom names invoked in the body (regex-based; see callgraph). */
    calls: { name: string; arity?: number; range: Range }[];
    range: Range;
    raw: string;
}

export interface ModuleDoc {
    uri: string;
    moduleName?: string;
    symbols: SymbolNode[];
    clauses: ClauseNode[];
    imports: string[];
    useModules: string[];
    /** Parse-level problems (unterminated terms, unmatched brackets) surfaced as diagnostics. */
    syntaxProblems: { message: string; range: Range }[];
}
