% arithmetic.m - exercises det/semidet predicates and functions for tests.
:- module arithmetic.

:- interface.

:- pred calculate(int::in, int::in, int::out) is det.
:- func square(int) = int.
:- pred safe_divide(int::in, int::in, int::out) is semidet.

:- implementation.

calculate(A, B, Result) :-
    Result = A + B * square(B).

square(X) = X * X.

safe_divide(_, 0, _) :-
    fail.
safe_divide(A, B, Result) :-
    B \= 0,
    Result = A // B.
