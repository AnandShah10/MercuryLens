/**
 * A line/token-oriented lexer for Mercury source.
 *
 * This is intentionally NOT a full Mercury grammar implementation. Mercury's
 * real grammar (operator precedence table, DCG translation, full term syntax)
 * lives in the Mercury compiler itself. Re-implementing it fully in
 * TypeScript would be a large, fragile undertaking that duplicates the
 * compiler and would inevitably drift from real Mercury semantics.
 *
 * Instead this lexer produces a flat token stream good enough to support:
 *   - stripping comments/strings safely (so downstream regex-based analysis
 *     does not get confused by "%.*" inside a string literal, etc.)
 *   - locating clause/declaration boundaries (terms ended by ". " at the
 *     "top level", i.e. not inside parens/brackets/braces/strings)
 *   - word-level tokens with accurate source ranges, for hover/definition/
 *     rename/references.
 *
 * Anything requiring real operator precedence parsing (e.g. fully resolving
 * `A + B * C` into a term tree) is explicitly out of scope for this lexer;
 * the analyzer works at the declaration/clause-head granularity instead,
 * which is sufficient for the navigation and Mercury-aware features this
 * extension implements without inventing compiler semantics.
 */

export type TokenKind =
    | 'atom'
    | 'variable'
    | 'string'
    | 'char'
    | 'number'
    | 'punct'
    | 'whitespace'
    | 'comment'
    | 'eof';

export interface Token {
    kind: TokenKind;
    text: string;
    /** 0-based line */
    line: number;
    /** 0-based column, start of token */
    startCol: number;
    endCol: number;
}

const PUNCT_MULTI = [':-', '-->', '\\+', '=..', '\\==', '==', '=<', '>=', '\\=', '->', '=>', '<=', '//', '<<', '>>', '/\\', '\\/'];

export class MercuryLexer {
    private readonly lines: string[];

    constructor(source: string) {
        this.lines = source.split(/\r\n|\r|\n/);
    }

    tokenize(): Token[] {
        const tokens: Token[] = [];
        for (let lineNo = 0; lineNo < this.lines.length; lineNo++) {
            const line = this.lines[lineNo];
            let col = 0;
            while (col < line.length) {
                const ch = line[col];

                if (ch === ' ' || ch === '\t') {
                    col++;
                    continue;
                }

                if (ch === '%') {
                    tokens.push({ kind: 'comment', text: line.slice(col), line: lineNo, startCol: col, endCol: line.length });
                    col = line.length;
                    continue;
                }

                if (ch === '"') {
                    const start = col;
                    col++;
                    while (col < line.length && line[col] !== '"') {
                        if (line[col] === '\\') col++;
                        col++;
                    }
                    col++; // closing quote (may run past EOL on malformed input; tolerated)
                    tokens.push({ kind: 'string', text: line.slice(start, Math.min(col, line.length)), line: lineNo, startCol: start, endCol: Math.min(col, line.length) });
                    continue;
                }

                // 0'c character literal
                if (ch === '0' && line[col + 1] === "'") {
                    const start = col;
                    col += 2;
                    if (line[col] === '\\') col++;
                    col++;
                    tokens.push({ kind: 'char', text: line.slice(start, col), line: lineNo, startCol: start, endCol: col });
                    continue;
                }

                if (ch === "'") {
                    const start = col;
                    col++;
                    while (col < line.length && line[col] !== "'") {
                        if (line[col] === '\\') col++;
                        col++;
                    }
                    col++;
                    tokens.push({ kind: 'atom', text: line.slice(start, Math.min(col, line.length)), line: lineNo, startCol: start, endCol: Math.min(col, line.length) });
                    continue;
                }

                if (/[0-9]/.test(ch)) {
                    const start = col;
                    while (col < line.length && /[0-9a-fA-FxXoObB.]/.test(line[col])) {
                        // allow hex/oct/bin prefixes and float dots, but stop a
                        // trailing '.' that is actually end-of-clause (". " or ".$")
                        if (line[col] === '.' && (col + 1 >= line.length || !/[0-9]/.test(line[col + 1]))) break;
                        col++;
                    }
                    tokens.push({ kind: 'number', text: line.slice(start, col), line: lineNo, startCol: start, endCol: col });
                    continue;
                }

                if (/[A-Za-z_]/.test(ch)) {
                    const start = col;
                    while (col < line.length && /[A-Za-z0-9_]/.test(line[col])) col++;
                    const text = line.slice(start, col);
                    const kind: TokenKind = /^[A-Z_]/.test(text) ? 'variable' : 'atom';
                    tokens.push({ kind, text, line: lineNo, startCol: start, endCol: col });
                    continue;
                }

                // multi-char punctuation
                const rest3 = line.slice(col, col + 3);
                const rest2 = line.slice(col, col + 2);
                const multi = PUNCT_MULTI.find((p) => p === rest3) ?? PUNCT_MULTI.find((p) => p === rest2);
                if (multi) {
                    tokens.push({ kind: 'punct', text: multi, line: lineNo, startCol: col, endCol: col + multi.length });
                    col += multi.length;
                    continue;
                }

                tokens.push({ kind: 'punct', text: ch, line: lineNo, startCol: col, endCol: col + 1 });
                col++;
            }
        }
        tokens.push({ kind: 'eof', text: '', line: this.lines.length, startCol: 0, endCol: 0 });
        return tokens;
    }
}

