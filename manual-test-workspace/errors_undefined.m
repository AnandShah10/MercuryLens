% errors_undefined.m
% PURPOSE: an unresolved import AND a call to an undefined predicate.
% Without mmc: the SYNTACTIC fallback should flag the unresolved
% 'totally_missing_module' import (info-level) — try it with no compiler
% configured first.
% With mmc: you should additionally get a real "undefined predicate" error
% on the nonexistent_predicate call.
:- module errors_undefined.

:- interface.

:- import_module totally_missing_module.

:- pred broken(int::in, int::out) is det.

:- implementation.

broken(X, Y) :-
    Y = nonexistent_predicate(X).
