import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { WorkspaceIndex } from '../../../server/src/symbols/workspaceIndex';
import { findReferences, computeRenameEdits, validateRenameTarget } from '../../../server/src/references/referenceFinder';

const FIXTURES = path.join(__dirname, '..', '..', '..', 'fixtures');
const read = (rel: string) => fs.readFileSync(path.join(FIXTURES, rel), 'utf8');

describe('findReferences', () => {
    it('finds both the declaration and call sites of a predicate', () => {
        const index = new WorkspaceIndex();
        index.update('file://main.m', read('multi_module/main.m'));
        index.update('file://list_utils.m', read('multi_module/list_utils.m'));
        const refs = findReferences(index, 'sum_list');
        // at least: the :- pred decl, the clause head, and the call site in main
        assert.ok(refs.length >= 3);
        assert.ok(refs.some((r) => r.uri === 'file://main.m'));
        assert.ok(refs.some((r) => r.uri === 'file://list_utils.m'));
    });

    it('returns an empty array for a name that does not exist', () => {
        const index = new WorkspaceIndex();
        index.update('file://a.m', ':- module a.\n');
        assert.deepStrictEqual(findReferences(index, 'nonexistent_predicate'), []);
    });
});

describe('validateRenameTarget', () => {
    it('accepts a valid lowercase Mercury identifier', () => {
        assert.strictEqual(validateRenameTarget('my_new_name').valid, true);
    });

    it('rejects an uppercase-starting name (would look like a variable)', () => {
        const result = validateRenameTarget('MyNewName');
        assert.strictEqual(result.valid, false);
        assert.ok(result.reason);
    });

    it('rejects a name with invalid characters', () => {
        assert.strictEqual(validateRenameTarget('my-new-name').valid, false);
    });
});

describe('computeRenameEdits', () => {
    it('produces an edit for the declaration and every call site', () => {
        const index = new WorkspaceIndex();
        index.update('file://main.m', read('multi_module/main.m'));
        index.update('file://list_utils.m', read('multi_module/list_utils.m'));
        const edits = computeRenameEdits(index, 'sum_list');
        assert.ok(edits.length >= 2);
        assert.ok(edits.some((e) => e.uri === 'file://main.m'));
        assert.ok(edits.some((e) => e.uri === 'file://list_utils.m'));
    });

    it('does not rename an unrelated predicate that happens to share no name', () => {
        const index = new WorkspaceIndex();
        index.update('file://main.m', read('multi_module/main.m'));
        index.update('file://list_utils.m', read('multi_module/list_utils.m'));
        const edits = computeRenameEdits(index, 'sum_list');
        // 'my_map' clauses must not be touched by a rename of 'sum_list'
        const doc = index.get('file://list_utils.m')!;
        const myMapRanges = doc.symbols.filter((s) => s.name === 'my_map').map((s) => s.nameRange);
        assert.ok(!edits.some((e) => myMapRanges.some((r) => r.startLine === e.range.startLine && r.startCol === e.range.startCol)));
    });
});
