import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { parseModule } from '../../../server/src/parser/parser';
import { splitTopLevelTerms } from '../../../server/src/parser/lexer';

const FIXTURES = path.join(__dirname, '..', '..', '..', 'fixtures');
const read = (rel: string) => fs.readFileSync(path.join(FIXTURES, rel), 'utf8');

describe('splitTopLevelTerms', () => {
    it('splits declarations and clauses on top-level periods only', () => {
        const src = ':- module m.\n\nfoo(X) :- X = "a.b.c", bar(X).\n';
        const terms = splitTopLevelTerms(src);
        assert.strictEqual(terms.length, 2);
        assert.ok(terms[0].text.includes('module m'));
        assert.ok(terms[1].text.includes('bar(X)'));
    });

    it('does not split on periods inside strings', () => {
        const src = 'greet(!IO) :- io.write_string("Hello. World.", !IO).\n';
        const terms = splitTopLevelTerms(src);
        assert.strictEqual(terms.length, 1);
    });

    it('does not split on periods inside nested parens', () => {
        const src = ':- pred f(int::in) is det.\n';
        const terms = splitTopLevelTerms(src);
        assert.strictEqual(terms.length, 1);
    });
});

describe('parseModule: simple_module/hello.m', () => {
    const doc = parseModule('file://hello.m', read('simple_module/hello.m'));

    it('extracts the module name', () => {
        assert.strictEqual(doc.moduleName, 'hello');
    });

    it('counts a bare "!IO" state-variable clause-head argument as 2, matching its declaration\'s arity', () => {
        // main(!IO) :- ... in the source, declared as
        // :- pred main(io::di, io::uo) is det. (arity 2). Before this was
        // fixed, "!IO" was counted as a single syntactic argument, so the
        // clause's own computed arity (1) didn't match its declaration's
        // (2) — see docs/architecture.md's history of this limitation.
        const mainClause = doc.clauses.find((c) => c.name === 'main');
        assert.ok(mainClause);
        assert.strictEqual(mainClause!.arity, 2);
        const mainDecl = doc.symbols.find((s) => s.kind === 'predicate' && s.name === 'main');
        assert.strictEqual(mainDecl?.arity, mainClause!.arity);
    });

    it('extracts import_module', () => {
        assert.deepStrictEqual(doc.imports, ['io']);
    });

    it('extracts pred declarations with determinism', () => {
        const main = doc.symbols.find((s) => s.kind === 'predicate' && s.name === 'main');
        assert.ok(main);
        assert.strictEqual(main!.determinism, 'det');
        assert.strictEqual(main!.arity, 2);

        const greet = doc.symbols.find((s) => s.kind === 'predicate' && s.name === 'greet');
        assert.ok(greet);
        assert.strictEqual(greet!.determinism, 'det');
        assert.strictEqual(greet!.arity, 3);
        assert.deepStrictEqual(greet!.args?.[0], { raw: 'string::in', type: 'string', mode: 'in' });
    });

    it('captures the doc comment preceding greet/3', () => {
        const greet = doc.symbols.find((s) => s.kind === 'predicate' && s.name === 'greet');
        assert.ok(greet?.doc?.text.includes('greet/3 prints a friendly greeting'));
    });

    it('extracts clauses and their call sites', () => {
        const mainClause = doc.clauses.find((c) => c.name === 'main');
        assert.ok(mainClause);
        assert.ok(mainClause!.calls.some((c) => c.name === 'greet'));
    });
});

describe('parseModule: simple_module/arithmetic.m', () => {
    const doc = parseModule('file://arithmetic.m', read('simple_module/arithmetic.m'));

    it('extracts func declarations with a return type', () => {
        const square = doc.symbols.find((s) => s.kind === 'function' && s.name === 'square');
        assert.ok(square);
        assert.strictEqual(square!.args?.length, 2); // 1 param + 1 return
    });

    it('extracts semidet determinism', () => {
        const div = doc.symbols.find((s) => s.kind === 'predicate' && s.name === 'safe_divide');
        assert.strictEqual(div?.determinism, 'semidet');
    });

    it('extracts multiple clauses for the same predicate', () => {
        const clauses = doc.clauses.filter((c) => c.name === 'safe_divide');
        assert.strictEqual(clauses.length, 2);
    });
});

describe('parseModule: multi_module/list_utils.m', () => {
    const doc = parseModule('file://list_utils.m', read('multi_module/list_utils.m'));

    it('extracts a separate mode declaration', () => {
        const mode = doc.symbols.find((s) => s.kind === 'mode' && s.name === 'my_map');
        assert.ok(mode);
        assert.strictEqual(mode!.determinism, 'det');
    });

    it('extracts recursive calls', () => {
        const recClause = doc.clauses.find((c) => c.name === 'sum_list' && c.calls.some((call) => call.name === 'sum_list'));
        assert.ok(recClause, 'expected a recursive call to sum_list');
    });
});

describe('parseModule: type_errors/bad_types.m (still parses syntactically)', () => {
    it('parses despite the type error (type errors are semantic, not syntactic)', () => {
        const doc = parseModule('file://bad_types.m', read('type_errors/bad_types.m'));
        assert.strictEqual(doc.moduleName, 'bad_types');
        assert.ok(doc.clauses.find((c) => c.name === 'combine'));
    });
});

describe('parseModule: recursion/fib.m', () => {
    it('detects the two recursive calls in fib', () => {
        const doc = parseModule('file://fib.m', read('recursion/fib.m'));
        const clause = doc.clauses.find((c) => c.name === 'fib');
        assert.ok(clause);
        const fibCalls = clause!.calls.filter((c) => c.name === 'fib');
        assert.strictEqual(fibCalls.length, 2);
    });
});

describe('state-variable-aware arity counting', () => {
    it('counts multiple bare state-variable arguments, each as 2', () => {
        const src = [
            ':- module m.',
            ':- interface.',
            ':- pred p(io::di, io::uo, int::in, int::out) is det.',
            ':- implementation.',
            'p(!IO, !Count) :- true.',
        ].join('\n');
        const doc = parseModule('file://m.m', src);
        const clause = doc.clauses.find((c) => c.name === 'p');
        assert.strictEqual(clause?.arity, 4); // !IO=2 + !Count=2
    });

    it('counts a call site\'s bare state-variable argument as 2 as well', () => {
        const src = [
            ':- module m.',
            ':- interface.',
            ':- pred q(io::di, io::uo) is det.',
            ':- pred main(io::di, io::uo) is det.',
            ':- implementation.',
            'main(!IO) :- q(!IO).',
            'q(!IO) :- true.',
        ].join('\n');
        const doc = parseModule('file://m.m', src);
        const mainClause = doc.clauses.find((c) => c.name === 'main');
        const call = mainClause?.calls.find((c) => c.name === 'q');
        assert.strictEqual(call?.arity, 2);
    });

    it('does NOT treat the partial forms !.Name / !:Name as a pair (each is a single ordinary term)', () => {
        const src = [
            ':- module m.',
            ':- interface.',
            ':- pred p(int::in, int::in) is det.',
            ':- implementation.',
            'p(!.S, !:S) :- true.',
        ].join('\n');
        const doc = parseModule('file://m.m', src);
        const clause = doc.clauses.find((c) => c.name === 'p');
        assert.strictEqual(clause?.arity, 2); // 1 + 1, not 2 + 2
    });
});
