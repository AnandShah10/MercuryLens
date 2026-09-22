import * as assert from 'assert';
import { describeDeterminism, DETERMINISM_DESCRIPTIONS } from '../../../server/src/determinism/determinismInfo';

describe('describeDeterminism', () => {
    it('describes every standard determinism category', () => {
        for (const det of Object.keys(DETERMINISM_DESCRIPTIONS) as (keyof typeof DETERMINISM_DESCRIPTIONS)[]) {
            const description = describeDeterminism(det);
            assert.strictEqual(description, DETERMINISM_DESCRIPTIONS[det]);
            assert.ok(description.length > 0);
        }
    });

    it('says a determinism was not declared/found rather than guessing', () => {
        assert.ok(describeDeterminism(undefined).toLowerCase().includes('no determinism was declared'));
    });

    it('det means exactly-once, never fails', () => {
        assert.ok(describeDeterminism('det').includes('exactly once'));
        assert.ok(describeDeterminism('det').includes('Never fails'));
    });

    it('semidet may fail but at most once', () => {
        assert.ok(describeDeterminism('semidet').includes('at most once'));
        assert.ok(describeDeterminism('semidet').includes('May fail'));
    });
});
