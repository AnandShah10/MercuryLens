import * as assert from 'assert';
import { PassThrough } from 'stream';
import { MercuryDebugSession, IMdbProcess } from '../../../extension/src/debug/mdbSession';

/**
 * Drives a MercuryDebugSession the same way VS Code would: encodes DAP
 * requests as `Content-Length: N\r\n\r\n<json>` frames over an in-memory
 * stream pair, and decodes response/event frames the same way. This
 * exercises the actual request/response translation logic end to end
 * (protocol framing, sequencing, breakpoint/stack/variable shaping)
 * without needing a real VS Code instance — see docs/development.md.
 *
 * It does NOT prove anything about whether a real `mdb`'s output matches
 * what FakeMdbProcess below simulates — that assumption is explicitly
 * documented as unverified in mdbProtocol.ts. What this proves is: IF mdb
 * behaves as assumed, the DAP translation is correct.
 */
class DapHarness {
    private toSession = new PassThrough();
    private fromSession = new PassThrough();
    private buffer = Buffer.alloc(0);
    private seq = 1;
    private pending = new Map<number, (msg: any) => void>();
    public events: any[] = [];

    constructor(session: MercuryDebugSession) {
        session.start(this.toSession, this.fromSession);
        this.fromSession.on('data', (chunk: Buffer) => this.onData(chunk));
    }

    private onData(chunk: Buffer): void {
        this.buffer = Buffer.concat([this.buffer, chunk]);
        for (;;) {
            const text = this.buffer.toString('utf8');
            const headerEnd = text.indexOf('\r\n\r\n');
            if (headerEnd < 0) return;
            const header = text.slice(0, headerEnd);
            const lengthMatch = header.match(/Content-Length: (\d+)/);
            if (!lengthMatch) return;
            const length = parseInt(lengthMatch[1], 10);
            const bodyStart = headerEnd + 4;
            if (this.buffer.length < bodyStart + length) return;
            const body = this.buffer.slice(bodyStart, bodyStart + length).toString('utf8');
            this.buffer = this.buffer.slice(bodyStart + length);
            const msg = JSON.parse(body);
            if (msg.type === 'response') {
                this.pending.get(msg.request_seq)?.(msg);
                this.pending.delete(msg.request_seq);
            } else if (msg.type === 'event') {
                this.events.push(msg);
            }
        }
    }

    request(command: string, args?: unknown): Promise<any> {
        const seq = this.seq++;
        const message = { seq, type: 'request', command, arguments: args };
        const json = JSON.stringify(message);
        const frame = `Content-Length: ${Buffer.byteLength(json, 'utf8')}\r\n\r\n${json}`;
        return new Promise((resolve) => {
            this.pending.set(seq, resolve);
            this.toSession.write(frame);
        });
    }

    eventsOfType(type: string): any[] {
        return this.events.filter((e) => e.event === type);
    }
}

class FakeMdbProcess implements IMdbProcess {
    public sentCommands: string[] = [];
    private script: Record<string, string>;
    private initialOutput: string;

    constructor(script: Record<string, string>, initialOutput = 'CALL pred main/2-0 (det)\nmdb> ') {
        this.script = script;
        this.initialOutput = initialOutput;
    }

    async waitForInitialPrompt(): Promise<string> {
        return this.initialOutput;
    }

    async sendCommand(command: string): Promise<string> {
        this.sentCommands.push(command);
        return this.script[command] ?? 'mdb> ';
    }

    dispose(): void {
        /* no-op for the fake */
    }
}

