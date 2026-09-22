import * as assert from 'assert';
import { explainDiagnostic } from '../../../server/src/diagnostics/explainer';
import { computeSyntacticDiagnostics } from '../../../server/src/diagnostics/syntacticDiagnostics';
import { WorkspaceIndex } from '../../../server/src/symbols/workspaceIndex';

describe('explainDiagnostic', () => {
    it('explains a mode/instantiation error', () => {
        const e = explainDiagnostic("mode error: variable `X' has instantiatedness `free', expected `ground'.");
        assert.ok(e);
        assert.strictEqual(e!.category, 'Mode / instantiation error');
    });

    it('explains an undefined predicate error', () => {
        const e = explainDiagnostic('undefined predicate `foo/2\'.');
        assert.ok(e);
        assert.strictEqual(e!.category, 'Undefined predicate/function');
    });

    it('returns undefined for unrecognized messages rather than guessing', () => {
        const e = explainDiagnostic('some completely novel compiler message about widgets');
        assert.strictEqual(e, undefined);
    });
});

describe('computeSyntacticDiagnostics', () => {
    it('flags a missing module declaration', () => {
        const index = new WorkspaceIndex();
        const doc = index.update('file://a.m', 'foo(X) :- X = 1.\n');
        const diags = computeSyntacticDiagnostics(doc, index);
        assert.ok(diags.some((d) => d.message.includes('module')));
    });

    it('does not flag standard library imports as unresolved', () => {
        const index = new WorkspaceIndex();
        const doc = index.update('file://a.m', ':- module a.\n:- interface.\n:- import_module io.\n:- implementation.\n');
        const diags = computeSyntacticDiagnostics(doc, index);
        assert.ok(!diags.some((d) => d.message.includes("Module 'io'")));
    });

    it('flags an import that resolves to nothing in the workspace', () => {
        const index = new WorkspaceIndex();
        const doc = index.update('file://a.m', ':- module a.\n:- interface.\n:- import_module totally_unknown_project_module.\n:- implementation.\n');
        const diags = computeSyntacticDiagnostics(doc, index);
        assert.ok(diags.some((d) => d.message.includes('totally_unknown_project_module')));
    });

    it('does not flag an import that IS present in the workspace index', () => {
        const index = new WorkspaceIndex();
        index.update('file://lib.m', ':- module my_lib.\n:- interface.\n:- pred foo(int::in) is det.\n:- implementation.\nfoo(_).\n');
        const doc = index.update('file://a.m', ':- module a.\n:- interface.\n:- import_module my_lib.\n:- implementation.\n');
        const diags = computeSyntacticDiagnostics(doc, index);
        assert.ok(!diags.some((d) => d.message.includes('my_lib')));
    });
});
