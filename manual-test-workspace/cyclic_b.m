:- module cyclic_b.

:- interface.

:- import_module cyclic_a.

:- pred b_pred(int::in, int::out) is det.

:- implementation.

b_pred(X, X).
