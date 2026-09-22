import * as vscode from 'vscode';
import { LanguageClient } from 'vscode-languageclient/node';
import { WireModuleDoc } from '../utils/wireTypes';
import { planInline, renderInlinePlan, splitTopLevelConjuncts, CalleeInfo } from '../utils/inlinePredicateHeuristics';
import { verifyEditWithCompiler } from '../utils/verifyEdit';

interface WireClauseFull {
    name: string;
    arity: number;
    headVars: string[];
    range: { startLine: number; startCol: number; endLine: number; endCol: number };
    raw: string;
}

function findEnclosingClause(doc: WireModuleDoc, line: number): WireClauseFull | undefined {
    return (doc.clauses as unknown as WireClauseFull[]).find((c) => c.range.startLine <= line && line <= c.range.endLine);
}

/** Splits a clause's raw text into head and body (the part after the
 * top-level `:-`, if any), mirroring the split the server's own parser
 * does — kept local since it's a small, self-contained piece of text
 * scanning rather than something worth cross-project-importing. */
function splitHeadAndBody(clauseRaw: string): { head: string; body: string | undefined } {
    let depth = 0;
    let inString = false;
    let inAtom = false;
    const trimmed = clauseRaw.replace(/\.\s*$/, '');
    for (let i = 0; i < trimmed.length - 1; i++) {
        const ch = trimmed[i];
        if (inString) { if (ch === '\\') { i++; continue; } if (ch === '"') inString = false; continue; }
        if (inAtom) { if (ch === '\\') { i++; continue; } if (ch === "'") inAtom = false; continue; }
        if (ch === '"') { inString = true; continue; }
        if (ch === "'") { inAtom = true; continue; }
        if (ch === '(' || ch === '[' || ch === '{') depth++;
        else if (ch === ')' || ch === ']' || ch === '}') depth--;
        else if (depth === 0 && ch === ':' && trimmed[i + 1] === '-') {
            return { head: trimmed.slice(0, i), body: trimmed.slice(i + 2) };
        }
    }
    return { head: trimmed, body: undefined };
}

function findMatchingCloseLocal(text: string, openIndex: number): number {
    let depth = 0;
    let inString = false;
    let inAtom = false;
    for (let i = openIndex; i < text.length; i++) {
        const ch = text[i];
        if (inString) { if (ch === '\\') { i++; continue; } if (ch === '"') inString = false; continue; }
        if (inAtom) { if (ch === '\\') { i++; continue; } if (ch === "'") inAtom = false; continue; }
        if (ch === '"') { inString = true; continue; }
        if (ch === "'") { inAtom = true; continue; }
        if (ch === '(') depth++;
        else if (ch === ')') { depth--; if (depth === 0) return i; }
    }
    return -1;
}

function splitArgsLocal(s: string): string[] {
    const parts: string[] = [];
    let depth = 0, start = 0;
    let inString = false, inAtom = false;
    for (let i = 0; i < s.length; i++) {
        const ch = s[i];
        if (inString) { if (ch === '\\') { i++; continue; } if (ch === '"') inString = false; continue; }
        if (inAtom) { if (ch === '\\') { i++; continue; } if (ch === "'") inAtom = false; continue; }
        if (ch === '"') { inString = true; continue; }
        if (ch === "'") { inAtom = true; continue; }
        if (ch === '(' || ch === '[' || ch === '{') depth++;
        else if (ch === ')' || ch === ']' || ch === '}') depth--;
        else if (ch === ',' && depth === 0) { parts.push(s.slice(start, i)); start = i + 1; }
    }
    const last = s.slice(start).trim();
    if (last) parts.push(last);
    return parts.map((p) => p.trim());
}

/** Extracts the raw, unfiltered argument list from a clause head like
 * `foo(X, Y * 2)`, given its expected name. Returns `undefined` if the
 * head doesn't look like `name(...)` at all (e.g. a zero-arity fact
 * `foo.` with no parens — arity 0, an empty array — is handled directly by
 * `splitArgsLocal` returning `[]` for an empty argument list once parens
 * are found; a head with no parens at all is the true undefined case). */
