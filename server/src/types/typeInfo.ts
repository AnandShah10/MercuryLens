import { SymbolNode } from '../parser/ast';

/**
 * Formatting/lookup helpers for type-related hover and the
 * `mercury/moduleDoc`-derived Type Information panel. Kept separate from
 * server.ts so this logic is independently unit-testable without spinning
 * up an LSP connection (see test/unit/types/typeInfo.test.ts).
 */

export interface TypeHoverInfo {
    markdown: string;
}

/** Renders the hover markdown for a `:- type` declaration. Reports "no
 * constructors visible" honestly for an abstract type rather than
 * inventing a definition. */
export function formatTypeHover(sym: SymbolNode): TypeHoverInfo {
    const def = sym.typeDefinition ? `\n\n\`${sym.typeDefinition}\`` : '';
    const arity = sym.arity ? `/${sym.arity}` : '';
    return { markdown: `\`\`\`mercury\n:- type ${sym.name}${arity}.\n\`\`\`${def}` };
}

/** True if this symbol looks like an abstract (no visible constructors)
 * type declaration in this module — i.e. `:- type foo.` with nothing after
 * it, as opposed to one with a `--->` or `==` definition. */
export function isAbstractType(sym: SymbolNode): boolean {
    return sym.kind === 'type' && !sym.typeDefinition;
}
