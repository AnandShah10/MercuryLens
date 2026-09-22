/**
 * Mirrors (a subset of) the server's ModuleDoc/SymbolNode/ClauseNode JSON
 * shape, as received over the custom `mercury/*` LSP requests. This is a
 * plain data contract, not a shared TypeScript import — the extension and
 * language server are separate compilation units (separate tsconfig
 * projects, per architecture) that communicate only over LSP/JSON, exactly
 * as they would if the server were replaced with a different implementation.
 */

export interface WireRange {
    startLine: number;
    startCol: number;
    endLine: number;
    endCol: number;
}

export interface WireArg {
    raw: string;
    type?: string;
    mode?: string;
}

export interface WireSymbol {
    kind: string;
    name: string;
    module?: string;
    arity?: number;
    args?: WireArg[];
    determinism?: string;
    purity?: string;
    typeDefinition?: string;
    importedModules?: string[];
    range: WireRange;
    nameRange: WireRange;
    doc?: { text: string; range: WireRange };
    raw: string;
}

export interface WireClause {
    name: string;
    arity: number;
    headVars: string[];
    variableOccurrences: { name: string; range: WireRange }[];
    calls: { name: string; arity?: number; range: WireRange }[];
    range: WireRange;
    raw: string;
}

export interface WireModuleDoc {
    uri: string;
    moduleName?: string;
    symbols: WireSymbol[];
    clauses: WireClause[];
    imports: string[];
    useModules: string[];
}
