import * as assert from 'assert';
import { parseTraceEventLine, isUserVisiblePort, parseStackOutput, parseVariablesOutput, buildBreakCommand, parseContextLine, extractTraceEventsWithContext, extractStackWithContext } from '../../../extension/src/debug/mdbProtocol';

describe('parseTraceEventLine', () => {
    it('parses a CALL event for an unqualified predicate', () => {
        const event = parseTraceEventLine('       1:      1  1 CALL pred main/2-0 (det)');
        assert.ok(event);
        assert.strictEqual(event!.port, 'CALL');
        assert.strictEqual(event!.name, 'main');
        assert.strictEqual(event!.arity, 2);
    });

    it('parses an EXIT event and strips the module qualifier', () => {
        const event = parseTraceEventLine('   2:  2  2 EXIT pred list_utils.sum_list/2-0 (det)');
        assert.ok(event);
        assert.strictEqual(event!.port, 'EXIT');
        assert.strictEqual(event!.moduleQualifier, 'list_utils');
        assert.strictEqual(event!.name, 'sum_list');
        assert.strictEqual(event!.arity, 2);
    });

    it('parses a func-style event', () => {
        const event = parseTraceEventLine('  3:  3  1 CALL func fib/1-0 (det)');
        assert.ok(event);
        assert.strictEqual(event!.name, 'fib');
        assert.strictEqual(event!.arity, 1);
    });

    it('returns undefined for a line with no recognizable port', () => {
        assert.strictEqual(parseTraceEventLine('mdb> '), undefined);
    });

    it('returns undefined for a line with a port keyword but no pred/func reference', () => {
        assert.strictEqual(parseTraceEventLine('CALL something unrelated'), undefined);
    });
});

describe('isUserVisiblePort', () => {
    it('treats CALL/EXIT/FAIL/REDO/EXCP as user-visible', () => {
        for (const port of ['CALL', 'EXIT', 'FAIL', 'REDO', 'EXCP'] as const) {
            assert.strictEqual(isUserVisiblePort(port), true);
        }
    });

    it('treats internal control-flow ports as not user-visible', () => {
        for (const port of ['THEN', 'ELSE', 'DISJ', 'SWITCH', 'COND', 'NEGE', 'NEGS'] as const) {
            assert.strictEqual(isUserVisiblePort(port), false);
        }
    });
});

describe('parseStackOutput', () => {
    it('extracts one frame per pred/func reference line', () => {
        const output = [
            '0: pred main/2-0 (det)',
            '1: pred list_utils.sum_list/2-0 (det)',
            'mdb> ',
        ].join('\n');
        const frames = parseStackOutput(output);
        assert.strictEqual(frames.length, 2);
        assert.strictEqual(frames[0].name, 'main');
        assert.strictEqual(frames[1].name, 'sum_list');
        assert.strictEqual(frames[1].moduleQualifier, 'list_utils');
        // indices are assigned in output order regardless of original numbering
        assert.strictEqual(frames[0].index, 0);
        assert.strictEqual(frames[1].index, 1);
    });

    it('returns an empty array for output with no recognizable frames', () => {
        assert.deepStrictEqual(parseStackOutput('mdb> \n'), []);
    });
});

describe('parseVariablesOutput', () => {
    it('parses simple Name = Value lines', () => {
        const vars = parseVariablesOutput('X = 5\nY = "hello"\n');
        assert.deepStrictEqual(vars, [{ name: 'X', value: '5' }, { name: 'Y', value: '"hello"' }]);
    });

    it('parses Name :: Type = Value lines', () => {
        const vars = parseVariablesOutput('X :: int = 5\n');
        assert.deepStrictEqual(vars, [{ name: 'X', value: '5' }]);
    });

    it('ignores lines with no recognizable variable shape', () => {
        const vars = parseVariablesOutput('mdb> \nsome unrelated text\n');
        assert.deepStrictEqual(vars, []);
    });
});

