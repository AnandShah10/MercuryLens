import { splitTopLevelTerms } from './lexer';
import { ArgMode, ClauseNode, Determinism, ModuleDoc, Purity, Range, SymbolNode } from './ast';
import { findMatchingClose, parseArgSpec, splitTopLevelCommas, splitTopLevelOn } from './termUtils';

const PURITIES: Purity[] = ['pure', 'semipure', 'impure'];

/** Strips leading doc-comment lines (consecutive `%` lines) from a raw term,
 * returning the comment text and the remaining code with its offset. */
function splitLeadingComment(raw: string): { doc?: string; code: string; codeOffset: number } {
    const lines = raw.split('\n');
    let i = 0;
    const docLines: string[] = [];
    let offset = 0;
    while (i < lines.length) {
        const trimmed = lines[i].trim();
        if (trimmed === '') { offset += lines[i].length + 1; i++; continue; }
        if (trimmed.startsWith('%')) {
            docLines.push(trimmed.replace(/^%+\s?/, ''));
            offset += lines[i].length + 1;
            i++;
            continue;
        }
        break;
    }
    const code = lines.slice(i).join('\n');
    return { doc: docLines.length > 0 ? docLines.join('\n') : undefined, code, codeOffset: offset };
}

export function parseModule(uri: string, source: string): ModuleDoc {
    const terms = splitTopLevelTerms(source);
    const symbols: SymbolNode[] = [];
    const clauses: ClauseNode[] = [];
    const imports: string[] = [];
    const useModules: string[] = [];
    const syntaxProblems: ModuleDoc['syntaxProblems'] = [];
    let moduleName: string | undefined;

    const lineStartOffsets: number[] = [0];
    for (let i = 0; i < source.length; i++) if (source[i] === '\n') lineStartOffsets.push(i + 1);
    const lineColOf = (offset: number): { line: number; col: number } => {
        let lo = 0, hi = lineStartOffsets.length - 1;
        while (lo < hi) {
            const mid = (lo + hi + 1) >> 1;
            if (lineStartOffsets[mid] <= offset) lo = mid; else hi = mid - 1;
        }
        return { line: lo, col: offset - lineStartOffsets[lo] };
    };
    const rangeFor = (absStart: number, absEnd: number): Range => {
        const s = lineColOf(absStart);
        const e = lineColOf(absEnd);
        return { startLine: s.line, startCol: s.col, endLine: e.line, endCol: e.col };
    };

    for (const term of terms) {
        const { doc, code, codeOffset } = splitLeadingComment(term.text);
        const codeAbsStart = term.startOffset + codeOffset;
        const trimmedCode = code.trim();
        if (trimmedCode.length === 0) continue;
        const leadWs = code.length - code.trimStart().length;
        const codeStart = codeAbsStart + leadWs;
        const codeEnd = term.endOffset;
        const fullRange = rangeFor(codeStart, codeEnd);
        const docObj = doc ? { text: doc, range: rangeFor(term.startOffset, codeStart) } : undefined;

        if (trimmedCode.startsWith(':-')) {
            parseDirective(trimmedCode, codeStart, source, {
                onModule: (name, nameOffset) => {
                    moduleName = name;
                    symbols.push(makeSymbol('module', name, fullRange, rangeFor(nameOffset, nameOffset + name.length), trimmedCode, docObj, moduleName));
                },
                onEndModule: () => { /* scoping end; nothing to index */ },
                onImport: (mods, isUse) => {
                    for (const m of mods) {
                        if (isUse) useModules.push(m); else imports.push(m);
                    }
                    symbols.push({
                        kind: isUse ? 'use_module' : 'import',
                        name: mods.join(', '),
                        importedModules: mods,
                        range: fullRange,
                        nameRange: fullRange,
                        raw: trimmedCode,
                        doc: docObj,
                        module: moduleName,
                    });
                },
                onPredOrFunc: (kind, name, nameOffset, args, det, purity) => {
                    symbols.push(makeSymbol(kind, name, fullRange, rangeFor(nameOffset, nameOffset + name.length), trimmedCode, docObj, moduleName, {
                        arity: args.length,
                        args,
                        determinism: det,
                        purity,
                    }));
                },
                onMode: (name, nameOffset, args, det) => {
                    symbols.push(makeSymbol('mode', name, fullRange, rangeFor(nameOffset, nameOffset + name.length), trimmedCode, docObj, moduleName, {
                        arity: args.length,
                        args,
                        determinism: det,
                    }));
                },
                onType: (name, nameOffset, arity, def) => {
                    symbols.push(makeSymbol('type', name, fullRange, rangeFor(nameOffset, nameOffset + name.length), trimmedCode, docObj, moduleName, {
                        arity,
                        typeDefinition: def,
                    }));
                },
                onTypeclassOrInstance: (kind, name, nameOffset, arity) => {
                    symbols.push(makeSymbol(kind, name, fullRange, rangeFor(nameOffset, nameOffset + name.length), trimmedCode, docObj, moduleName, { arity }));
                },
                onInitFinal: (kind, name, nameOffset) => {
                    symbols.push(makeSymbol(kind, name, fullRange, rangeFor(nameOffset, nameOffset + name.length), trimmedCode, docObj, moduleName));
                },
                onPragma: () => {
                    symbols.push({ kind: 'pragma', name: '(pragma)', range: fullRange, nameRange: fullRange, raw: trimmedCode, doc: docObj, module: moduleName });
                },
                onUnrecognized: () => { /* silently ignored: not every declaration form needs indexing */ },
            });
        } else {
            const clause = parseClause(trimmedCode, codeStart, rangeFor);
            if (clause) clauses.push({ ...clause, range: fullRange });
        }
    }

    return { uri, moduleName, symbols, clauses, imports, useModules, syntaxProblems };
}

