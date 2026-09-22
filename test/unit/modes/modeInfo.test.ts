import * as assert from 'assert';
import { describeInstantiation, summarizeModes, formatModeSection } from '../../../server/src/modes/modeInfo';
import { SymbolNode } from '../../../server/src/parser/ast';

describe('describeInstantiation', () => {
    it('describes the standard built-in modes', () => {
        assert.ok(describeInstantiation('in').includes('ground'));
        assert.ok(describeInstantiation('out').includes('free'));
        assert.ok(describeInstantiation('di').includes('clobbered'));
        assert.ok(describeInstantiation('uo').includes('unique'));
    });

    it('labels a non-standard mode as compound/user-defined rather than guessing', () => {
        assert.ok(describeInstantiation('some_custom_inst').includes('compound/user-defined'));
    });

    it('handles an unspecified mode', () => {
        assert.ok(describeInstantiation(undefined).includes('not specified'));
    });
});

describe('summarizeModes', () => {
    it('produces one summary entry per argument, 1-indexed', () => {
        const summary = summarizeModes([{ raw: 'int::in', type: 'int', mode: 'in' }, { raw: 'int::out', type: 'int', mode: 'out' }]);
        assert.strictEqual(summary.length, 2);
        assert.strictEqual(summary[0].index, 1);
        assert.strictEqual(summary[1].index, 2);
        assert.ok(summary[1].instantiation.includes('free'));
    });
});

describe('formatModeSection', () => {
    const RANGE = { startLine: 0, startCol: 0, endLine: 0, endCol: 0 };
    it('renders a Modes section for a symbol with arguments', () => {
        const sym: SymbolNode = { kind: 'predicate', name: 'foo', range: RANGE, nameRange: RANGE, raw: '', args: [{ raw: 'int::in', type: 'int', mode: 'in' }] };
        const section = formatModeSection(sym);
        assert.ok(section.startsWith('**Modes:**'));
        assert.ok(section.includes('Argument 1'));
    });

    it('returns an empty string for a symbol with no arguments', () => {
        const sym: SymbolNode = { kind: 'predicate', name: 'foo', range: RANGE, nameRange: RANGE, raw: '' };
        assert.strictEqual(formatModeSection(sym), '');
    });
});
