import { Determinism } from '../parser/ast';

/**
 * Human-readable descriptions of Mercury's determinism categories (see the
 * Mercury Language Reference Manual's chapter on determinism). Used to
 * enrich hover text beyond just naming the category. Mirrored by
 * extension/src/views/infoPanels.ts's `DET_DOCS` for the webview side — see
 * the note in modes/modeInfo.ts about why these are separate small copies
 * rather than a shared import.
 */
export const DETERMINISM_DESCRIPTIONS: Record<Determinism, string> = {
    det: 'Succeeds exactly once. Never fails, never produces multiple solutions.',
    semidet: 'Succeeds at most once. May fail.',
    multi: 'Succeeds one or more times. Never fails.',
    nondet: 'Succeeds zero or more times. May fail.',
    failure: 'Never succeeds.',
    erroneous: 'Never returns (always throws/aborts).',
    cc_multi: '"Committed-choice" multi: logically may have multiple solutions, but only the first is committed to.',
    cc_nondet: '"Committed-choice" nondet: logically may have multiple solutions and may fail, but only the first solution found is committed to.',
};

export function describeDeterminism(det?: Determinism): string {
    if (!det) return 'No determinism was declared (or found) for this predicate/function in the indexed source.';
    return DETERMINISM_DESCRIPTIONS[det];
}
