% bad_modes.m - intentionally contains a mode/instantiation error.
:- module bad_modes.

:- interface.

:- pred use_before_bind(int::out) is det.

:- implementation.

use_before_bind(X) :-
    Y = X + 1,
    X = Y.
