import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { WorkspaceIndex } from '../../../server/src/symbols/workspaceIndex';
import { buildImportGraph } from '../../../server/src/dependency/dependencyGraph';

const FIXTURES = path.join(__dirname, '..', '..', '..', 'fixtures');
const read = (rel: string) => fs.readFileSync(path.join(FIXTURES, rel), 'utf8');

describe('buildImportGraph', () => {
    it('includes an edge from main to its imported modules', () => {
        const index = new WorkspaceIndex();
        index.update('file://main.m', read('multi_module/main.m'));
        index.update('file://list_utils.m', read('multi_module/list_utils.m'));
        const graph = buildImportGraph(index);
        const mainEdge = graph.find((e) => e.from === 'main');
        assert.ok(mainEdge);
        assert.ok(mainEdge!.to.includes('list_utils'));
    });

    it('excludes documents with no module declaration', () => {
        const index = new WorkspaceIndex();
        index.update('file://anonymous.m', 'foo(X) :- X = 1.\n');
        const graph = buildImportGraph(index);
        assert.strictEqual(graph.length, 0);
    });

    it('includes a module with no imports as an edge to an empty list', () => {
        const index = new WorkspaceIndex();
        index.update('file://leaf.m', ':- module leaf.\n:- interface.\n:- pred p(int::in) is det.\n:- implementation.\np(_).\n');
        const graph = buildImportGraph(index);
        const edge = graph.find((e) => e.from === 'leaf');
        assert.ok(edge);
        assert.deepStrictEqual(edge!.to, []);
    });
});