function makeSymbol(
    kind: SymbolNode['kind'],
    name: string,
    range: Range,
    nameRange: Range,
    raw: string,
    doc: SymbolNode['doc'],
    module: string | undefined,
    extra: Partial<SymbolNode> = {},
): SymbolNode {
    return { kind, name, range, nameRange, raw, doc, module, ...extra };
}

interface DirectiveHandlers {
    onModule: (name: string, nameOffset: number) => void;
    onEndModule: (name: string) => void;
    onImport: (mods: string[], isUse: boolean) => void;
    onPredOrFunc: (kind: 'predicate' | 'function', name: string, nameOffset: number, args: ArgMode[], det?: Determinism, purity?: Purity) => void;
    onMode: (name: string, nameOffset: number, args: ArgMode[], det?: Determinism) => void;
    onType: (name: string, nameOffset: number, arity: number, def?: string) => void;
    onTypeclassOrInstance: (kind: 'typeclass' | 'instance', name: string, nameOffset: number, arity: number) => void;
    onInitFinal: (kind: 'initialise' | 'finalise', name: string, nameOffset: number) => void;
    onPragma: () => void;
    onUnrecognized: (code: string) => void;
}

/** Parses a single `:- ...` declaration. `absStart` is the absolute source
 * offset of the first character of `code` (the ':' of ':-'). */
