import * as assert from 'assert';
import { extractNamedPredicateRefs } from '../../../extension/src/utils/parseCompilerPredicateRefs';

describe('extractNamedPredicateRefs', () => {
    it('extracts a single undefined-predicate reference', () => {
        const refs = extractNamedPredicateRefs("foo.m:5: Error: undefined predicate `bar/2'.");
        assert.deepStrictEqual([...refs], ['bar/2']);
    });

    it('extracts multiple references across several lines', () => {
        const output = [
            "foo.m:5: Error: undefined predicate `bar/2'.",
            "foo.m:9: Error: ambiguous overloading of `baz/1'.",
        ].join('\n');
        const refs = extractNamedPredicateRefs(output);
        assert.deepStrictEqual([...refs].sort(), ['bar/2', 'baz/1']);
    });

    it('strips module qualification, keeping only the unqualified name', () => {
        const refs = extractNamedPredicateRefs("foo.m:5: Error: undefined predicate `some_module.bar/2'.");
        assert.deepStrictEqual([...refs], ['bar/2']);
    });

    it('deduplicates repeated references', () => {
        const output = "foo.m:5: Error: `bar/2' undefined.\nfoo.m:12: Error: `bar/2' undefined again.";
        const refs = extractNamedPredicateRefs(output);
        assert.strictEqual(refs.size, 1);
    });

    it('returns an empty set for output with no backtick-quoted references', () => {
        const refs = extractNamedPredicateRefs('foo.m:5: Error: syntax error at token `.\'.');
        assert.strictEqual(refs.size, 0);
    });
});
