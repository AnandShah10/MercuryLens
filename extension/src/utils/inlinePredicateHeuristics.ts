/**
 * Pure text-analysis and code-generation helpers for the Inline Predicate
 * refactoring. Kept vscode-free (see extractPredicateHeuristics.ts's note
 * on why) so the actual substitution logic — the part most worth getting
 * right — can be unit tested directly.
 *
 * SAFE SUBSET. Inline Predicate only ever operates on:
 *   - a target predicate/function with EXACTLY ONE clause across the
 *     workspace (multiple clauses encode Mercury's own backtracking-driven
 *     clause selection — collapsing them into a single call site would
 *     silently change which solutions the program can produce);
 *   - a target declared `is det` (a `semidet`/`multi`/`nondet` predicate's
 *     possible failure/multiple solutions can't be represented by plain
 *     inline substitution without additional control structure this
 *     refactoring does not attempt to synthesize);
 *   - every argument mode is exactly `in` or `out` (a `di`/`uo`/`mdi`/`muo`
 *     argument — e.g. an I/O state — carries uniqueness/destructive-update
 *     semantics that a naive substitution could violate);
 *   - a clause body with no top-level disjunction (`;`) — a single
 *     unconditional sequence of goals only (if-then-else IS allowed, since
 *     it's a single deterministic control construct, not an alternative
 *     clause);
 *   - a call site that is itself a complete, standalone top-level goal in
 *     the caller's clause body (e.g. `foo(X, Result), bar(Result)`), not a
 *     function-style call nested inside a larger expression (e.g.
 *     `Y = 1 + foo(X)`) — splicing a goal into the middle of an expression
 *     requires hoisting logic this refactoring does not attempt.
 *
 * Outside this subset, `planInline` returns a `refusal` with a specific,
 * human-readable reason rather than guessing.
 */

export interface CalleeInfo {
    /** The formal parameter names as written in the clause head, in
     * declaration order (e.g. ["X", "Y"] for `foo(X, Y) :- ...`). */
    headVars: string[];
    /** One mode per argument, aligned by position, from the predicate's own
     * `:- pred`/`:- func` (or `:- mode`) declaration. */
    argModes: (string | undefined)[];
    determinism: string | undefined;
    /** The clause body text (everything after `:-`, before the trailing
     * `.`), or undefined for a fact (`foo(X, Y).` with no body). */
    body: string | undefined;
}

export interface InlinePlan {
    kind: 'plan';
    /** Goals to run BEFORE the inlined body (binds `in`-moded parameters). */
    prefixGoals: string[];
    /** The callee's body, with every variable alpha-renamed to a name not
     * used anywhere in the caller's clause. */
    renamedBody: string;
    /** Goals to run AFTER the inlined body (binds `out`-moded parameters
     * back to the call site's own argument expressions). */
    suffixGoals: string[];
}

export interface InlineRefusal {
    kind: 'refusal';
    reason: string;
}

export type InlineResult = InlinePlan | InlineRefusal;

function findBracketImbalanceLocal(text: string): number {
    let depth = 0;
    let inString = false;
    let inAtom = false;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (inString) { if (ch === '\\') { i++; continue; } if (ch === '"') inString = false; continue; }
        if (inAtom) { if (ch === '\\') { i++; continue; } if (ch === "'") inAtom = false; continue; }
        if (ch === '"') { inString = true; continue; }
        if (ch === "'") { inAtom = true; continue; }
        if (ch === '(' || ch === '[' || ch === '{') depth++;
        else if (ch === ')' || ch === ']' || ch === '}') depth--;
    }
    return depth;
}

/** True if `text` contains a `;` at bracket-depth 0, outside strings/atoms
 * — i.e. a top-level disjunction. */
/** True if `text` contains a `;` outside strings/quoted atoms — i.e. a
 * disjunction goal, at any nesting depth. Unlike commas or most other
 * punctuation, Mercury's grammar never allows `;` to appear inside a plain
 * term/argument list (it is specifically the goal-level disjunction
 * operator) — so any `;` at all, even one nested inside an if-then-else's
 * condition or wrapped in its own parens (the idiomatic `( A ; B )` form),
 * genuinely indicates a disjunction somewhere in the body, not just a
 * "top-level" one (the exported name is kept for API stability with its
 * call sites/tests). */
