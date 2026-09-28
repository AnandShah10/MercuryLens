import * as assert from 'assert';
import { WorkspaceIndex } from '../../../server/src/symbols/workspaceIndex';
import { computeOrganizeImportsEdits } from '../../../server/src/refactoring/organizeImports';

describe('computeOrganizeImportsEdits', () => {
    it('removes a single unused, workspace-indexed import (single import line — no ">1 lines" gate)', () => {
        const index = new WorkspaceIndex();
        index.update('file://lib.m', ':- module lib.\n:- interface.\n:- pred foo(int::in) is det.\n:- implementation.\nfoo(_).\n');
        const text = [
            ':- module a.',
            ':- interface.',
            ':- import_module lib.',
            ':- implementation.',
            'bar(X) :- X = 1.',
            '',
        ].join('\n');
        const doc = index.update('file://a.m', text);
        const edits = computeOrganizeImportsEdits(doc, text, index);
        // Regression test: a file with only ONE import declaration line
        // used to be skipped entirely (a strict "> 1 lines" gate), even
        // though that single line has real unused work to do.
        assert.strictEqual(edits.length, 1);
        assert.strictEqual(edits[0].newText, ''); // lib is unused and indexed -> confirmable -> removed
    });

    it('keeps a workspace-indexed import that is actually called', () => {
        const index = new WorkspaceIndex();
        index.update('file://lib.m', ':- module lib.\n:- interface.\n:- pred foo(int::in) is det.\n:- implementation.\nfoo(_).\n');
        const text = [
            ':- module a.',
            ':- interface.',
            ':- import_module lib.',
            ':- implementation.',
            'bar :- foo(1).',
            '',
        ].join('\n');
        const doc = index.update('file://a.m', text);
        const edits = computeOrganizeImportsEdits(doc, text, index);
        assert.strictEqual(edits.length, 0);
    });

    it('keeps a workspace-indexed import used only via explicit qualification', () => {
        const index = new WorkspaceIndex();
        index.update('file://lib.m', ':- module lib.\n:- interface.\n:- pred foo(int::in) is det.\n:- implementation.\nfoo(_).\n');
        const text = [
            ':- module a.',
            ':- interface.',
            ':- import_module lib.',
            ':- implementation.',
            'bar :- lib.foo(1).',
            '',
        ].join('\n');
        const doc = index.update('file://a.m', text);
        const edits = computeOrganizeImportsEdits(doc, text, index);
        assert.strictEqual(edits.length, 0);
    });

    it('NEVER removes an unindexed (e.g. standard-library) module, even if it looks unused', () => {
        // This is the conservative-safety behavior: we cannot see io's
        // exported names (it isn't part of this workspace), so we cannot
        // rule out an unqualified call to one of them, and must keep it.
        const index = new WorkspaceIndex();
        const text = [
            ':- module a.',
            ':- interface.',
            ':- import_module io.',
            ':- implementation.',
            'bar :- true.',
            '',
        ].join('\n');
        const doc = index.update('file://a.m', text);
        const edits = computeOrganizeImportsEdits(doc, text, index);
        assert.strictEqual(edits.length, 0);
    });

    it('deduplicates the same module appearing on two separate import_module lines', () => {
        const index = new WorkspaceIndex();
        const text = [
            ':- module a.',
            ':- interface.',
            ':- import_module io.',
            ':- import_module io, list.',
            ':- implementation.',
            'bar :- true.',
            '',
        ].join('\n');
        const doc = index.update('file://a.m', text);
        const edits = computeOrganizeImportsEdits(doc, text, index);
        // Both io and list are unindexed (conservatively kept), but "io"
        // must appear only once in the result, and the second line is
        // removed entirely (its content merged into the first).
        assert.strictEqual(edits.length, 2);
        const rewritten = edits.find((e) => e.newText !== '');
        assert.ok(rewritten);
        assert.strictEqual(rewritten!.newText, ':- import_module io, list.');
        const deleted = edits.find((e) => e.newText === '');
        assert.ok(deleted);
    });

    it('sorts the surviving modules alphabetically', () => {
        const index = new WorkspaceIndex();
        const text = [
            ':- module a.',
            ':- interface.',
            ':- import_module string, int, bool.',
            ':- implementation.',
            'bar :- true.',
            '',
        ].join('\n');
        const doc = index.update('file://a.m', text);
        const edits = computeOrganizeImportsEdits(doc, text, index);
        assert.strictEqual(edits.length, 1);
        assert.strictEqual(edits[0].newText, ':- import_module bool, int, string.');
    });

    it('produces no edit when the imports are already canonical (idempotent)', () => {
        const index = new WorkspaceIndex();
        const text = [
            ':- module a.',
            ':- interface.',
            ':- import_module bool, int.',
            ':- implementation.',
            'bar :- true.',
            '',
        ].join('\n');
        const doc = index.update('file://a.m', text);
        const edits = computeOrganizeImportsEdits(doc, text, index);
        assert.strictEqual(edits.length, 0);
    });

    it('treats import_module and use_module lines independently (never merges the two kinds)', () => {
        const index = new WorkspaceIndex();
        const text = [
            ':- module a.',
            ':- interface.',
            ':- import_module string.',
            ':- use_module int.',
            ':- implementation.',
            'bar :- true.',
            '',
        ].join('\n');
        const doc = index.update('file://a.m', text);
        const edits = computeOrganizeImportsEdits(doc, text, index);
        // Both are unindexed and conservatively kept; each line is already
        // canonical on its own (single module, already "sorted"), so no
        // edits should be produced, and in particular they must never be
        // combined into a single declaration of either kind.
        assert.strictEqual(edits.length, 0);
    });

    it('returns no edits for a file with no import/use_module declarations at all', () => {
        const index = new WorkspaceIndex();
        const text = ':- module a.\n:- interface.\n:- implementation.\nbar :- true.\n';
        const doc = index.update('file://a.m', text);
        const edits = computeOrganizeImportsEdits(doc, text, index);
        assert.strictEqual(edits.length, 0);
    });

    it('removes an entire import_module line when every module on it is confirmed unused', () => {
        const index = new WorkspaceIndex();
        index.update('file://lib.m', ':- module lib.\n:- interface.\n:- pred foo(int::in) is det.\n:- implementation.\nfoo(_).\n');
        index.update('file://lib2.m', ':- module lib2.\n:- interface.\n:- pred baz(int::in) is det.\n:- implementation.\nbaz(_).\n');
        const text = [
            ':- module a.',
            ':- interface.',
            ':- import_module lib, lib2.',
            ':- implementation.',
            'bar :- true.',
            '',
        ].join('\n');
        const doc = index.update('file://a.m', text);
        const edits = computeOrganizeImportsEdits(doc, text, index);
        assert.strictEqual(edits.length, 1);
        assert.strictEqual(edits[0].newText, '');
    });
});
