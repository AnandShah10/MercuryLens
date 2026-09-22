import {
    LoggingDebugSession,
    InitializedEvent,
    StoppedEvent,
    TerminatedEvent,
    OutputEvent,
    Thread,
    StackFrame,
    Scope,
    Source,
    Handles,
} from '@vscode/debugadapter';
import { DebugProtocol } from '@vscode/debugprotocol';
import * as path from 'path';
import { MdbProcess } from './mdbProcess';
import {
    parseTraceEventLine,
    isUserVisiblePort,
    parseVariablesOutput,
    buildBreakCommand,
    extractTraceEventsWithContext,
    extractStackWithContext,
    MdbTraceEvent,
    MdbContext,
} from './mdbProtocol';

/**
 * EXPERIMENTAL. A best-effort Debug Adapter Protocol bridge to Mercury's
 * `mdb` debugger — see mdbProtocol.ts's and mdbProcess.ts's confidence
 * notes for exactly what is (commands sent) vs. isn't (output parsing)
 * verified against a live `mdb`. This is deliberately additive: the
 * simpler, fully-reliable `Mercury: Debug with mdb (Terminal)` command
 * (extension/src/commands/debugCommand.ts) is unaffected and remains the
 * safe fallback if a given mdb build's output doesn't match what this
 * bridge expects.
 *
 * Scope, by design:
 *   - Breakpoints are resolved to a Mercury predicate/function (via
 *     `resolveEnclosingPredicate`, backed by this project's own workspace
 *     index — NOT by attempting mdb's own line-breakpoint support, whose
 *     exact syntax/availability this project could not verify). The
 *     breakpoint is reported back to VS Code snapped to that predicate's
 *     actual declaration line, honestly reflecting where it really
 *     applies rather than pretending exact-line accuracy.
 *   - `pause` is not supported (mdb's synchronous, prompt-driven model has
 *     no clean way to interrupt a running computation from here) and is
 *     reported as unsupported rather than faked.
 *   - Every line mdb prints is forwarded to the Debug Console verbatim
 *     (category 'console'), so raw debugging is always possible even
 *     where structured stack/variable parsing falls short — and the user
 *     can type real mdb commands directly into the Debug Console via
 *     `evaluateRequest`, which passes expressions through to mdb verbatim.
 */

export interface LaunchArgs extends DebugProtocol.LaunchRequestArguments {
    program: string;
    cwd?: string;
    stopOnEntry?: boolean;
}

export interface EnclosingPredicate {
    name: string;
    arity: number;
    moduleQualifier?: string;
    line: number;
}

export type ResolveEnclosingPredicate = (uri: string, line: number) => Promise<EnclosingPredicate | undefined>;

interface PendingBreakpoint {
    uri: string;
    requestedLine: number;
    resolved?: EnclosingPredicate;
}

/** The subset of MdbProcess's public API this session depends on — kept as
 * an interface (not the concrete class) so tests can supply a fake
 * implementation without extending the real spawning class. */
export interface IMdbProcess {
    waitForInitialPrompt(timeoutMs?: number): Promise<string>;
    sendCommand(command: string, timeoutMs?: number): Promise<string>;
    dispose(): void;
}

export type MdbProcessFactory = (program: string, cwd: string, events: import('./mdbProcess').MdbProcessEvents) => IMdbProcess;

export class MercuryDebugSession extends LoggingDebugSession {
    private mdb: IMdbProcess | undefined;
    private variableHandles = new Handles<string>();
    private lastStop: MdbTraceEvent | undefined;
    private lastStopContext: MdbContext | undefined;
    private breakpointsByUri = new Map<string, PendingBreakpoint[]>();
    private resolveEnclosingPredicate: ResolveEnclosingPredicate;
    private createMdbProcess: MdbProcessFactory;

    /** Overridden by the descriptor factory to plug in the real workspace
     * index lookup; defaults to "unknown" so this class has no hard
     * dependency of its own on the language client. */
    resolveDeclarationLocation: (name: string, arity: number) => Promise<{ uri: string; line: number } | undefined> = async () => undefined;

