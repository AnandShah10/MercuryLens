import * as assert from 'assert';
import { MockCompilerAdapter } from './mockCompilerAdapter';

describe('MockCompilerAdapter', () => {
    it('reports success when no error-severity diagnostics are fixtured', async () => {
        const mock = new MockCompilerAdapter({ 'ok.m': [] });
        const result = await mock.check(['ok.m']);
        assert.strictEqual(result.success, true);
        assert.strictEqual(result.exitCode, 0);
    });

    it('reports failure and surfaces fixtured diagnostics for a known-bad file', async () => {
        const mock = new MockCompilerAdapter({
            'bad_types.m': [
                { file: 'bad_types.m', startLine: 10, endLine: 10, severity: 'error', message: 'type error', raw: '' },
            ],
        });
        const result = await mock.check(['bad_types.m']);
        assert.strictEqual(result.success, false);
        assert.strictEqual(result.diagnostics.length, 1);
        assert.strictEqual(result.diagnostics[0].severity, 'error');
    });
});