function extractHeadArgs(head: string, expectedName: string): string[] | undefined {
    const trimmed = head.trim();
    const nameMatch = trimmed.match(/^([A-Za-z_][A-Za-z0-9_.]*|'[^']*')/);
    if (!nameMatch) return undefined;
    const bareName = nameMatch[1].includes('.') ? nameMatch[1].slice(nameMatch[1].lastIndexOf('.') + 1) : nameMatch[1];
    if (bareName.replace(/^'|'$/g, '') !== expectedName) return undefined;
    const rest = trimmed.slice(nameMatch[0].length).trimStart();
    if (!rest.startsWith('(')) return [];
    const close = findMatchingCloseLocal(rest, 0);
    if (close < 0) return undefined;
    return splitArgsLocal(rest.slice(1, close));
}

export function makeInlinePredicateCommand(getClient: () => LanguageClient | undefined) {
    return async function inlinePredicate(): Promise<void> {
        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.document.languageId !== 'mercury') return;
        const client = getClient();
        if (!client) return;

        // Locate the call: word under cursor, then its full "(args)" span.
        const position = editor.selection.active;
        const wordRange = editor.document.getWordRangeAtPosition(position, /[A-Za-z_][A-Za-z0-9_.]*/);
        if (!wordRange) { vscode.window.showErrorMessage('Place the cursor on a predicate call to inline it.'); return; }
        const rawName = editor.document.getText(wordRange);
        const name = rawName.includes('.') ? rawName.slice(rawName.lastIndexOf('.') + 1) : rawName;

        const lineText = editor.document.lineAt(position.line).text;
        const afterNameCol = wordRange.end.character;
        if (lineText[afterNameCol] !== '(') { vscode.window.showErrorMessage(`'${name}' is not a predicate call here (no '(' immediately follows).`); return; }
        const closeRelative = findMatchingCloseLocal(lineText, afterNameCol);
        if (closeRelative < 0) { vscode.window.showErrorMessage('Could not find the matching close paren for this call.'); return; }
        const callStart = new vscode.Position(position.line, wordRange.start.character);
        const callEnd = new vscode.Position(position.line, closeRelative + 1);
        const callArgsText = lineText.slice(afterNameCol + 1, closeRelative);
        const callArgs = splitArgsLocal(callArgsText);
        const arity = callArgs.length;

        const doc = await client.sendRequest<WireModuleDoc | null>('mercury/moduleDoc', { uri: editor.document.uri.toString() });
        if (!doc) { vscode.window.showInformationMessage('This file has not been indexed yet.'); return; }
        const enclosingClause = findEnclosingClause(doc, position.line);
        if (!enclosingClause) { vscode.window.showErrorMessage('Could not determine the enclosing clause for this call.'); return; }

        // The call must be a complete, standalone top-level goal in the
        // caller's clause body — not a function-style call nested inside a
        // larger expression (see inlinePredicateHeuristics.ts's module doc
        // for why that case is out of scope).
        const { body: callerBody } = splitHeadAndBody(enclosingClause.raw);
        if (callerBody === undefined) { vscode.window.showErrorMessage('The enclosing clause has no body to inline into (it is a fact).'); return; }

        const conjuncts = splitTopLevelConjuncts(callerBody);
        const callText = editor.document.getText(new vscode.Range(callStart, callEnd)).trim();
        // The call must be, once trimmed, exactly equal to one whole
        // top-level conjunct of the clause body — nothing else around it.
        // That's what distinguishes "foo(X, Result)," as its own goal from
        // a nested use like "Y = 1 + foo(X)", which this refactoring
        // deliberately does not support (see the module doc above).
        const exactConjunct = conjuncts.find((c) => callerBody.slice(c.start, c.end).trim() === callText);
        if (!exactConjunct) {
            vscode.window.showErrorMessage(
                `Mercury: Inline Predicate only supports a call that is a complete, standalone goal in the clause body (e.g. '${name}(...),' on its own), not one nested inside a larger expression. Place the cursor on such a call and try again.`,
            );
            return;
        }

        // Cross-workspace: exactly one clause, and its own declared modes/determinism.
        const clausesResp = await client.sendRequest<{ uri: string; clause: { name: string; arity: number; headVars: string[]; raw: string } }[]>('mercury/findClauses', { name, arity });
        if (clausesResp.length !== 1) {
            vscode.window.showErrorMessage(
                clausesResp.length === 0
                    ? `Mercury: no clause found for '${name}/${arity}' to inline.`
                    : `Mercury: '${name}/${arity}' has ${clausesResp.length} clauses. Only a predicate/function with exactly one clause can be safely inlined (see docs/development.md).`,
            );
            return;
        }
        const declResp = await client.sendRequest<{ symbol: { arity?: number; determinism?: string; args?: { mode?: string }[] } } | null>('mercury/findDeclaration', { name, kinds: ['predicate', 'function'] });
        if (!declResp) { vscode.window.showErrorMessage(`Mercury: no ':- pred'/':- func' declaration found for '${name}/${arity}'.`); return; }

        const { body: calleeBody, head: calleeHead } = splitHeadAndBody(clausesResp[0].clause.raw);
        // Derive the callee's formal parameters directly from its raw head
        // text rather than trusting `clause.headVars` (the server's parser
        // deliberately only populates `headVars` with bare-variable head
        // arguments, e.g. for reference/rename purposes — a clause head
        // can just as validly pattern-match a literal or compound term in
        // an argument position, like `double(X, X * 2).` or `is_zero(0).`,
        // which would otherwise silently under-count arity here and
        // produce a confusing "argument count mismatch" refusal instead of
        // an accurate one).
        const calleeHeadArgsRaw = extractHeadArgs(calleeHead, name);
        if (calleeHeadArgsRaw === undefined) {
            vscode.window.showErrorMessage(`Mercury: could not parse the argument list of '${name}/${arity}"'s clause head.`);
            return;
        }
        const nonVariableArgIndex = calleeHeadArgsRaw.findIndex((a) => !/^[A-Z_][A-Za-z0-9_]*$/.test(a));
        if (nonVariableArgIndex >= 0) {
            vscode.window.showErrorMessage(
                `Mercury: cannot inline '${name}/${arity}' — argument ${nonVariableArgIndex + 1} of its clause head is a pattern (\`${calleeHeadArgsRaw[nonVariableArgIndex]}\`), not a plain variable. This refactoring only supports predicates/functions whose single clause binds each argument via a plain variable in the head (with any pattern matching done in the body instead).`,
            );
            return;
        }
        const callee: CalleeInfo = {
            headVars: calleeHeadArgsRaw,
            argModes: (declResp.symbol.args ?? []).map((a) => a.mode),
            determinism: declResp.symbol.determinism,
            body: calleeBody,
        };

        const existingCallerVars = new Set<string>();
        for (const m of callerBody.matchAll(/\b[A-Z_][A-Za-z0-9_]*\b/g)) existingCallerVars.add(m[0]);

        const result = planInline(callee, callArgs, existingCallerVars);
        if (result.kind === 'refusal') {
            vscode.window.showErrorMessage(`Mercury: cannot inline '${name}/${arity}' — ${result.reason}`);
            return;
        }

        const replacement = renderInlinePlan(result);
        const confirmChoice = await vscode.window.showWarningMessage(
            `Inline '${name}/${arity}' at this call site? The callee has exactly one clause and is declared 'det' with only in/out arguments, so this should be safe, but the substitution is still a heuristic text transformation — MercuryLens will automatically run 'mmc --errorcheck-only' afterward (when available) and offer to undo if it doesn't compile.`,
            { modal: true },
            'Inline',
        );
        if (confirmChoice !== 'Inline') return;

        const edit = new vscode.WorkspaceEdit();
        edit.replace(editor.document.uri, new vscode.Range(callStart, callEnd), replacement);
        const applied = await vscode.workspace.applyEdit(edit);
        if (!applied) return;
        await editor.document.save();

        await verifyEditWithCompiler(editor, `inlined '${name}/${arity}'`);
    };
}