    /** Resolves a filename mdb reports (via `context prevline`, typically
     * relative to the launch `cwd`) to an absolute filesystem path VS Code
     * can open. Overridable for cases where mdb's reported path doesn't
     * line up with a simple `cwd`-relative join (e.g. a build in a
     * subdirectory); defaults to exactly that simple join. */
    resolveFileUri: (relativeFileName: string) => Promise<string | undefined> = async (relativeFileName) => {
        if (!this.cwd) return undefined;
        return path.isAbsolute(relativeFileName) ? relativeFileName : path.join(this.cwd, relativeFileName);
    };

    private cwd: string | undefined;

    constructor(
        resolveEnclosingPredicate: ResolveEnclosingPredicate,
        createMdbProcess: MdbProcessFactory = (program, cwd, events) => new MdbProcess(program, cwd, events),
    ) {
        super();
        this.resolveEnclosingPredicate = resolveEnclosingPredicate;
        this.createMdbProcess = createMdbProcess;
        this.setDebuggerLinesStartAt1(true);
        this.setDebuggerColumnsStartAt1(true);
    }

    protected initializeRequest(response: DebugProtocol.InitializeResponse): void {
        response.body = response.body ?? {};
        response.body.supportsConfigurationDoneRequest = true;
        response.body.supportsEvaluateForHovers = false;
        response.body.supportsStepBack = false;
        response.body.supportsSetVariable = false;
        this.sendResponse(response);
        this.sendEvent(new InitializedEvent());
    }

    protected async launchRequest(response: DebugProtocol.LaunchResponse, args: LaunchArgs): Promise<void> {
        try {
            const cwd = args.cwd ?? process.cwd();
            this.cwd = cwd;
            this.mdb = this.createMdbProcess(args.program, cwd, {
                onOutput: (chunk) => this.sendEvent(new OutputEvent(chunk, 'console')),
                onExit: () => this.sendEvent(new TerminatedEvent()),
            });
            const initial = await this.mdb.waitForInitialPrompt();
            // `context prevline` is a real, documented mdb command (see
            // mdbProtocol.ts's verification note) that makes every
            // subsequent event/stack report include a real `file.m:line`
            // context on its own preceding line — the most reliable
            // source-location info this bridge can get, preferred over
            // its own declaration-based fallback whenever present.
            try {
                const contextSetup = await this.mdb.sendCommand('context prevline');
                this.sendEvent(new OutputEvent(contextSetup, 'console'));
            } catch (err) {
                this.sendEvent(new OutputEvent(`Mercury debug: could not enable 'context prevline' (${String(err)}) — source locations will rely on this extension's own declaration-based fallback only.\n`, 'stderr'));
            }
            this.handleStopOutput(initial);
            this.sendResponse(response);
            if (args.stopOnEntry !== false) {
                this.sendEvent(new StoppedEvent('entry', 1));
            } else {
                await this.doContinue();
            }
        } catch (err) {
            this.sendEvent(new OutputEvent(`Mercury debug: failed to launch mdb — ${String(err)}\n`, 'stderr'));
            this.sendErrorResponse(response, 1, String(err));
        }
    }

    protected async setBreakPointsRequest(response: DebugProtocol.SetBreakpointsResponse, args: DebugProtocol.SetBreakpointsArguments): Promise<void> {
        const uri = args.source.path ?? '';
        const requested = args.breakpoints ?? [];
        const resolvedBreakpoints: DebugProtocol.Breakpoint[] = [];
        const pending: PendingBreakpoint[] = [];

        for (const bp of requested) {
            const enclosing = await this.resolveEnclosingPredicate(uri, bp.line - 1);
            if (!enclosing) {
                resolvedBreakpoints.push({ verified: false, message: 'No predicate/function declaration encloses this line.', line: bp.line });
                continue;
            }
            pending.push({ uri, requestedLine: bp.line, resolved: enclosing });
            if (this.mdb) {
                try {
                    const out = await this.mdb.sendCommand(buildBreakCommand(enclosing.name, enclosing.arity, enclosing.moduleQualifier));
                    this.sendEvent(new OutputEvent(out, 'console'));
                } catch (err) {
                    this.sendEvent(new OutputEvent(`Mercury debug: could not set a breakpoint on ${enclosing.name}/${enclosing.arity} — ${String(err)}\n`, 'stderr'));
                }
            }
            resolvedBreakpoints.push({
                verified: true,
                line: enclosing.line + 1,
                message: `Snapped to the start of ${enclosing.name}/${enclosing.arity} (mdb breaks on predicate entry, not arbitrary lines — see docs/compiler-integration.md#debugging).`,
            });
        }

        this.breakpointsByUri.set(uri, pending);
        response.body = { breakpoints: resolvedBreakpoints };
        this.sendResponse(response);
    }