describe('buildBreakCommand', () => {
    it('builds an unqualified break command', () => {
        assert.strictEqual(buildBreakCommand('main', 2), 'break main/2');
    });

    it('builds a module-qualified break command', () => {
        assert.strictEqual(buildBreakCommand('sum_list', 2, 'list_utils'), 'break list_utils.sum_list/2');
    });
});

describe('parseContextLine (context prevline)', () => {
    it('parses a plain filename:line context line', () => {
        const ctx = parseContextLine('main.m:11');
        assert.deepStrictEqual(ctx, { file: 'main.m', line: 11 });
    });

    it('tolerates surrounding whitespace', () => {
        assert.deepStrictEqual(parseContextLine('   list_utils.m:7   '), { file: 'list_utils.m', line: 7 });
    });

    it('returns undefined for an ordinary trace-event line', () => {
        assert.strictEqual(parseContextLine('CALL pred main/2-0 (det)'), undefined);
    });

    it('returns undefined for the mdb prompt', () => {
        assert.strictEqual(parseContextLine('mdb> '), undefined);
    });

    it('returns undefined for a line with extra trailing content', () => {
        assert.strictEqual(parseContextLine('main.m:11 CALL pred main/2-0'), undefined);
    });
});

describe('extractTraceEventsWithContext', () => {
    it('associates a context line with the event line that immediately follows it', () => {
        const output = ['main.m:11', 'CALL pred main/2-0 (det)', 'mdb> '].join('\n');
        const events = extractTraceEventsWithContext(output);
        assert.strictEqual(events.length, 1);
        assert.strictEqual(events[0].event.name, 'main');
        assert.deepStrictEqual(events[0].context, { file: 'main.m', line: 11 });
    });

    it('leaves context undefined for an event with no preceding context line', () => {
        const output = ['CALL pred main/2-0 (det)', 'mdb> '].join('\n');
        const events = extractTraceEventsWithContext(output);
        assert.strictEqual(events.length, 1);
        assert.strictEqual(events[0].context, undefined);
    });

    it('does not carry a context line over to a second, unrelated event', () => {
        const output = ['main.m:11', 'CALL pred main/2-0 (det)', 'EXIT pred main/2-0 (det)', 'mdb> '].join('\n');
        const events = extractTraceEventsWithContext(output);
        assert.strictEqual(events.length, 2);
        assert.deepStrictEqual(events[0].context, { file: 'main.m', line: 11 });
        assert.strictEqual(events[1].context, undefined);
    });

    it('handles multiple context+event pairs in one output block', () => {
        const output = [
            'main.m:11', 'CALL pred main/2-0 (det)',
            'list_utils.m:7', 'CALL pred sum_list/2-0 (det)',
            'mdb> ',
        ].join('\n');
        const events = extractTraceEventsWithContext(output);
        assert.strictEqual(events.length, 2);
        assert.strictEqual(events[0].event.name, 'main');
        assert.deepStrictEqual(events[0].context, { file: 'main.m', line: 11 });
        assert.strictEqual(events[1].event.name, 'sum_list');
        assert.deepStrictEqual(events[1].context, { file: 'list_utils.m', line: 7 });
    });
});

describe('extractStackWithContext', () => {
    it('associates each stack frame with its preceding context line', () => {
        const output = [
            'main.m:11', '0: pred main/2-0 (det)',
            'list_utils.m:7', '1: pred sum_list/2-0 (det)',
            'mdb> ',
        ].join('\n');
        const frames = extractStackWithContext(output);
        assert.strictEqual(frames.length, 2);
        assert.strictEqual(frames[0].frame.name, 'main');
        assert.deepStrictEqual(frames[0].context, { file: 'main.m', line: 11 });
        assert.strictEqual(frames[1].frame.name, 'sum_list');
        assert.deepStrictEqual(frames[1].context, { file: 'list_utils.m', line: 7 });
    });

    it('still extracts frames when no context lines are present at all', () => {
        const output = ['0: pred main/2-0 (det)', 'mdb> '].join('\n');
        const frames = extractStackWithContext(output);
        assert.strictEqual(frames.length, 1);
        assert.strictEqual(frames[0].context, undefined);
    });
});
