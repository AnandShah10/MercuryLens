import { ArgMode, SymbolNode } from '../parser/ast';

/**
 * Mode/instantiation-state descriptions, using only well-defined Mercury
 * semantics (see the Mercury Language Reference Manual's chapter on modes).
 * Anything outside the standard built-in modes is described as a
 * "compound/user-defined mode" rather than guessed at. Mirrored (for the
 * webview side) by extension/src/views/infoPanels.ts — the two are kept as
 * separate small copies rather than a shared import, since the server and
 * extension are independent compilation units communicating only over LSP
 * (see docs/architecture.md).
 */
export function describeInstantiation(mode?: string): string {
    switch (mode) {
        case 'in': return 'ground (must already be bound on entry)';
        case 'out': return 'free \u2192 ground (unbound on entry, bound on success)';
        case 'di': return 'unique \u2192 clobbered (destructively updated; e.g. an I/O state)';
        case 'uo': return 'free \u2192 unique (freshly produced unique value; e.g. an I/O state)';
        case 'mdi': return 'mostly-unique \u2192 clobbered';
        case 'muo': return 'free \u2192 mostly-unique';
        case 'unused': return 'not used by this mode of the predicate';
        default: return mode ? `(compound/user-defined mode: ${mode})` : '(mode not specified in this declaration)';
    }
}

export interface ModeArgumentSummary {
    index: number;
    type?: string;
    mode?: string;
    instantiation: string;
}

/** Builds a per-argument mode/instantiation summary for a predicate or
 * function's declared argument list, for hover and the Mode Information
 * panel. */
export function summarizeModes(args: ArgMode[]): ModeArgumentSummary[] {
    return args.map((a, i) => ({ index: i + 1, type: a.type, mode: a.mode, instantiation: describeInstantiation(a.mode) }));
}

/** Renders the "Modes:" markdown block used in hover, or an empty string
 * when the symbol has no arguments (nothing to show). */
export function formatModeSection(sym: SymbolNode): string {
    if (!sym.args?.length) return '';
    const lines = summarizeModes(sym.args).map(
        (a) => `- Argument ${a.index}: mode \`${a.mode ?? '(unspecified)'}\`, type \`${a.type ?? '(unspecified)'}\``,
    );
    return ['**Modes:**', ...lines].join('\n');
}
