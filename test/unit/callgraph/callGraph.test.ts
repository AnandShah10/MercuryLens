import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { WorkspaceIndex } from '../../../server/src/symbols/workspaceIndex';
import { buildCallGraph } from '../../../server/src/callgraph/callGraph';

const FIXTURES = path.join(__dirname, '..', '..', '..', 'fixtures');
const read = (rel: string) => fs.readFileSync(path.join(FIXTURES, rel), 'utf8');

describe('buildCallGraph', () => {
    it('builds nodes for every declared predicate/function', () => {
        const index = new WorkspaceIndex();
        index.update('file://main.m', read('multi_module/main.m'));
        index.update('file://list_utils.m', read('multi_module/list_utils.m'));
        const graph = buildCallGraph(index);
        assert.ok(graph.nodes.some((n) => n.name === 'main'));
        assert.ok(graph.nodes.some((n) => n.name === 'sum_list'));
        assert.ok(graph.nodes.some((n) => n.name === 'my_map'));
    });

    it('adds an edge for a cross-module call site', () => {
        const index = new WorkspaceIndex();
        index.update('file://main.m', read('multi_module/main.m'));
        index.update('file://list_utils.m', read('multi_module/list_utils.m'));
        const graph = buildCallGraph(index);
        const mainNode = graph.nodes.find((n) => n.name === 'main');
        const sumListNode = graph.nodes.find((n) => n.name === 'sum_list');
        assert.ok(mainNode && sumListNode);
        assert.ok(graph.edges.some((e) => e.from === mainNode!.id && e.to === sumListNode!.id));
    });

    it('handles direct recursion without infinite looping', () => {
        const index = new WorkspaceIndex();
        index.update('file://fib.m', read('recursion/fib.m'));
        const graph = buildCallGraph(index);
        const fibNode = graph.nodes.find((n) => n.name === 'fib');
        assert.ok(fibNode);
        assert.ok(graph.edges.some((e) => e.from === fibNode!.id && e.to === fibNode!.id));
    });

    it('respects the moduleFilter option', () => {
        const index = new WorkspaceIndex();
        index.update('file://main.m', read('multi_module/main.m'));
        index.update('file://list_utils.m', read('multi_module/list_utils.m'));
        const graph = buildCallGraph(index, { moduleFilter: 'list_utils' });
        assert.ok(graph.nodes.every((n) => n.module === 'list_utils'));
    });

    it('resolves a call to the correct arity when the same name is declared at two arities', () => {
        const index = new WorkspaceIndex();
        index.update(
            'file://overload.m',
            [
                ':- module overload.',
                ':- interface.',
                ':- pred greet(string::in, io::di, io::uo) is det.',
                ':- pred greet(string::in, string::in, io::di, io::uo) is det.',
                ':- pred main(io::di, io::uo) is det.',
                ':- implementation.',
                '',
                // Deliberately spelled out (not "!IO" sugar) so the call
                // site's comma-separated argument count matches the
                // declaration's exactly — see the companion test below for
                // the !IO-sugar case, which this heuristic cannot
                // disambiguate by arity and instead falls back safely to
                // every same-name candidate.
                'main(IO0, IO1) :-',
                '    greet("world", IO0, IO1).',
                '',
                'greet(Name, IO0, IO1) :- true.',
                'greet(Name, Title, IO0, IO1) :- true.',
            ].join('\n'),
        );
        const graph = buildCallGraph(index);
        const threeArg = graph.nodes.find((n) => n.name === 'greet' && n.arity === 3); // greet(string, io_di, io_uo)
        const fourArg = graph.nodes.find((n) => n.name === 'greet' && n.arity === 4);
        assert.ok(threeArg && fourArg);
        const mainNode = graph.nodes.find((n) => n.name === 'main');
        assert.ok(mainNode);
        assert.ok(graph.edges.some((e) => e.from === mainNode!.id && e.to === threeArg!.id));
        assert.ok(!graph.edges.some((e) => e.from === mainNode!.id && e.to === fourArg!.id));
    });

    it('resolves a call site correctly even when it uses !IO state-variable sugar (state-var-aware arity)', () => {
        // Historically this was a documented limitation: "!IO" was counted
        // as a single syntactic argument, so a call site using it couldn't
        // be arity-matched exactly against a declaration that spells out
        // both halves (io::di, io::uo). Since "!Name" always expands to
        // exactly two arguments in a plain call (see
        // server/src/parser/parser.ts's stateVarAwareArity), this is now
        // resolved precisely rather than falling back to every same-name
        // candidate.
        const index = new WorkspaceIndex();
        index.update(
            'file://overload2.m',
            [
                ':- module overload2.',
                ':- interface.',
                ':- pred greet(string::in, io::di, io::uo) is det.',
                ':- pred greet(string::in, string::in, io::di, io::uo) is det.',
                ':- pred main(io::di, io::uo) is det.',
                ':- implementation.',
                '',
                'main(!IO) :-',
                '    greet("world", !IO),',
                '    greet("Dr.", "Who", !IO).',
                '',
                'greet(Name, !IO) :- true.',
                'greet(Name, Title, !IO) :- true.',
            ].join('\n'),
        );
        const graph = buildCallGraph(index);
        const threeArg = graph.nodes.find((n) => n.name === 'greet' && n.arity === 3);
        const fourArg = graph.nodes.find((n) => n.name === 'greet' && n.arity === 4);
        const mainNode = graph.nodes.find((n) => n.name === 'main');
        assert.ok(threeArg && fourArg && mainNode);
        assert.ok(graph.edges.some((e) => e.from === mainNode!.id && e.to === threeArg!.id));
        assert.ok(graph.edges.some((e) => e.from === mainNode!.id && e.to === fourArg!.id));
        // The key assertion: each call resolves to EXACTLY its own arity,
        // not both (which is what the old, unfixed behavior would do).
        assert.strictEqual(graph.edges.filter((e) => e.from === mainNode!.id).length, 2);
        assert.ok(graph.edges.some((e) => e.from === mainNode!.id && e.to === threeArg!.id));
        assert.ok(graph.edges.some((e) => e.from === mainNode!.id && e.to === fourArg!.id));
    });

    it('still finds edges from a caller whose own clause head uses !IO state-variable sugar', () => {
        // Regression test: the enclosing predicate's OWN declared arity
        // (counting the expanded io::di/io::uo pair) legitimately differs
        // from its clause's parsed arity (which counts "!IO" as one
        // syntactic token) — this must not prevent the clause from being
        // recognized as that predicate's caller-side node.
        const index = new WorkspaceIndex();
        index.update('file://main.m', read('multi_module/main.m'));
        index.update('file://list_utils.m', read('multi_module/list_utils.m'));
        const graph = buildCallGraph(index);
        const mainNode = graph.nodes.find((n) => n.name === 'main');
        const sumListNode = graph.nodes.find((n) => n.name === 'sum_list');
        assert.ok(mainNode && sumListNode);
        assert.ok(graph.edges.some((e) => e.from === mainNode!.id && e.to === sumListNode!.id));
    });
});