function parseDirective(code: string, absStart: number, _source: string, h: DirectiveHandlers): void {
    // Strip ':-' and the trailing '.'
    let body = code.slice(2);
    const bodyOffset = absStart + 2;
    body = body.replace(/\.\s*$/, '');
    const leadWs = body.length - body.trimStart().length;
    const trimmedBody = body.trim();
    const trimmedOffset = bodyOffset + leadWs;

    let m: RegExpMatchArray | null;

    if ((m = trimmedBody.match(/^module\s+([A-Za-z_][A-Za-z0-9_.]*)\s*$/))) {
        const nameOffset = trimmedOffset + m[0].indexOf(m[1]);
        h.onModule(m[1], nameOffset);
        return;
    }
    if (trimmedBody === 'interface' || trimmedBody === 'implementation') {
        return; // section markers; not indexed as symbols
    }
    if ((m = trimmedBody.match(/^end_module\s+([A-Za-z_][A-Za-z0-9_.]*)\s*$/))) {
        h.onEndModule(m[1]);
        return;
    }
    if ((m = trimmedBody.match(/^(import_module|use_module)\s+(.+)$/s))) {
        const mods = splitTopLevelCommas(m[2]).map((s) => s.trim()).filter(Boolean);
        h.onImport(mods, m[1] === 'use_module');
        return;
    }
    if ((m = trimmedBody.match(/^include_module\s+(.+)$/s))) {
        return; // sub-module inclusion; not separately indexed in this pass
    }
    if ((m = trimmedBody.match(/^(pred|func)\s+/))) {
        parsePredOrFunc(m[1] as 'pred' | 'func', trimmedBody, trimmedOffset, h);
        return;
    }
    if ((m = trimmedBody.match(/^mode\s+/))) {
        parseModeDecl(trimmedBody, trimmedOffset, h);
        return;
    }
    if ((m = trimmedBody.match(/^type\s+/))) {
        parseTypeDecl(trimmedBody, trimmedOffset, h);
        return;
    }
    if ((m = trimmedBody.match(/^(typeclass|instance)\s+([A-Za-z_][A-Za-z0-9_.]*)\s*(\(([^]*)\))?/))) {
        const nameOffset = trimmedOffset + m[0].indexOf(m[2], m[1].length);
        const arity = m[4] ? splitTopLevelCommas(m[4]).length : 0;
        h.onTypeclassOrInstance(m[1] as 'typeclass' | 'instance', m[2], nameOffset, arity);
        return;
    }
    if ((m = trimmedBody.match(/^(initialise|initialize|finalise|finalize)\s+([A-Za-z_][A-Za-z0-9_.]*)/))) {
        const kind = m[1].startsWith('init') ? 'initialise' : 'finalise';
        const nameOffset = trimmedOffset + m[0].indexOf(m[2], m[1].length);
        h.onInitFinal(kind, m[2], nameOffset);
        return;
    }
    if (trimmedBody.startsWith('pragma')) {
        h.onPragma();
        return;
    }
    h.onUnrecognized(trimmedBody);
}

function parseArgListAt(text: string, absOffsetOfText: number): { args: ArgMode[]; afterIndex: number } {
    if (text[0] !== '(') return { args: [], afterIndex: 0 };
    const close = findMatchingClose(text, 0);
    if (close < 0) return { args: [], afterIndex: text.length };
    const inner = text.slice(1, close);
    const parts = splitTopLevelCommas(inner);
    const args: ArgMode[] = parts.map((p) => ({ raw: p, ...parseArgSpec(p) }));
    void absOffsetOfText;
    return { args, afterIndex: close + 1 };
}

function extractDeterminism(tail: string): Determinism | undefined {
    const m = tail.match(/\bis\s+(det|semidet|multi|nondet|failure|erroneous|cc_multi|cc_nondet)\b/);
    return m ? (m[1] as Determinism) : undefined;
}

function extractPurity(head: string): Purity | undefined {
    for (const p of PURITIES) {
        if (new RegExp(`^${p}\\s+`).test(head)) return p;
    }
    return undefined;
}

