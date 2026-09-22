/**
 * Text parsing/command-building for Mercury's interactive debugger
 * (`mdb`), used by ../debug/mdbSession.ts's DAP bridge.
 *
 * VERIFICATION NOTE: this project could not run a live `mdb` (no Mercury
 * installation was available — see docs/compiler-integration.md), but the
 * formats assumed below are not guesses from memory: they were checked
 * against the official Mercury User's Guide and a peer-reviewed
 * description of the Mercury trace (Jahier, "Understanding the Mercury
 * Trace", the Morphine manual) while building this. In particular:
 *
 *   - The `pred Name/Arity-ModeNum` reference format is taken directly
 *     from a literal example in the User's Guide's `dice` command
 *     documentation ("pred s.mrg/3-0 CALL s.m:64 ..."), not inferred.
 *   - `context prevline` is a real, documented mdb command (Parameter
 *     commands chapter) that prints a `filename:line` context on its own
 *     line immediately before each event/stack-frame report — chosen
 *     deliberately over the default (or `before`/`after`, which print on
 *     the same line and can wrap for long qualified names) because a
 *     separate, fixed-shape line is the most reliably parseable option
 *     the debugger itself offers. mdbSession.ts sends this once at
 *     startup so every subsequent report includes real source positions
 *     from mdb itself, in addition to (and preferred over) this
 *     extension's own workspace-index-based location fallback.
 *   - The event ports (CALL/EXIT/REDO/FAIL/EXCP + the internal
 *     THEN/ELSE/DISJ/SWITCH/COND/NEGE/NEGS events) and the determinism-
 *     dependent event sequences are taken directly from the User's
 *     Guide's "Tracing of Mercury programs" chapter.
 *
 * What is still genuinely unverified: the exact column layout/whitespace
 * of a plain trace or `stack` line in interactive ("creep") mode, as
 * opposed to the `dice` table example above — the documentation describes
 * the fields present (event number, call number, depth, port, procedure)
 * but not their literal separator characters in that mode. The parsers
 * below match on the distinctive, well-confirmed substrings (the port
 * keyword, the `pred|func Name/Arity` reference, a `file.m:line` context
 * line) rather than fixed column positions, specifically so they tolerate
 * whitespace/separator differences from the exact literal example. Every
 * parser here still returns `undefined`/`[]` rather than fabricating a
 * result when a line doesn't match, and mdbSession.ts always forwards
 * mdb's raw unmodified output to the Debug Console alongside any
 * structured interpretation.
 */

export type MdbPort = 'CALL' | 'EXIT' | 'REDO' | 'FAIL' | 'EXCP' | 'THEN' | 'ELSE' | 'DISJ' | 'SWITCH' | 'COND' | 'NEGE' | 'NEGS';

const PORTS: MdbPort[] = ['CALL', 'EXIT', 'REDO', 'FAIL', 'EXCP', 'THEN', 'ELSE', 'DISJ', 'SWITCH', 'COND', 'NEGE', 'NEGS'];

export interface MdbTraceEvent {
    port: MdbPort;
    /** Unqualified predicate/function name. */
    name: string;
    /** Declared arity as mdb reports it (see the module doc's confidence
     * note — this may or may not line up with this project's own arity
     * convention for functions; callers should resolve by name first and
     * fall back across nearby arities rather than requiring an exact
     * match). */
    arity: number;
    moduleQualifier?: string;
    raw: string;
}

/**
 * Parses one line of mdb trace output. mdb's classic trace-event line
 * names the port (CALL/EXIT/...) and the resolved predicate/function as
 * `[Module.]Name/Arity`. This regex is intentionally loose about
 * everything else on the line (event numbers, call-depth, determinism
 * annotations, mode numbers) since this project only needs "which port,
 * which predicate" to drive DAP stop events and resolve a source location
 * via its own workspace index — not to reproduce mdb's full trace display.
 */
export function parseTraceEventLine(line: string): MdbTraceEvent | undefined {
    const portPattern = PORTS.join('|');
    const m = line.match(new RegExp(`\\b(${portPattern})\\b[^\\n]*?\\b(?:pred|func)\\s+([A-Za-z_][A-Za-z0-9_.]*)\\/(\\d+)`));
    if (!m) return undefined;
    const qualified = m[2];
    const dotIdx = qualified.lastIndexOf('.');
    return {
        port: m[1] as MdbPort,
        moduleQualifier: dotIdx >= 0 ? qualified.slice(0, dotIdx) : undefined,
        name: dotIdx >= 0 ? qualified.slice(dotIdx + 1) : qualified,
        arity: parseInt(m[3], 10),
        raw: line,
    };
}

/** True for the ports that represent a real "stopped here" moment worth
 * surfacing to the user (as opposed to internal control-flow ports like
 * THEN/ELSE/DISJ/SWITCH/COND/NEGE/NEGS, which fire far more often and
 * would make ordinary stepping unusable if treated the same as CALL/EXIT). */
export function isUserVisiblePort(port: MdbPort): boolean {
    return port === 'CALL' || port === 'EXIT' || port === 'FAIL' || port === 'REDO' || port === 'EXCP';
}

