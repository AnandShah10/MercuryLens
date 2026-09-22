% fib.m - recursive predicate/function fixture for call-graph tests.
:- module fib.

:- interface.

:- func fib(int) = int.

:- implementation.

fib(N) = R :-
    ( if N =< 1 then
        R = N
    else
        R = fib(N - 1) + fib(N - 2)
    ).
