% inlinable.m - a fixture for manually exercising "Mercury: Inline
% Predicate": double_plus_one/2 has exactly one clause, is declared det,
% and has only in/out arguments with plain-variable head parameters, so
% it falls inside Inline Predicate's safe subset (see
% extension/src/utils/inlinePredicateHeuristics.ts). Placing the cursor on
% the `double_plus_one(N, Result)` call below and running "Mercury: Inline
% Predicate" should replace it with a parenthesized conjunction computing
% the same result directly, with local variables (Doubled) alpha-renamed
% to avoid colliding with anything already in scope at the call site.
:- module inlinable.

:- interface.

:- import_module io.

:- pred double_plus_one(int::in, int::out) is det.
:- pred main(io::di, io::uo) is det.

:- implementation.

:- import_module int.

double_plus_one(N, Result) :-
    Doubled = N * 2,
    Result = Doubled + 1.

main(!IO) :-
    double_plus_one(5, Result),
    io.print(Result, !IO),
    io.nl(!IO).
