% debug_target.m
% PURPOSE: a small, real recursive program for "Mercury: Debug with mdb
% (Terminal)" and "Mercury: Start Experimental Debug Session (mdb)".
% factorial/1 gives a clean, shallow recursion (factorial(5) = 5 levels)
% good for setting a breakpoint on and stepping through a few times before
% it becomes tedious. main/2 also makes a good CodeLens/Run Predicate
% target on its own.
:- module debug_target.

:- interface.

:- import_module io.

:- pred main(io::di, io::uo) is det.

:- implementation.

:- import_module int.

main(!IO) :-
    Result = factorial(5),
    io.print(Result, !IO),
    io.nl(!IO).

:- func factorial(int) = int.

factorial(N) = R :-
    ( if N =< 1 then
        R = 1
    else
        R = N * factorial(N - 1)
    ).
