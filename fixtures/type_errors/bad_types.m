% bad_types.m - intentionally contains a type error for diagnostics tests.
:- module bad_types.

:- interface.

:- pred combine(int::in, int::out) is det.

:- implementation.

combine(X, Y) :-
    Y = X + "not a number".
