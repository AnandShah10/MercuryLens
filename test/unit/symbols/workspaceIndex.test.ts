import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { WorkspaceIndex } from '../../../server/src/symbols/workspaceIndex';

const FIXTURES = path.join(__dirname, '..', '..', '..', 'fixtures');
const read = (rel: string) => fs.readFileSync(path.join(FIXTURES, rel), 'utf8');

describe('WorkspaceIndex', () => {
    it('finds a module by its declared name', () => {
        const index = new WorkspaceIndex();
        index.update('file://list_utils.m', read('multi_module/list_utils.m'));
        const found = index.findModule('list_utils');
        assert.ok(found);
    });

    it('finds declarations by name across the workspace', () => {
        const index = new WorkspaceIndex();
        index.update('file://list_utils.m', read('multi_module/list_utils.m'));
        const decls = index.findDeclarations('sum_list');
        assert.strictEqual(decls.length, 1);
        assert.strictEqual(decls[0].symbol.kind, 'predicate');
    });

    it('filters declarations by arity when requested', () => {
        const index = new WorkspaceIndex();
        index.update('file://hello.m', read('simple_module/hello.m'));
        assert.strictEqual(index.findDeclarations('greet', 3).length, 1);
        assert.strictEqual(index.findDeclarations('greet', 99).length, 0);
    });

    it('counts callers using the static call-site heuristic', () => {
        const index = new WorkspaceIndex();
        index.update('file://main.m', read('multi_module/main.m'));
        index.update('file://list_utils.m', read('multi_module/list_utils.m'));
        assert.ok(index.countCallers('sum_list') >= 1);
        assert.strictEqual(index.countCallers('a_predicate_that_does_not_exist'), 0);
    });

    it('updating a document replaces its previous parse rather than duplicating it', () => {
        const index = new WorkspaceIndex();
        index.update('file://a.m', ':- module a.\n');
        index.update('file://a.m', ':- module a.\n:- interface.\n:- pred p(int::in) is det.\n:- implementation.\np(_).\n');
        const doc = index.get('file://a.m');
        assert.strictEqual(doc?.symbols.filter((s) => s.kind === 'module').length, 1);
    });

    it('findNonCallable finds a type declaration by name', () => {
        const index = new WorkspaceIndex();
        index.update('file://list_utils.m', read('multi_module/list_utils.m'));
        index.update('file://a.m', ':- module a.\n:- interface.\n:- type point ---> point(int, int).\n:- implementation.\n');
        const found = index.findNonCallable('point', ['type']);
        assert.strictEqual(found.length, 1);
        assert.strictEqual(found[0].symbol.kind, 'type');
        assert.strictEqual(found[0].uri, 'file://a.m');
    });

    it('findNonCallable respects module qualification (Module.name)', () => {
        const index = new WorkspaceIndex();
        index.update('file://a.m', ':- module a.\n:- interface.\n:- type point ---> point(int, int).\n:- implementation.\n');
        index.update('file://b.m', ':- module b.\n:- interface.\n:- type point ---> point3d(int, int, int).\n:- implementation.\n');
        const found = index.findNonCallable('a.point', ['type']);
        assert.strictEqual(found.length, 1);
        assert.strictEqual(found[0].uri, 'file://a.m');
    });

    it('findNonCallable filters by the requested kinds', () => {
        const index = new WorkspaceIndex();
        index.update('file://list_utils.m', read('multi_module/list_utils.m'));
        // 'sum_list' is a predicate, not a type/typeclass/instance/module —
        // findNonCallable must not return it even though the name exists.
        assert.strictEqual(index.findNonCallable('sum_list', ['type', 'typeclass', 'instance', 'module']).length, 0);
        assert.strictEqual(index.findNonCallable('list_utils', ['module']).length, 1);
    });
});
