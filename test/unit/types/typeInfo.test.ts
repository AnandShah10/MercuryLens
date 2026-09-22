import * as assert from 'assert';
import { formatTypeHover, isAbstractType } from '../../../server/src/types/typeInfo';
import { SymbolNode } from '../../../server/src/parser/ast';

const RANGE = { startLine: 0, startCol: 0, endLine: 0, endCol: 0 };
function makeTypeSymbol(overrides: Partial<SymbolNode> = {}): SymbolNode {
    return { kind: 'type', name: 'maybe', range: RANGE, nameRange: RANGE, raw: '', ...overrides };
}

describe('formatTypeHover', () => {
    it('renders a type with a visible definition', () => {
        const sym = makeTypeSymbol({ arity: 1, typeDefinition: 'no ; yes(T)' });
        const info = formatTypeHover(sym);
        assert.ok(info.markdown.includes(':- type maybe/1.'));
        assert.ok(info.markdown.includes('no ; yes(T)'));
    });

    it('renders an abstract type without inventing a definition', () => {
        const sym = makeTypeSymbol({ arity: 0 });
        const info = formatTypeHover(sym);
        assert.ok(info.markdown.includes(':- type maybe.'));
        assert.ok(!info.markdown.includes('--->'));
    });
});

describe('isAbstractType', () => {
    it('is true for a type declaration with no constructors', () => {
        assert.strictEqual(isAbstractType(makeTypeSymbol()), true);
    });

    it('is false once a definition is present', () => {
        assert.strictEqual(isAbstractType(makeTypeSymbol({ typeDefinition: 'a ; b' })), false);
    });

    it('is false for a non-type symbol', () => {
        assert.strictEqual(isAbstractType(makeTypeSymbol({ kind: 'predicate' })), false);
    });
});