    protected configurationDoneRequest(response: DebugProtocol.ConfigurationDoneResponse): void {
        this.sendResponse(response);
    }

    protected threadsRequest(response: DebugProtocol.ThreadsResponse): void {
        response.body = { threads: [new Thread(1, 'main')] };
        this.sendResponse(response);
    }

    private handleStopOutput(output: string): void {
        const events = extractTraceEventsWithContext(output);
        for (let i = events.length - 1; i >= 0; i--) {
            if (isUserVisiblePort(events[i].event.port)) {
                this.lastStop = events[i].event;
                this.lastStopContext = events[i].context;
                return;
            }
        }
        // Fallback: context prevline wasn't confirmed active yet (e.g. the
        // very first prompt, before the setup command's own reply has
        // necessarily been distinguished from the program's own output) —
        // still try a plain, context-less scan so a stop is never missed.
        const lines = output.split(/\r\n|\n/);
        for (let i = lines.length - 1; i >= 0; i--) {
            const event = parseTraceEventLine(lines[i]);
            if (event && isUserVisiblePort(event.port)) {
                this.lastStop = event;
                this.lastStopContext = undefined;
                return;
            }
        }
    }

    private async doContinue(): Promise<void> {
        if (!this.mdb) return;
        const out = await this.mdb.sendCommand('continue');
        this.sendEvent(new OutputEvent(out, 'console'));
        this.handleStopOutput(out);
        if (/mdb>\s*$/.test(out) && !/EOF|exited|finished/i.test(out)) {
            this.sendEvent(new StoppedEvent('breakpoint', 1));
        } else {
            this.sendEvent(new TerminatedEvent());
        }
    }

    protected async continueRequest(response: DebugProtocol.ContinueResponse): Promise<void> {
        this.sendResponse(response);
        await this.doContinue();
    }

    protected async nextRequest(response: DebugProtocol.NextResponse): Promise<void> {
        this.sendResponse(response);
        await this.stepLike('next');
    }

    protected async stepInRequest(response: DebugProtocol.StepInResponse): Promise<void> {
        this.sendResponse(response);
        await this.stepLike('step');
    }

    protected async stepOutRequest(response: DebugProtocol.StepOutResponse): Promise<void> {
        this.sendResponse(response);
        await this.stepLike('finish');
    }

    private async stepLike(command: string): Promise<void> {
        if (!this.mdb) return;
        try {
            const out = await this.mdb.sendCommand(command);
            this.sendEvent(new OutputEvent(out, 'console'));
            this.handleStopOutput(out);
            this.sendEvent(new StoppedEvent('step', 1));
        } catch (err) {
            this.sendEvent(new OutputEvent(`Mercury debug: '${command}' did not complete as expected — ${String(err)}\n`, 'stderr'));
            this.sendEvent(new StoppedEvent('step', 1));
        }
    }

    protected pauseRequest(response: DebugProtocol.PauseResponse): void {
        this.sendErrorResponse(response, 1, "Pausing a running mdb session isn't supported by this bridge (mdb is prompt-driven and synchronous) — use a breakpoint instead.");
    }

