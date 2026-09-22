import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { WorkspaceIndex } from '../../../server/src/symbols/workspaceIndex';
import { CallGraphCache } from '../../../server/src/cache/callGraphCache';

const FIXTURES = path.join(__dirname, '..', '..', '..', 'fixtures');
const read = (rel: string) => fs.readFileSync(path.join(FIXTURES, rel), 'utf8');

describe('CallGraphCache', () => {
    it('is not fresh before the first get() call', () => {
        const index = new WorkspaceIndex();
        index.update('file://fib.m', read('recursion/fib.m'));
        const cache = new CallGraphCache();
        assert.strictEqual(cache.isFresh(index, undefined), false);
    });

    it('is fresh immediately after a get() call with the same index and filter', () => {
        const index = new WorkspaceIndex();
        index.update('file://fib.m', read('recursion/fib.m'));
        const cache = new CallGraphCache();
        cache.get(index, undefined);
        assert.strictEqual(cache.isFresh(index, undefined), true);
    });

    it('returns the same graph object on a repeated get() with no index changes (cache hit)', () => {
        const index = new WorkspaceIndex();
        index.update('file://fib.m', read('recursion/fib.m'));
        const cache = new CallGraphCache();
        const first = cache.get(index, undefined);
        const second = cache.get(index, undefined);
        assert.strictEqual(first, second, 'expected the cached graph object to be reused, not recomputed');
    });

    it('invalidates automatically when the index is updated', () => {
        const index = new WorkspaceIndex();
        index.update('file://fib.m', read('recursion/fib.m'));
        const cache = new CallGraphCache();
        const first = cache.get(index, undefined);
        index.update('file://main.m', read('multi_module/main.m'));
        assert.strictEqual(cache.isFresh(index, undefined), false);
        const second = cache.get(index, undefined);
        assert.notStrictEqual(first, second);
        assert.ok(second.nodes.some((n) => n.name === 'main'), 'the newly-added module should appear in the recomputed graph');
    });

    it('treats a different moduleFilter as a cache miss even with the same index version', () => {
        const index = new WorkspaceIndex();
        index.update('file://fib.m', read('recursion/fib.m'));
        index.update('file://main.m', read('multi_module/main.m'));
        const cache = new CallGraphCache();
        const unfiltered = cache.get(index, undefined);
        const filtered = cache.get(index, 'main');
        assert.notStrictEqual(unfiltered, filtered);
        assert.ok(filtered.nodes.every((n) => n.module === 'main'));
    });
});