export function hasTopLevelDisjunction(text: string): boolean {
    let inString = false;
    let inAtom = false;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (inString) { if (ch === '\\') { i++; continue; } if (ch === '"') inString = false; continue; }
        if (inAtom) { if (ch === '\\') { i++; continue; } if (ch === "'") inAtom = false; continue; }
        if (ch === '"') { inString = true; continue; }
        if (ch === "'") { inAtom = true; continue; }
        if (ch === ';') return true;
    }
    return false;
}

/** Splits `text` on top-level commas (bracket/string/atom-aware) — used to
 * find the exact conjunct a selected/cursor-targeted call belongs to. */
export function splitTopLevelConjuncts(text: string): { text: string; start: number; end: number }[] {
    const parts: { text: string; start: number; end: number }[] = [];
    let depth = 0;
    let inString = false;
    let inAtom = false;
    let start = 0;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (inString) { if (ch === '\\') { i++; continue; } if (ch === '"') inString = false; continue; }
        if (inAtom) { if (ch === '\\') { i++; continue; } if (ch === "'") inAtom = false; continue; }
        if (ch === '"') { inString = true; continue; }
        if (ch === "'") { inAtom = true; continue; }
        if (ch === '(' || ch === '[' || ch === '{') depth++;
        else if (ch === ')' || ch === ']' || ch === '}') depth--;
        else if (ch === ',' && depth === 0) {
            parts.push({ text: text.slice(start, i), start, end: i });
            start = i + 1;
        }
    }
    parts.push({ text: text.slice(start), start, end: text.length });
    return parts;
}

/** Collects every Mercury variable name in `text`, ignoring occurrences
 * inside string/quoted-atom literals. */
function collectVariablesSafe(text: string): Set<string> {
    const set = new Set<string>();
    let inString = false;
    let inAtom = false;
    const re = /[A-Z_][A-Za-z0-9_]*/g;
    let i = 0;
    while (i < text.length) {
        const ch = text[i];
        if (inString) { if (ch === '\\') { i += 2; continue; } if (ch === '"') inString = false; i++; continue; }
        if (inAtom) { if (ch === '\\') { i += 2; continue; } if (ch === "'") inAtom = false; i++; continue; }
        if (ch === '"') { inString = true; i++; continue; }
        if (ch === "'") { inAtom = true; i++; continue; }
        re.lastIndex = i;
        const m = re.exec(text);
        if (m && m.index === i) {
            set.add(m[0]);
            i += m[0].length;
        } else {
            i++;
        }
    }
    return set;
}

/** Renames every whole-word occurrence of a mapped variable in `text` to
 * its replacement, skipping occurrences inside string/quoted-atom
 * literals so a variable-shaped substring inside program text (e.g. a
 * user-facing message) is never corrupted. */
export function renameVariablesInText(text: string, mapping: Map<string, string>): string {
    let out = '';
    let inString = false;
    let inAtom = false;
    let i = 0;
    const wordRe = /[A-Za-z_][A-Za-z0-9_]*/y;
    while (i < text.length) {
        const ch = text[i];
        if (inString) {
            if (ch === '\\') { out += text.slice(i, i + 2); i += 2; continue; }
            if (ch === '"') inString = false;
            out += ch; i++; continue;
        }
        if (inAtom) {
            if (ch === '\\') { out += text.slice(i, i + 2); i += 2; continue; }
            if (ch === "'") inAtom = false;
            out += ch; i++; continue;
        }
        if (ch === '"') { inString = true; out += ch; i++; continue; }
        if (ch === "'") { inAtom = true; out += ch; i++; continue; }
        if (/[A-Za-z_]/.test(ch)) {
            wordRe.lastIndex = i;
            const m = wordRe.exec(text);
            if (m) {
                const word = m[0];
                out += mapping.get(word) ?? word;
                i += word.length;
                continue;
            }
        }
        out += ch;
        i++;
    }
    return out;
}