export interface MdbStackFrame {
    index: number;
    name: string;
    arity: number;
    moduleQualifier?: string;
    raw: string;
}

/**
 * Parses `mdb`'s `stack` command output into frames, one per line that
 * looks like a trace-event-shaped predicate reference (mdb's stack display
 * uses the same `[Module.]Name/Arity` convention as trace events). Lines
 * that don't match are skipped rather than guessed at.
 */
export function parseStackOutput(output: string): MdbStackFrame[] {
    const frames: MdbStackFrame[] = [];
    const lines = output.split(/\r\n|\n/);
    let index = 0;
    for (const line of lines) {
        const m = line.match(/\b(?:pred|func)\s+([A-Za-z_][A-Za-z0-9_.]*)\/(\d+)/);
        if (!m) continue;
        const qualified = m[1];
        const dotIdx = qualified.lastIndexOf('.');
        frames.push({
            index: index++,
            moduleQualifier: dotIdx >= 0 ? qualified.slice(0, dotIdx) : undefined,
            name: dotIdx >= 0 ? qualified.slice(dotIdx + 1) : qualified,
            arity: parseInt(m[2], 10),
            raw: line,
        });
    }
    return frames;
}

export interface MdbVariable {
    name: string;
    value: string;
}

/**
 * Parses variable-listing output leniently: any line of the form
 * `Name = Value` or `Name :: Type = Value` becomes one variable. This is
 * intentionally permissive (see the module doc's confidence note) — a line
 * that doesn't match this shape is simply not reported as a variable
 * rather than guessed at.
 */
export function parseVariablesOutput(output: string): MdbVariable[] {
    const variables: MdbVariable[] = [];
    for (const line of output.split(/\r\n|\n/)) {
        const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*(?:::[^=]*)?=\s*(.+?)\s*$/);
        if (m) variables.push({ name: m[1], value: m[2] });
    }
    return variables;
}

export interface MdbContext {
    file: string;
    /** 1-based, as mdb itself reports it. */
    line: number;
}

/**
 * Parses a `context prevline`-style context line: a line containing
 * nothing but `filename:linenum` (see the module doc's verification note
 * — the literal token shape `file.m:64` is confirmed from a real User's
 * Guide example, though that example is from a different mdb display
 * mode; the `prevline` mode is documented to print "a filename/line
 * number pair" on its own line, which this assumes takes the same
 * `file:line` shape used elsewhere in mdb's output).
 */
export function parseContextLine(line: string): MdbContext | undefined {
    const m = line.trim().match(/^([^\s:]+\.m):(\d+)$/);
    if (!m) return undefined;
    return { file: m[1], line: parseInt(m[2], 10) };
}

/**
 * Scans mdb output for trace-event lines, associating each with the
 * nearest preceding `context prevline` context line (if any precedes it
 * with no intervening event line). Returns events in the order they
 * appear. Use this instead of a single `parseTraceEventLine` call when
 * `context prevline` is active (mdbSession.ts enables it at startup) to
 * get a real source location alongside each event, rather than relying
 * solely on this project's own declaration-based location fallback.
 */
export function extractTraceEventsWithContext(output: string): { event: MdbTraceEvent; context?: MdbContext }[] {
    const results: { event: MdbTraceEvent; context?: MdbContext }[] = [];
    let pendingContext: MdbContext | undefined;
    for (const line of output.split(/\r\n|\n/)) {
        const context = parseContextLine(line);
        if (context) {
            pendingContext = context;
            continue;
        }
        const event = parseTraceEventLine(line);
        if (event) {
            results.push({ event, context: pendingContext });
            pendingContext = undefined;
        }
    }
    return results;
}

/**
 * Same idea as `extractTraceEventsWithContext`, but for `stack` command
 * output (one context line, then one stack-frame line, repeated).
 */
export function extractStackWithContext(output: string): { frame: MdbStackFrame; context?: MdbContext }[] {
    const results: { frame: MdbStackFrame; context?: MdbContext }[] = [];
    let pendingContext: MdbContext | undefined;
    let index = 0;
    for (const line of output.split(/\r\n|\n/)) {
        const context = parseContextLine(line);
        if (context) {
            pendingContext = context;
            continue;
        }
        const m = line.match(/\b(?:pred|func)\s+([A-Za-z_][A-Za-z0-9_.]*)\/(\d+)/);
        if (m) {
            const qualified = m[1];
            const dotIdx = qualified.lastIndexOf('.');
            results.push({
                frame: {
                    index: index++,
                    moduleQualifier: dotIdx >= 0 ? qualified.slice(0, dotIdx) : undefined,
                    name: dotIdx >= 0 ? qualified.slice(dotIdx + 1) : qualified,
                    arity: parseInt(m[2], 10),
                    raw: line,
                },
                context: pendingContext,
            });
            pendingContext = undefined;
        }
    }
    return results;
}

export function buildBreakCommand(name: string, arity: number, moduleQualifier?: string): string {
    const qualified = moduleQualifier ? `${moduleQualifier}.${name}` : name;
    return `break ${qualified}/${arity}`;
}