describe('MercuryDebugSession (end-to-end DAP flow against a fake mdb)', () => {
    it('completes initialize -> launch -> setBreakpoints -> continue -> stackTrace -> variables -> disconnect', async () => {
        const script: Record<string, string> = {
            'break main/2': 'Breakpoint set on main/2.\nmdb> ',
            continue: 'CALL pred main/2-0 (det)\nmdb> ',
            stack: '0: pred main/2-0 (det)\nmdb> ',
            vars: 'IO0 = <<io_state>>\nmdb> ',
        };
        const fake = new FakeMdbProcess(script);
        const resolveEnclosing = async (_uri: string, _line: number) => ({ name: 'main', arity: 2, line: 10 });
        const session = new MercuryDebugSession(resolveEnclosing, () => fake);
        session.resolveDeclarationLocation = async (name, arity) => (name === 'main' && arity === 2 ? { uri: 'file:///main.m', line: 10 } : undefined);
        const harness = new DapHarness(session);

        const initResp = await harness.request('initialize', { adapterID: 'mercury-mdb', pathFormat: 'path' });
        assert.strictEqual(initResp.success, true);

        const launchResp = await harness.request('launch', { program: '/tmp/fake-program', cwd: '/tmp', stopOnEntry: true });
        assert.strictEqual(launchResp.success, true);
        const stoppedEvents = harness.eventsOfType('stopped');
        assert.ok(stoppedEvents.some((e) => e.body.reason === 'entry'));

        const bpResp = await harness.request('setBreakpoints', { source: { path: '/tmp/main.m' }, breakpoints: [{ line: 11 }] });
        assert.strictEqual(bpResp.success, true);
        assert.strictEqual(bpResp.body.breakpoints[0].verified, true);
        assert.strictEqual(bpResp.body.breakpoints[0].line, 11); // snapped to enclosing predicate's line (10) + 1
        assert.ok(fake.sentCommands.includes('break main/2'));

        const continueResp = await harness.request('continue', { threadId: 1 });
        assert.strictEqual(continueResp.success, true);
        assert.ok(fake.sentCommands.includes('continue'));
        assert.ok(fake.sentCommands.includes('context prevline'), "launchRequest should configure 'context prevline' for real source locations");

        const stackResp = await harness.request('stackTrace', { threadId: 1 });
        assert.strictEqual(stackResp.success, true);
        assert.strictEqual(stackResp.body.stackFrames.length, 1);
        assert.ok(stackResp.body.stackFrames[0].name.includes('main/2'));
        assert.strictEqual(stackResp.body.stackFrames[0].line, 11);

        const scopesResp = await harness.request('scopes', { frameId: 0 });
        assert.strictEqual(scopesResp.body.scopes[0].name, 'Locals');

        const varsResp = await harness.request('variables', { variablesReference: scopesResp.body.scopes[0].variablesReference });
        assert.ok(varsResp.body.variables.some((v: { name: string }) => v.name === 'IO0'));

        const disconnectResp = await harness.request('disconnect', {});
        assert.strictEqual(disconnectResp.success, true);
    });

    it('prefers a real "context prevline" source location over the declaration-based fallback', async () => {
        // The stack frame's context line reports line 42 in main.m — a
        // DIFFERENT line than resolveDeclarationLocation would supply (10)
        // — proving the real mdb-reported location wins when present.
        const script: Record<string, string> = {
            stack: 'main.m:42\n0: pred main/2-0 (det)\nmdb> ',
        };
        const fake = new FakeMdbProcess(script);
        const session = new MercuryDebugSession(async () => undefined, () => fake);
        session.resolveDeclarationLocation = async () => ({ uri: 'file:///main.m', line: 10 });
        session.resolveFileUri = async (relativeFileName) => `/tmp/${relativeFileName}`;
        const harness = new DapHarness(session);
        await harness.request('initialize', { pathFormat: 'path' });
        await harness.request('launch', { program: '/tmp/fake-program', cwd: '/tmp', stopOnEntry: true });

        const stackResp = await harness.request('stackTrace', { threadId: 1 });
        assert.strictEqual(stackResp.success, true);
        assert.strictEqual(stackResp.body.stackFrames.length, 1);
        // 42 (from the context line), not 11 (declaration line 10 + 1).
        assert.strictEqual(stackResp.body.stackFrames[0].line, 42);
        assert.strictEqual(stackResp.body.stackFrames[0].source.path, '/tmp/main.m');
    });

    it('falls back to the declaration-based location when stack output has no context line', async () => {
        const script: Record<string, string> = {
            stack: '0: pred main/2-0 (det)\nmdb> ',
        };
        const fake = new FakeMdbProcess(script);
        const session = new MercuryDebugSession(async () => undefined, () => fake);
        session.resolveDeclarationLocation = async () => ({ uri: 'file:///main.m', line: 10 });
        const harness = new DapHarness(session);
        await harness.request('initialize', { pathFormat: 'path' });
        await harness.request('launch', { program: '/tmp/fake-program', cwd: '/tmp', stopOnEntry: true });

        const stackResp = await harness.request('stackTrace', { threadId: 1 });
        assert.strictEqual(stackResp.body.stackFrames[0].line, 11); // declaration line 10 + 1
    });

    it('reports pause as explicitly unsupported rather than pretending to handle it', async () => {
        const fake = new FakeMdbProcess({});
        const session = new MercuryDebugSession(async () => undefined, () => fake);
        const harness = new DapHarness(session);
        await harness.request('initialize', { pathFormat: 'path' });
        await harness.request('launch', { program: '/tmp/fake-program', stopOnEntry: true });
        const pauseResp = await harness.request('pause', { threadId: 1 });
        assert.strictEqual(pauseResp.success, false);
    });

    it('evaluateRequest passes an expression through to mdb verbatim (the Debug Console safety valve)', async () => {
        const script: Record<string, string> = { 'print X': 'X = 42\nmdb> ' };
        const fake = new FakeMdbProcess(script);
        const session = new MercuryDebugSession(async () => undefined, () => fake);
        const harness = new DapHarness(session);
        await harness.request('initialize', { pathFormat: 'path' });
        await harness.request('launch', { program: '/tmp/fake-program', stopOnEntry: true });
        const evalResp = await harness.request('evaluate', { expression: 'print X', context: 'repl' });
        assert.ok(evalResp.body.result.includes('X = 42'));
        assert.ok(fake.sentCommands.includes('print X'));
    });

    it('setBreakpoints reports verified:false for a line with no enclosing predicate', async () => {
        const fake = new FakeMdbProcess({});
        const session = new MercuryDebugSession(async () => undefined, () => fake);
        const harness = new DapHarness(session);
        await harness.request('initialize', { pathFormat: 'path' });
        await harness.request('launch', { program: '/tmp/fake-program', stopOnEntry: true });
        const bpResp = await harness.request('setBreakpoints', { source: { path: '/tmp/main.m' }, breakpoints: [{ line: 1 }] });
        assert.strictEqual(bpResp.body.breakpoints[0].verified, false);
    });
});
