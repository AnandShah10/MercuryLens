% playground_demo.m
% PURPOSE: predicates/functions with only primitive-typed in/out arguments,
% for "Mercury: Run Predicate" — try it on square/1 (a func) and
% is_even/2 (a pred) below via their CodeLens "Run Predicate" link or the
% command palette with the cursor on the declaration/a call site.
:- module playground_demo.

:- interface.

:- import_module io.

:- pred main(io::di, io::uo) is det.
:- func square(int) = int.
:- pred is_even(int::in, bool::out) is det.

:- implementation.

:- import_module int, bool.

main(!IO) :-
    io.print(square(6), !IO),
    io.nl(!IO).

square(X) = X * X.

is_even(N, Result) :-
    ( if N mod 2 = 0 then
        Result = yes
    else
        Result = no
    ).
