import * as assert from 'assert';
import {
    hasTopLevelDisjunction,
    splitTopLevelConjuncts,
    renameVariablesInText,
    buildRenameMapping,
    planInline,
    renderInlinePlan,
    CalleeInfo,
} from '../../../extension/src/utils/inlinePredicateHeuristics';

describe('hasTopLevelDisjunction', () => {
    it('detects a top-level semicolon', () => {
        assert.strictEqual(hasTopLevelDisjunction('foo(X) ; bar(X)'), true);
    });

    it('detects a semicolon inside the idiomatic parenthesized disjunction form', () => {
        // Mercury's normal way to write a disjunction is `( A ; B )` —
        // this must still be detected, not just a bare unparenthesized ';'.
        assert.strictEqual(hasTopLevelDisjunction('foo(X), ( bar(X) ; baz(X) )'), true);
    });

    it('detects a semicolon nested inside an if-then-else condition', () => {
        assert.strictEqual(hasTopLevelDisjunction('( if ( X > 0 ; Y > 0 ) then true else fail )'), true);
    });

    it('ignores a semicolon inside a string literal', () => {
        assert.strictEqual(hasTopLevelDisjunction('io.write_string("a; b", !IO)'), false);
    });

    it('returns false for text with no disjunction', () => {
        assert.strictEqual(hasTopLevelDisjunction('X = 1, Y = 2'), false);
    });
});

describe('splitTopLevelConjuncts', () => {
    it('splits a flat conjunction on commas', () => {
        const parts = splitTopLevelConjuncts('foo(X), bar(Y), baz(Z)');
        assert.deepStrictEqual(parts.map((p) => p.text.trim()), ['foo(X)', 'bar(Y)', 'baz(Z)']);
    });

    it('does not split commas nested inside call arguments', () => {
        const parts = splitTopLevelConjuncts('foo(X, Y), bar(Z)');
        assert.strictEqual(parts.length, 2);
        assert.strictEqual(parts[0].text.trim(), 'foo(X, Y)');
    });

    it('reports accurate start/end offsets', () => {
        const text = 'foo(X), bar(Y)';
        const parts = splitTopLevelConjuncts(text);
        assert.strictEqual(text.slice(parts[0].start, parts[0].end), 'foo(X)');
        assert.strictEqual(text.slice(parts[1].start, parts[1].end).trim(), 'bar(Y)');
    });
});

describe('renameVariablesInText', () => {
    it('renames every whole-word occurrence of a mapped variable', () => {
        const mapping = new Map([['X', 'X_Inl'], ['Y', 'Y_Inl']]);
        const result = renameVariablesInText('Y = X + 1', mapping);
        assert.strictEqual(result, 'Y_Inl = X_Inl + 1');
    });

    it('does not rename a substring match (word-boundary safe)', () => {
        const mapping = new Map([['X', 'X_Inl']]);
        const result = renameVariablesInText('XValue = 1', mapping);
        assert.strictEqual(result, 'XValue = 1'); // 'XValue' is a different identifier than 'X'
    });

    it('does not rename occurrences inside string literals', () => {
        const mapping = new Map([['X', 'X_Inl']]);
        const result = renameVariablesInText('io.write_string("X is here", !IO)', mapping);
        assert.strictEqual(result, 'io.write_string("X is here", !IO)');
    });

    it('leaves unmapped identifiers untouched', () => {
        const mapping = new Map([['X', 'X_Inl']]);
        const result = renameVariablesInText('foo(X, Y)', mapping);
        assert.strictEqual(result, 'foo(X_Inl, Y)');
    });
});

describe('buildRenameMapping', () => {
    it('produces a distinct name for every callee variable', () => {
        const mapping = buildRenameMapping(new Set(['X', 'Y']), new Set());
        assert.strictEqual(mapping.size, 2);
        assert.notStrictEqual(mapping.get('X'), mapping.get('Y'));
    });

    it('avoids colliding with a variable already in scope at the call site', () => {
        const mapping = buildRenameMapping(new Set(['X']), new Set(['X_Inl']));
        assert.notStrictEqual(mapping.get('X'), 'X_Inl');
    });
});

