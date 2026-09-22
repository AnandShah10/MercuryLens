import * as assert from 'assert';
import { findBracketImbalance, collectVariables, computeExtractedArgs } from '../../../extension/src/utils/extractPredicateHeuristics';

describe('findBracketImbalance', () => {
    it('returns 0 for balanced text', () => {
        assert.strictEqual(findBracketImbalance('foo(X, [Y | Z]), bar(W)'), 0);
    });

    it('detects an unclosed paren', () => {
        assert.strictEqual(findBracketImbalance('foo(X, bar(Y)'), 1);
    });

    it('detects an extra close bracket', () => {
        assert.strictEqual(findBracketImbalance('foo(X))'), -1);
    });

    it('ignores brackets inside string literals', () => {
        assert.strictEqual(findBracketImbalance('io.write_string("(unbalanced", !IO)'), 0);
    });

    it('ignores brackets inside quoted atoms', () => {
        assert.strictEqual(findBracketImbalance("foo('(', X)"), 0);
    });
});

describe('collectVariables', () => {
    it('collects capitalized identifiers only', () => {
        const vars = collectVariables('foo(X, bar, Y) :- Z = X + Y.');
        assert.deepStrictEqual([...vars].sort(), ['X', 'Y', 'Z']);
    });

    it('collects underscore-prefixed variables', () => {
        const vars = collectVariables('foo(_Unused, X)');
        assert.ok(vars.has('_Unused'));
        assert.ok(vars.has('X'));
    });

    it('does not collect lowercase atoms', () => {
        const vars = collectVariables('foo(bar, baz)');
        assert.strictEqual(vars.size, 0);
    });
});

describe('computeExtractedArgs', () => {
    it('uses the declared mode for the enclosing predicate\'s own head variables', () => {
        // combine(X, Y) :- <selection: Y = X + 1>.  X is declared 'in', Y is declared 'out'.
        const clauseText = 'combine(X, Y) :-\n    Y = X + 1.';
        const relStart = clauseText.indexOf('Y = X + 1');
        const relEnd = relStart + 'Y = X + 1'.length;
        const selection = clauseText.slice(relStart, relEnd);
        const declaredModeFor = new Map([['X', 'in'], ['Y', 'out']]);
        const args = computeExtractedArgs(clauseText, relStart, relEnd, selection, declaredModeFor);
        const byName = Object.fromEntries(args.map((a) => [a.name, a]));
        assert.strictEqual(byName['X'].mode, 'in');
        assert.strictEqual(byName['X'].source, 'declared');
        assert.strictEqual(byName['Y'].mode, 'out');
        assert.strictEqual(byName['Y'].source, 'declared');
    });

    it('infers "out" for a local variable first bound inside the selection', () => {
        const clauseText = 'foo(A) :-\n    Tmp = A + 1,\n    print(Tmp).';
        const relStart = clauseText.indexOf('Tmp = A + 1');
        const relEnd = relStart + 'Tmp = A + 1'.length;
        const selection = clauseText.slice(relStart, relEnd);
        const args = computeExtractedArgs(clauseText, relStart, relEnd, selection, new Map());
        const tmp = args.find((a) => a.name === 'Tmp');
        assert.ok(tmp);
        assert.strictEqual(tmp!.mode, 'out');
        assert.strictEqual(tmp!.source, 'heuristic');
    });

    it('infers "in" for a local variable already bound before the selection', () => {
        const clauseText = 'foo(A) :-\n    Tmp = A + 1,\n    print(Tmp).';
        const relStart = clauseText.indexOf('print(Tmp)');
        const relEnd = relStart + 'print(Tmp)'.length;
        const selection = clauseText.slice(relStart, relEnd);
        const args = computeExtractedArgs(clauseText, relStart, relEnd, selection, new Map());
        const tmp = args.find((a) => a.name === 'Tmp');
        assert.ok(tmp);
        assert.strictEqual(tmp!.mode, 'in');
    });

    it('excludes variables that only occur inside the selection (purely local)', () => {
        const clauseText = 'foo(A) :-\n    Local = 1,\n    bar(A).';
        const relStart = clauseText.indexOf('Local = 1');
        const relEnd = relStart + 'Local = 1'.length;
        const selection = clauseText.slice(relStart, relEnd);
        const args = computeExtractedArgs(clauseText, relStart, relEnd, selection, new Map());
        assert.ok(!args.some((a) => a.name === 'Local'));
    });
});