function parsePredOrFunc(kw: 'pred' | 'func', trimmedBody: string, trimmedOffset: number, h: DirectiveHandlers): void {
    let rest = trimmedBody.slice(kw.length).trimStart();
    let consumed = trimmedBody.length - rest.length;
    const purity = extractPurity(rest);
    if (purity) {
        const skip = rest.match(new RegExp(`^${purity}\\s+`))![0].length;
        rest = rest.slice(skip);
        consumed += skip;
    }
    const nameMatch = rest.match(/^([A-Za-z_][A-Za-z0-9_.]*|'[^']*')/);
    if (!nameMatch) { h.onUnrecognized(trimmedBody); return; }
    const rawName = nameMatch[1];
    const name = rawName.startsWith("'") ? rawName.slice(1, -1) : rawName;
    const nameOffset = trimmedOffset + consumed;
    const afterName = rest.slice(nameMatch[0].length);
    const det = extractDeterminism(afterName);

    if (kw === 'func') {
        // func name(Args) = RetSpec is Det.
        const { args: paramArgs, afterIndex } = parseArgListAt(afterName, 0);
        const afterParams = afterName.slice(afterIndex);
        const eqMatch = afterParams.match(/^\s*=\s*/);
        let retArg: ArgMode | undefined;
        if (eqMatch) {
            const afterEq = afterParams.slice(eqMatch[0].length);
            const retMatch = afterEq.match(/^([^\s]+(\s*::\s*[A-Za-z_][A-Za-z0-9_]*)?)/);
            if (retMatch) retArg = { raw: retMatch[1], ...parseArgSpec(retMatch[1]) };
        }
        const allArgs = retArg ? [...paramArgs, retArg] : paramArgs;
        h.onPredOrFunc('function', name, nameOffset, allArgs, det, purity);
    } else {
        const { args } = parseArgListAt(afterName, 0);
        h.onPredOrFunc('predicate', name, nameOffset, args, det, purity);
    }
}

function parseModeDecl(trimmedBody: string, trimmedOffset: number, h: DirectiveHandlers): void {
    const rest = trimmedBody.slice('mode'.length).trimStart();
    const consumed = trimmedBody.length - rest.length;
    const nameMatch = rest.match(/^([A-Za-z_][A-Za-z0-9_.]*|'[^']*')/);
    if (!nameMatch) { h.onUnrecognized(trimmedBody); return; }
    const rawName = nameMatch[1];
    const name = rawName.startsWith("'") ? rawName.slice(1, -1) : rawName;
    const nameOffset = trimmedOffset + consumed;
    const afterName = rest.slice(nameMatch[0].length);
    const { args } = parseArgListAt(afterName, 0);
    const det = extractDeterminism(afterName);
    h.onMode(name, nameOffset, args, det);
}

function parseTypeDecl(trimmedBody: string, trimmedOffset: number, h: DirectiveHandlers): void {
    const rest = trimmedBody.slice('type'.length).trimStart();
    const consumed = trimmedBody.length - rest.length;
    const nameMatch = rest.match(/^([A-Za-z_][A-Za-z0-9_.]*)/);
    if (!nameMatch) { h.onUnrecognized(trimmedBody); return; }
    const name = nameMatch[1];
    const nameOffset = trimmedOffset + consumed;
    let afterName = rest.slice(nameMatch[0].length);
    let arity = 0;
    if (afterName.startsWith('(')) {
        const close = findMatchingClose(afterName, 0);
        if (close >= 0) {
            arity = splitTopLevelCommas(afterName.slice(1, close)).length;
            afterName = afterName.slice(close + 1);
        }
    }
    const defMatch = afterName.match(/^\s*(--->|==)\s*([^]*)$/);
    const def = defMatch ? defMatch[2].trim() : undefined;
    h.onType(name, nameOffset, arity, def);
}

function parseClause(
    trimmedCode: string,
    absStart: number,
    rangeFor: (s: number, e: number) => Range,
): Omit<ClauseNode, 'range'> | null {
    // Split off the body after ':-' at top level, if present.
    const neckIdx = findTopLevelNeck(trimmedCode);
    const head = neckIdx >= 0 ? trimmedCode.slice(0, neckIdx) : trimmedCode.replace(/\.\s*$/, '');
    const bodyText = neckIdx >= 0 ? trimmedCode.slice(neckIdx + 2) : '';

    const headMatch = head.match(/^([A-Za-z_][A-Za-z0-9_.]*|'[^']*')/);
    if (!headMatch) return null; // not a recognizable clause head (e.g. a bare directive we didn't special-case)
    const rawName = headMatch[1];
    const name = rawName.startsWith("'") ? rawName.slice(1, -1) : rawName;
    const afterName = head.slice(headMatch[0].length);
    const { args, afterIndex } = parseArgListAt(afterName.trimStart(), 0);
    const leadWsLen = afterName.length - afterName.trimStart().length;
    void leadWsLen;
    const restAfterArgs = afterName.trimStart().slice(afterIndex);

    // function clause: Name(Args) = Result
    const isFunc = /^\s*=/.test(restAfterArgs);
    let resultVar: string | undefined;
    if (isFunc) {
        const m = restAfterArgs.match(/^\s*=\s*([A-Za-z_][A-Za-z0-9_]*)/);
        if (m) resultVar = m[1];
    }

    const headVars = args
        .map((a) => a.raw.trim())
        .filter((v) => /^[A-Z_][A-Za-z0-9_]*$/.test(v));
    if (resultVar && /^[A-Z_]/.test(resultVar)) headVars.push(resultVar);

    // Collect variable occurrences and naive call sites across head+body for
    // reference/rename and the (heuristic) call graph.
    const fullText = head + (neckIdx >= 0 ? ':-' + bodyText : '');
    const variableOccurrences: ClauseNode['variableOccurrences'] = [];
    const varRe = /\b([A-Z_][A-Za-z0-9_]*)\b/g;
    let vm: RegExpExecArray | null;
    while ((vm = varRe.exec(fullText))) {
        variableOccurrences.push({ name: vm[1], range: rangeFor(absStart + vm.index, absStart + vm.index + vm[1].length) });
    }

    const calls: ClauseNode['calls'] = [];
    if (bodyText) {
        const callRe = /\b([a-z][A-Za-z0-9_.]*)\s*\(/g;
        let cm: RegExpExecArray | null;
        const bodyAbsOffset = absStart + (head.length + 2);
        while ((cm = callRe.exec(bodyText))) {
            const callName = cm[1].includes('.') ? cm[1].slice(cm[1].lastIndexOf('.') + 1) : cm[1];
            // Compute the call's actual argument count by finding the
            // matching close paren and counting top-level commas. This lets
            // callers/references/call-graph resolution prefer an
            // arity-exact match over a same-name-any-arity one, which
            // matters since Mercury routinely overloads a name across
            // different arities (see docs/language-server.md's call-graph
            // caveat) — exact arity narrows that ambiguity whenever the
            // call site is a plain function-application syntax.
            const openParenIdx = cm.index + cm[0].length - 1;
            const closeIdx = findMatchingClose(bodyText, openParenIdx);
            let callArity: number | undefined;
            if (closeIdx > openParenIdx) {
                const inner = bodyText.slice(openParenIdx + 1, closeIdx);
                callArity = inner.trim().length === 0 ? 0 : stateVarAwareArity(splitTopLevelCommas(inner));
            }
            calls.push({
                name: callName,
                arity: callArity,
                range: rangeFor(bodyAbsOffset + cm.index, bodyAbsOffset + cm.index + cm[1].length),
            });
        }
    }

    return {
        name,
        arity: stateVarAwareArity(args.map((a) => a.raw)),
        headVars,
        variableOccurrences,
        calls,
        raw: trimmedCode,
    };
}

/** Finds the index of a top-level `:-` (the clause neck) in a clause,
 * distinct from the `:-` that begins a directive (callers only invoke this
 * on text that is not itself a directive) and distinct from any `:-`
 * nested inside parens (e.g. inside a lambda). */
/** A bare `!Name` argument (Mercury's state-variable notation, e.g. `!IO`)
 * threads a pair of ordinary arguments (the "before" and "after" states)
 * through a single syntactic token at the call site — it is not one
 * argument short of what the predicate's own declaration counts, it is
 * two, written compactly. This is a precise consequence of the language's
 * state-variable transformation (see the Mercury Language Reference
 * Manual's chapter on state variables), not a heuristic: `!IO` always
 * expands to exactly two arguments in a plain predicate call. Counting it
 * as 2 here (rather than 1, which was this project's earlier behavior —
 * see docs/architecture.md's history of that limitation) lets call-site
 * arity match a declaration's arity exactly for the very common case of
 * `!IO`-threading predicates, instead of only for calls that spell out
 * both halves by hand.
 *
 * The partial forms `!.Name` (read the "before" half only) and `!:Name`
 * (the "after" half only) are each a single ordinary term reference, not
 * a pair, and are intentionally NOT matched here — only the bare `!Name`
 * pair-reference form is.
 */
function stateVarAwareArity(argTexts: string[]): number {
    let total = 0;
    for (const raw of argTexts) {
        total += /^![A-Za-z_][A-Za-z0-9_]*$/.test(raw.trim()) ? 2 : 1;
    }
    return total;
}

function findTopLevelNeck(text: string): number {
    let depth = 0;
    let inString = false;
    let inAtom = false;
    for (let i = 0; i < text.length - 1; i++) {
        const ch = text[i];
        if (inString) { if (ch === '\\') { i++; continue; } if (ch === '"') inString = false; continue; }
        if (inAtom) { if (ch === '\\') { i++; continue; } if (ch === "'") inAtom = false; continue; }
        if (ch === '"') { inString = true; continue; }
        if (ch === "'") { inAtom = true; continue; }
        if (ch === '(' || ch === '[' || ch === '{') { depth++; continue; }
        if (ch === ')' || ch === ']' || ch === '}') { depth--; continue; }
        if (depth === 0 && ch === ':' && text[i + 1] === '-') return i;
    }
    return -1;
}

export { splitTopLevelOn };
