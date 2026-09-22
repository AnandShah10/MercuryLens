% errors_type.m
% PURPOSE: a deliberate TYPE error, for testing diagnostics.
% Without mmc: the syntactic fallback won't catch this (it's a semantic
% error) — you should see NO diagnostic here without a compiler configured.
% With mmc: you should see a real compiler error on the Y = X + "..." line,
% and "Mercury: Explain Diagnostic" should recognize it as a type error.
:- module errors_type.

:- interface.

:- pred combine(int::in, int::out) is det.

:- implementation.

combine(X, Y) :-
    Y = X + "not a number".