    protected async stackTraceRequest(response: DebugProtocol.StackTraceResponse): Promise<void> {
        if (!this.mdb) { response.body = { stackFrames: [], totalFrames: 0 }; this.sendResponse(response); return; }
        try {
            const out = await this.mdb.sendCommand('stack');
            this.sendEvent(new OutputEvent(out, 'console'));
            let frames = extractStackWithContext(out);
            // Fall back to the most recent trace-event stop (already parsed
            // when we last saw mdb print one) as a single synthetic top
            // frame if `stack`'s own output didn't parse into anything —
            // better than an empty call stack when only this one part of
            // the output format assumption doesn't hold.
            if (frames.length === 0 && this.lastStop) {
                frames = [{
                    frame: { index: 0, name: this.lastStop.name, arity: this.lastStop.arity, moduleQualifier: this.lastStop.moduleQualifier, raw: this.lastStop.raw },
                    context: this.lastStopContext,
                }];
            }
            const dapFrames: DebugProtocol.StackFrame[] = await Promise.all(
                frames.map(async ({ frame: f, context }, i) => {
                    // Prefer a real source location mdb itself reported
                    // (via `context prevline` — see mdbProtocol.ts) over
                    // this extension's own declaration-based fallback,
                    // which only ever points at a predicate's declaration
                    // line, not its actual current position in the stack.
                    if (context) {
                        const uri = await this.resolveFileUri(context.file);
                        if (uri) {
                            return new StackFrame(
                                i,
                                `${f.moduleQualifier ? f.moduleQualifier + '.' : ''}${f.name}/${f.arity}`,
                                new Source(context.file.split('/').pop() ?? context.file, uri),
                                context.line,
                            );
                        }
                    }
                    const loc = await this.resolveDeclarationLocation(f.name, f.arity);
                    return new StackFrame(
                        i,
                        `${f.moduleQualifier ? f.moduleQualifier + '.' : ''}${f.name}/${f.arity}`,
                        loc ? new Source(loc.uri.split('/').pop() ?? '', loc.uri.replace('file://', '')) : undefined,
                        loc ? loc.line + 1 : undefined,
                    );
                }),
            );
            response.body = { stackFrames: dapFrames, totalFrames: dapFrames.length };
        } catch (err) {
            this.sendEvent(new OutputEvent(`Mercury debug: could not retrieve the stack — ${String(err)}\n`, 'stderr'));
            response.body = { stackFrames: [], totalFrames: 0 };
        }
        this.sendResponse(response);
    }

    protected scopesRequest(response: DebugProtocol.ScopesResponse): void {
        response.body = { scopes: [new Scope('Locals', this.variableHandles.create('locals'), false)] };
        this.sendResponse(response);
    }

    protected async variablesRequest(response: DebugProtocol.VariablesResponse): Promise<void> {
        if (!this.mdb) { response.body = { variables: [] }; this.sendResponse(response); return; }
        try {
            const out = await this.mdb.sendCommand('vars');
            this.sendEvent(new OutputEvent(out, 'console'));
            const vars = parseVariablesOutput(out);
            response.body = { variables: vars.map((v) => ({ name: v.name, value: v.value, variablesReference: 0 })) };
        } catch (err) {
            this.sendEvent(new OutputEvent(`Mercury debug: could not retrieve variables — ${String(err)}\n`, 'stderr'));
            response.body = { variables: [] };
        }
        this.sendResponse(response);
    }

    protected async evaluateRequest(response: DebugProtocol.EvaluateResponse, args: DebugProtocol.EvaluateArguments): Promise<void> {
        // Safety valve: pass the expression through to mdb verbatim (e.g.
        // typed into the Debug Console as `print X` or any other real mdb
        // command) rather than trying to interpret it ourselves.
        if (!this.mdb) { response.body = { result: '(mdb is not running)', variablesReference: 0 }; this.sendResponse(response); return; }
        try {
            const out = await this.mdb.sendCommand(args.expression);
            this.sendEvent(new OutputEvent(out, 'console'));
            response.body = { result: out.replace(/mdb>\s*$/, '').trim(), variablesReference: 0 };
        } catch (err) {
            response.body = { result: `(error: ${String(err)})`, variablesReference: 0 };
        }
        this.sendResponse(response);
    }

    protected disconnectRequest(response: DebugProtocol.DisconnectResponse): void {
        this.mdb?.dispose();
        this.sendResponse(response);
    }

    protected terminateRequest(response: DebugProtocol.TerminateResponse): void {
        this.mdb?.dispose();
        this.sendResponse(response);
    }
}