/** Builds fresh, collision-free names for every variable that appears in
 * the callee (head + body), suffixed to avoid clashing with anything
 * already in scope at the call site. */
export function buildRenameMapping(calleeVars: Set<string>, existingCallerVars: Set<string>): Map<string, string> {
    const mapping = new Map<string, string>();
    const taken = new Set(existingCallerVars);
    for (const v of calleeVars) {
        let candidate = `${v}_Inl`;
        let n = 2;
        while (taken.has(candidate) || calleeVars.has(candidate)) {
            candidate = `${v}_Inl${n}`;
            n++;
        }
        mapping.set(v, candidate);
        taken.add(candidate);
    }
    return mapping;
}

const PRIMITIVE_LIKE_MODES = new Set(['in', 'out']);

/** Computes an inline plan for substituting a call `name(callArgs...)`
 * with the callee's own logic, or a refusal with a specific reason if the
 * callee/call site falls outside the safe subset described above. */
export function planInline(callee: CalleeInfo, callArgs: string[], existingCallerVars: Set<string>): InlineResult {
    if (callee.determinism !== 'det') {
        return { kind: 'refusal', reason: `Only 'det' predicates/functions can be safely inlined (this one is '${callee.determinism ?? 'undeclared'}'). A semidet/multi/nondet callee's possible failure or multiple solutions can't be represented by plain substitution.` };
    }
    if (callArgs.length !== callee.headVars.length) {
        return { kind: 'refusal', reason: `Argument count mismatch: the call has ${callArgs.length} argument(s) but the declaration has ${callee.headVars.length}.` };
    }
    const badModeIndex = callee.argModes.findIndex((m) => m !== undefined && !PRIMITIVE_LIKE_MODES.has(m));
    if (badModeIndex >= 0) {
        return { kind: 'refusal', reason: `Argument ${badModeIndex + 1} has mode '${callee.argModes[badModeIndex]}', which is not 'in' or 'out' (e.g. a di/uo I/O-state-like argument). Inlining such arguments could violate Mercury's uniqueness/destructive-update semantics, so this is refused.` };
    }
    if (callee.body !== undefined && hasTopLevelDisjunction(callee.body)) {
        return { kind: 'refusal', reason: `The callee's body contains a top-level disjunction (';'), which this refactoring does not attempt to inline safely.` };
    }
    if (findBracketImbalanceLocal(callArgs.join(',')) !== 0) {
        return { kind: 'refusal', reason: 'One or more call arguments have unbalanced brackets.' };
    }

    const calleeVars = collectVariablesSafe([...callee.headVars, callee.body ?? ''].join(' '));
    const mapping = buildRenameMapping(calleeVars, existingCallerVars);

    const prefixGoals: string[] = [];
    const suffixGoals: string[] = [];
    for (let i = 0; i < callee.headVars.length; i++) {
        const renamedVar = mapping.get(callee.headVars[i]) ?? callee.headVars[i];
        const mode = callee.argModes[i] ?? 'in';
        if (mode === 'out') {
            suffixGoals.push(`${callArgs[i].trim()} = ${renamedVar}`);
        } else {
            prefixGoals.push(`${renamedVar} = ${callArgs[i].trim()}`);
        }
    }

    const renamedBody = callee.body !== undefined ? renameVariablesInText(callee.body, mapping).trim() : 'true';

    return { kind: 'plan', prefixGoals, renamedBody, suffixGoals };
}

/** Renders a plan's goals as a single parenthesized conjunction, safe to
 * splice in as a replacement for the original call-site conjunct. */
export function renderInlinePlan(plan: InlinePlan): string {
    const goals = [...plan.prefixGoals, plan.renamedBody, ...plan.suffixGoals].filter((g) => g.trim().length > 0);
    return `(\n    ${goals.join(',\n    ')}\n)`;
}