describe('planInline', () => {
    const detCallee = (overrides: Partial<CalleeInfo> = {}): CalleeInfo => ({
        headVars: ['X', 'Y'],
        argModes: ['in', 'out'],
        determinism: 'det',
        body: 'Y = X + 1',
        ...overrides,
    });

    it('produces a plan for a simple det predicate with in/out arguments', () => {
        const result = planInline(detCallee(), ['A', 'Result'], new Set(['A', 'Result']));
        assert.strictEqual(result.kind, 'plan');
        if (result.kind === 'plan') {
            assert.strictEqual(result.prefixGoals.length, 1);
            assert.ok(result.prefixGoals[0].endsWith('= A'));
            assert.strictEqual(result.suffixGoals.length, 1);
            assert.ok(result.suffixGoals[0].startsWith('Result ='));
            assert.ok(!result.renamedBody.includes(' X ') || result.renamedBody.includes('_Inl'));
        }
    });

    it('refuses a non-det determinism', () => {
        const result = planInline(detCallee({ determinism: 'semidet' }), ['A', 'Result'], new Set());
        assert.strictEqual(result.kind, 'refusal');
        if (result.kind === 'refusal') assert.ok(result.reason.includes('semidet'));
    });

    it('refuses an argument-count mismatch', () => {
        const result = planInline(detCallee(), ['A'], new Set());
        assert.strictEqual(result.kind, 'refusal');
    });

    it('refuses a di/uo-moded argument', () => {
        const result = planInline(detCallee({ argModes: ['in', 'uo'] }), ['A', 'Result'], new Set());
        assert.strictEqual(result.kind, 'refusal');
        if (result.kind === 'refusal') assert.ok(result.reason.includes('uo'));
    });

    it('refuses a callee body with a top-level disjunction', () => {
        const result = planInline(detCallee({ body: '( X > 0 ; fail )' }), ['A', 'Result'], new Set());
        assert.strictEqual(result.kind, 'refusal');
        if (result.kind === 'refusal') assert.ok(result.reason.includes('disjunction'));
    });

    it('alpha-renames callee-local variables to avoid capturing caller variables', () => {
        // Callee uses a local variable 'Tmp' the caller ALSO happens to use
        // for something else — the renamed body must not silently share it.
        const callee = detCallee({ headVars: ['X', 'Y'], argModes: ['in', 'out'], body: 'Tmp = X * 2, Y = Tmp + 1' });
        const result = planInline(callee, ['A', 'Result'], new Set(['A', 'Result', 'Tmp']));
        assert.strictEqual(result.kind, 'plan');
        if (result.kind === 'plan') {
            assert.ok(!new RegExp('\\bTmp\\b').test(result.renamedBody), 'callee-local Tmp must be renamed away from the caller-scope Tmp');
        }
    });

    it('handles a fact (no body) callee', () => {
        const callee = detCallee({ body: undefined });
        const result = planInline(callee, ['A', 'Result'], new Set());
        assert.strictEqual(result.kind, 'plan');
        if (result.kind === 'plan') assert.strictEqual(result.renamedBody, 'true');
    });

    it('end-to-end: fixtures/simple_module/inlinable.m\'s double_plus_one/2 inlines correctly', () => {
        // Mirrors exactly what extension/src/commands/inlinePredicateCommand.ts
        // would compute for `double_plus_one(5, Result)` in main/2's body,
        // given double_plus_one's single clause:
        //   double_plus_one(N, Result) :-
        //       Doubled = N * 2,
        //       Result = Doubled + 1.
        const callee: CalleeInfo = {
            headVars: ['N', 'Result'],
            argModes: ['in', 'out'],
            determinism: 'det',
            body: 'Doubled = N * 2,\n    Result = Doubled + 1',
        };
        // The caller (main/2) already uses 'Result' for the call's own
        // output variable, and also happens to use 'Doubled' nowhere —
        // but we still simulate a caller that DOES already use 'Doubled'
        // elsewhere, to prove the callee's local variable doesn't collide.
        const result = planInline(callee, ['5', 'Result'], new Set(['Result', 'Doubled']));
        assert.strictEqual(result.kind, 'plan');
        if (result.kind === 'plan') {
            // N is 'in': bound to the call's literal argument before the body.
            assert.deepStrictEqual(result.prefixGoals, ['N_Inl = 5']);
            // Result is 'out': bound from the (renamed) body's own result after it runs.
            assert.strictEqual(result.suffixGoals.length, 1);
            assert.ok(result.suffixGoals[0].startsWith('Result ='));
            // The callee's local 'Doubled' must not collide with the caller's own 'Doubled'.
            assert.ok(!new RegExp('\\bDoubled\\b').test(result.renamedBody));
            assert.ok(result.renamedBody.includes('N_Inl'));
            const rendered = renderInlinePlan(result);
            assert.ok(rendered.includes('N_Inl = 5'));
        }
    });
});

describe('renderInlinePlan', () => {
    it('joins prefix, body, and suffix goals into one parenthesized conjunction', () => {
        const rendered = renderInlinePlan({ kind: 'plan', prefixGoals: ['X_Inl = A'], renamedBody: 'Y_Inl = X_Inl + 1', suffixGoals: ['Result = Y_Inl'] });
        assert.ok(rendered.startsWith('('));
        assert.ok(rendered.endsWith(')'));
        assert.ok(rendered.includes('X_Inl = A'));
        assert.ok(rendered.includes('Y_Inl = X_Inl + 1'));
        assert.ok(rendered.includes('Result = Y_Inl'));
    });

    it('omits empty goal lists cleanly (e.g. a callee with no arguments)', () => {
        const rendered = renderInlinePlan({ kind: 'plan', prefixGoals: [], renamedBody: 'true', suffixGoals: [] });
        assert.strictEqual(rendered, '(\n    true\n)');
    });
});
