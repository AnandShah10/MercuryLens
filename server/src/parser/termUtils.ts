/** Small utilities for working with Mercury term text without full parsing. */

/** Given a string and the index of an opening '(', '[' or '{', returns the
 * index of its matching close bracket, respecting nested brackets, strings,
 * and quoted atoms. Returns -1 if unmatched. */
export function findMatchingClose(text: string, openIndex: number): number {
    const open = text[openIndex];
    const close = open === '(' ? ')' : open === '[' ? ']' : '}';
    let depth = 0;
    let inString = false;
    let inAtom = false;
    for (let i = openIndex; i < text.length; i++) {
        const ch = text[i];
        if (inString) {
            if (ch === '\\') { i++; continue; }
            if (ch === '"') inString = false;
            continue;
        }
        if (inAtom) {
            if (ch === '\\') { i++; continue; }
            if (ch === "'") inAtom = false;
            continue;
        }
        if (ch === '"') { inString = true; continue; }
        if (ch === "'") { inAtom = true; continue; }
        if (ch === open) depth++;
        else if (ch === close) {
            depth--;
            if (depth === 0) return i;
        }
    }
    return -1;
}

/** Splits a comma-separated argument list, respecting nested brackets so
 * `list(int), pred(in, out) is det` splits into two arguments, not four. */
export function splitTopLevelCommas(text: string): string[] {
    const parts: string[] = [];
    let depth = 0;
    let inString = false;
    let inAtom = false;
    let start = 0;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (inString) {
            if (ch === '\\') { i++; continue; }
            if (ch === '"') inString = false;
            continue;
        }
        if (inAtom) {
            if (ch === '\\') { i++; continue; }
            if (ch === "'") inAtom = false;
            continue;
        }
        if (ch === '"') { inString = true; continue; }
        if (ch === "'") { inAtom = true; continue; }
        if (ch === '(' || ch === '[' || ch === '{') depth++;
        else if (ch === ')' || ch === ']' || ch === '}') depth--;
        else if (ch === ',' && depth === 0) {
            parts.push(text.slice(start, i));
            start = i + 1;
        }
    }
    parts.push(text.slice(start));
    return parts.map((p) => p.trim()).filter((p) => p.length > 0);
}

/** Splits on a top-level `;` (disjunction) the same way, used for type
 * definitions (`--->` constructor lists). */
export function splitTopLevelOn(text: string, sep: string): string[] {
    const parts: string[] = [];
    let depth = 0;
    let inString = false;
    let inAtom = false;
    let start = 0;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (inString) {
            if (ch === '\\') { i++; continue; }
            if (ch === '"') inString = false;
            continue;
        }
        if (inAtom) {
            if (ch === '\\') { i++; continue; }
            if (ch === "'") inAtom = false;
            continue;
        }
        if (ch === '"') { inString = true; continue; }
        if (ch === "'") { inAtom = true; continue; }
        if (ch === '(' || ch === '[' || ch === '{') depth++;
        else if (ch === ')' || ch === ']' || ch === '}') depth--;
        else if (depth === 0 && text.startsWith(sep, i)) {
            parts.push(text.slice(start, i));
            start = i + sep.length;
            i += sep.length - 1;
        }
    }
    parts.push(text.slice(start));
    return parts.map((p) => p.trim()).filter((p) => p.length > 0);
}

/** Parses a single arg spec like "Type::Mode", "Type", or just "Mode" into
 * best-effort { type, mode }. Mercury allows either form depending on
 * whether the arg appears in a `:- pred` (type[::mode]) or `:- mode` decl
 * (mode only). */
export function parseArgSpec(spec: string): { type?: string; mode?: string } {
    const idx = spec.indexOf('::');
    if (idx >= 0) {
        return { type: spec.slice(0, idx).trim() || undefined, mode: spec.slice(idx + 2).trim() || undefined };
    }
    return { type: spec.trim() || undefined };
}

/** Computes a line/col Range for a substring at `offset` within `text`,
 * given the (line, col) of the start of `text` in the source document. */
export function offsetToRange(
    text: string,
    startOffsetInText: number,
    endOffsetInText: number,
    textStartLine: number,
    textStartCol: number,
): { startLine: number; startCol: number; endLine: number; endCol: number } {
    let line = textStartLine;
    let col = textStartCol;
    let i = 0;
    let startLine = line, startCol = col, endLine = line, endCol = col;
    while (i < endOffsetInText) {
        if (i === startOffsetInText) { startLine = line; startCol = col; }
        if (text[i] === '\n') { line++; col = 0; } else { col++; }
        i++;
    }
    endLine = line;
    endCol = col;
    if (startOffsetInText === endOffsetInText) { startLine = endLine; startCol = endCol; }
    if (startOffsetInText === 0) { startLine = textStartLine; startCol = textStartCol; }
    return { startLine, startCol, endLine, endCol };
}