/** Splits source into top-level "terms" ended by a clause-terminating '.'
 * (a '.' followed by whitespace/EOL/comment, at paren-depth 0, outside
 * strings/comments). This mirrors how Mercury source is organized into
 * declarations and clauses without attempting full term parsing. */
export interface TopLevelTerm {
    text: string;
    startLine: number;
    endLine: number;
    startOffset: number;
    endOffset: number;
}

export function splitTopLevelTerms(source: string): TopLevelTerm[] {
    const terms: TopLevelTerm[] = [];
    let depth = 0;
    let inString = false;
    let inLineComment = false;
    let inBlockComment = false;
    let inQuotedAtom = false;
    let termStart = 0;

    const lineStartOffsets: number[] = [0];
    for (let i = 0; i < source.length; i++) {
        if (source[i] === '\n') lineStartOffsets.push(i + 1);
    }
    const lineOf = (offset: number): number => {
        let lo = 0, hi = lineStartOffsets.length - 1;
        while (lo < hi) {
            const mid = (lo + hi + 1) >> 1;
            if (lineStartOffsets[mid] <= offset) lo = mid; else hi = mid - 1;
        }
        return lo;
    };

    for (let i = 0; i < source.length; i++) {
        const ch = source[i];
        const next = source[i + 1];

        if (inLineComment) {
            if (ch === '\n') inLineComment = false;
            continue;
        }
        if (inBlockComment) {
            if (ch === '*' && next === '/') { inBlockComment = false; i++; }
            continue;
        }
        if (inString) {
            if (ch === '\\') { i++; continue; }
            if (ch === '"') inString = false;
            continue;
        }
        if (inQuotedAtom) {
            if (ch === '\\') { i++; continue; }
            if (ch === "'") inQuotedAtom = false;
            continue;
        }
        if (ch === '%') { inLineComment = true; continue; }
        if (ch === '/' && next === '*') { inBlockComment = true; i++; continue; }
        if (ch === '"') { inString = true; continue; }
        if (ch === "'") { inQuotedAtom = true; continue; }
        if (ch === '(' || ch === '[' || ch === '{') { depth++; continue; }
        if (ch === ')' || ch === ']' || ch === '}') { depth = Math.max(0, depth - 1); continue; }

        if (ch === '.' && depth === 0) {
            const isTerminator = next === undefined || next === '\n' || next === '\r' || next === ' ' || next === '\t' || next === '%';
            if (isTerminator) {
                const text = source.slice(termStart, i + 1);
                if (text.trim().length > 0) {
                    terms.push({
                        text,
                        startLine: lineOf(termStart),
                        endLine: lineOf(i),
                        startOffset: termStart,
                        endOffset: i + 1,
                    });
                }
                termStart = i + 1;
            }
        }
    }
    // trailing partial term (unterminated - still surfaced so the analyzer
    // can report it, e.g. while the user is mid-edit)
    const tail = source.slice(termStart);
    if (tail.trim().length > 0) {
        terms.push({
            text: tail,
            startLine: lineOf(termStart),
            endLine: lineOf(source.length - 1),
            startOffset: termStart,
            endOffset: source.length,
        });
    }
    return terms;
}
