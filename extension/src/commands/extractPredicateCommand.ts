import * as vscode from 'vscode';
import { LanguageClient } from 'vscode-languageclient/node';
import { WireModuleDoc } from '../utils/wireTypes';
import { findBracketImbalance, computeExtractedArgs } from '../utils/extractPredicateHeuristics';
import { verifyEditWithCompiler } from '../utils/verifyEdit';

/**
 * Extract Predicate.
 *
 * Mercury's automatic type/determinism inference for local (non-exported)
 * predicates (see the Mercury Language Reference Manual, "Modules", and the
 * Mercury FAQ on determinism inference) means the generated predicate does
 * NOT need a `:- pred`/`:- func` type declaration, and does NOT need an
 * explicit determinism — both are inferred by the compiler for
 * implementation-section predicates. What Mercury does need, by default, is
 * mode information (mode inference is opt-in via `--infer-modes` and even
 * then is limited), so this refactoring writes modes directly on the new
 * clause's head using the `Var::mode` syntax the language supports for
 * exactly this situation (a predicate defined without a preceding `:- pred`
 * declaration).
 *
 * Argument modes are derived two ways, in order of trust:
 *   1. For a variable that is one of the ENCLOSING predicate's own head
 *      arguments, the enclosing predicate's own declared mode for that
 *      argument position is reused directly (ground truth, not a guess).
 *   2. For any other shared variable (local to the clause), a textual
 *      first-occurrence heuristic is used: if the variable's first mention
 *      anywhere in the clause falls inside the selected text, it is treated
 *      as produced by the extracted goal (`out`); otherwise it is treated as
 *      already bound before the extracted goal runs (`in`).
 *
 * Heuristic (2) assumes a left-to-right, top-to-bottom reading of the
 * clause body approximates its actual data flow, which holds for ordinary
 * conjunctions but can be wrong across an if-then-else's branches or other
 * non-linear control flow. This is why the command shows an explicit
 * confirmation dialog naming this as a heuristic and always recommends
 * running "Mercury: Check Project" afterward — this extension does not
 * claim the generated modes are compiler-verified.
 */

interface ClauseInfo {
    name: string;
    arity: number;
    headVars: string[];
    range: { startLine: number; startCol: number; endLine: number; endCol: number };
}

export function makeExtractPredicateCommand(getClient: () => LanguageClient | undefined) {
    return async function extractPredicate(): Promise<void> {
        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.document.languageId !== 'mercury') return;
        if (editor.selection.isEmpty) {
            vscode.window.showErrorMessage('Select the goal(s) to extract into a new predicate first.');
            return;
        }
        const client = getClient();
        if (!client) return;

        const doc = await client.sendRequest<WireModuleDoc | null>('mercury/moduleDoc', { uri: editor.document.uri.toString() });
        if (!doc) { vscode.window.showInformationMessage('This file has not been indexed yet.'); return; }

        const selStartLine = editor.selection.start.line;
        const selEndLine = editor.selection.end.line;
        const clause = (doc.clauses as unknown as ClauseInfo[]).find(
            (c) => c.range.startLine <= selStartLine && selEndLine <= c.range.endLine,
        );
        if (!clause) {
            vscode.window.showErrorMessage('The selection must fall entirely within a single clause body.');
            return;
        }

        const clauseStartPos = new vscode.Position(clause.range.startLine, clause.range.startCol);
        const clauseEndPos = new vscode.Position(clause.range.endLine, clause.range.endCol);
        const clauseText = editor.document.getText(new vscode.Range(clauseStartPos, clauseEndPos));
        const clauseStartOffset = editor.document.offsetAt(clauseStartPos);
        const relStart = editor.document.offsetAt(editor.selection.start) - clauseStartOffset;
        const relEnd = editor.document.offsetAt(editor.selection.end) - clauseStartOffset;

        if (relStart < 0 || relEnd > clauseText.length || relStart >= relEnd) {
            vscode.window.showErrorMessage('The selection must fall entirely within a single clause body.');
            return;
        }

        const selectedText = clauseText.slice(relStart, relEnd);
        const trimmedSelection = selectedText.trim();
        if (!trimmedSelection) return;

        if (findBracketImbalance(selectedText) !== 0) {
            vscode.window.showErrorMessage("Mercury: the selection has unbalanced brackets — select one or more complete goals (e.g. a full comma-separated conjunction), not a partial expression.");
            return;
        }
        if (/^[,;]|[,;]$/.test(trimmedSelection.trim())) {
            vscode.window.showErrorMessage('Mercury: trim leading/trailing commas or semicolons from the selection so it is a self-contained sequence of goals.');
            return;
        }

        // Ground truth for the enclosing predicate's own head arguments.
        const declSym = doc.symbols.find((s) => (s.kind === 'predicate' || s.kind === 'function') && s.name === clause.name && (s.arity === undefined || s.arity === clause.arity));
        const declaredModeFor = new Map<string, string>();
        if (declSym?.args) {
            clause.headVars.forEach((v, i) => {
                const mode = declSym.args?.[i]?.mode;
                if (mode) declaredModeFor.set(v, mode);
            });
        }

        const args = computeExtractedArgs(clauseText, relStart, relEnd, trimmedSelection, declaredModeFor);

        const name = await vscode.window.showInputBox({
            prompt: 'Name for the extracted predicate (Mercury identifier, lowercase start)',
            value: 'extracted_goal',
            validateInput: (v) => (/^[a-z][A-Za-z0-9_]*$/.test(v) ? null : 'Must start with a lowercase letter and contain only letters, digits, and underscores.'),
        });
        if (!name) return;

        const argList = args.map((a) => `${a.name}::${a.mode}`).join(', ');
        const callArgList = args.map((a) => a.name).join(', ');
        const newHead = args.length ? `${name}(${argList})` : name;
        const callText = args.length ? `${name}(${callArgList})` : name;
        const bodyText = trimmedSelection.replace(/\.\s*$/, '');
        const newClauseText = `\n\n${newHead} :-\n    ${bodyText.split('\n').map((l) => l.trim()).join('\n    ')}.\n`;

        const heuristicArgs = args.filter((a) => a.source === 'heuristic');
        const warningLines = [
            `Extract the selected goal(s) into a new predicate '${name}/${args.length}'?`,
            '',
            args.length > 0
                ? `Arguments (in call order): ${args.map((a) => `${a.name} (${a.mode}${a.source === 'declared' ? ', from the enclosing predicate\'s own declaration' : ', heuristically inferred'})`).join(', ')}.`
                : 'No shared variables were found; the extracted predicate takes no arguments.',
            heuristicArgs.length > 0
                ? `\n${heuristicArgs.length} mode(s) were inferred heuristically from textual order, not verified by the compiler.`
                : '',
            '\nNo :- pred/:- func declaration is generated — Mercury infers the type and determinism of local predicates automatically; modes are given directly on the new clause head.',
            "\nRun 'Mercury: Check Project' after applying to confirm this compiles as expected.",
        ].filter(Boolean).join('\n');

        const choice = await vscode.window.showWarningMessage(warningLines, { modal: true }, 'Extract');
        if (choice !== 'Extract') return;

        const edit = new vscode.WorkspaceEdit();
        edit.replace(editor.document.uri, editor.selection, callText);
        edit.insert(editor.document.uri, clauseEndPos, newClauseText);
        const applied = await vscode.workspace.applyEdit(edit);
        if (!applied) return;
        await editor.document.save();

        await verifyEditWithCompiler(editor, `extracted '${name}/${args.length}'`);
    };
}
