import * as assert from 'assert';
import { parseCompilerOutput } from '../../../server/src/compiler/mercuryCompilerAdapter';

describe('parseCompilerOutput', () => {
    it('parses a single-line error', () => {
        const output = `bad_types.m:011: Error: type error in unification of X and "not a number".`;
        const diags = parseCompilerOutput(output);
        assert.strictEqual(diags.length, 1);
        assert.strictEqual(diags[0].severity, 'error');
        assert.strictEqual(diags[0].startLine, 10);
        assert.ok(diags[0].message.includes('type error'));
    });

    it('parses a warning line', () => {
        const output = `foo.m:5: Warning: unused variable \`X'.`;
        const diags = parseCompilerOutput(output);
        assert.strictEqual(diags.length, 1);
        assert.strictEqual(diags[0].severity, 'warning');
    });

    it('parses a line-range diagnostic', () => {
        const output = `foo.m:10-12: Error: determinism error in switch.`;
        const diags = parseCompilerOutput(output);
        assert.strictEqual(diags[0].startLine, 9);
        assert.strictEqual(diags[0].endLine, 11);
    });

    it('appends continuation lines to the previous diagnostic', () => {
        const output = [
            `foo.m:5: Error: mode error in call to my_map/3.`,
            `  the variable Y has instantiatedness \`free',`,
            `  expected instantiatedness \`ground'.`,
        ].join('\n');
        const diags = parseCompilerOutput(output);
        assert.strictEqual(diags.length, 1);
        assert.ok(diags[0].message.includes("expected instantiatedness"));
    });

    it('ignores lines that are not Mercury source diagnostics', () => {
        const output = `note: some unrelated build tool output: value.txt: not found`;
        const diags = parseCompilerOutput(output);
        assert.strictEqual(diags.length, 0);
    });

    it('handles multiple diagnostics in one run', () => {
        const output = [`a.m:1: Error: first problem.`, `b.m:2: Warning: second problem.`].join('\n');
        const diags = parseCompilerOutput(output);
        assert.strictEqual(diags.length, 2);
        assert.strictEqual(diags[0].file, 'a.m');
        assert.strictEqual(diags[1].file, 'b.m');
    });
});
