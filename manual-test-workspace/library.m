% library.m
% PURPOSE: a richer module for hover, go-to-definition, find references,
% rename, document/workspace symbols, completion, CodeLens, the AST
% Explorer, documentation generation, and Inline Predicate (double_plus_one
% below is deliberately a safe target: one clause, det, in/out only).
:- module library.

:- interface.

:- import_module list.

    % Adds two integers together.
:- func add(int, int) = int.

    % Doubles a number and adds one.
    % Safe to inline: single clause, det, in/out-only arguments.
:- pred double_plus_one(int::in, int::out) is det.

    % A simple 2D point.
:- type point ---> point(int, int).

    % Sums a list of integers. Recursive (two clauses) — a good target for
    % Extract Predicate practice and for seeing recursion in the call graph,
    % but NOT a valid Inline Predicate target (more than one clause).
:- pred sum_list(list(int)::in, int::out) is det.

    % A typeclass for things that can be turned into a human-readable string.
:- typeclass describable(T) where [
    func describe(T) = string
].

:- instance describable(point).

:- implementation.

:- import_module string, int.

add(A, B) = A + B.

double_plus_one(N, Result) :-
    Doubled = N * 2,
    Result = Doubled + 1.

sum_list([], 0).
sum_list([H | T], Sum) :-
    sum_list(T, Rest),
    Sum = H + Rest.

:- instance describable(point) where [
    describe(point(X, Y)) = "point(" ++ string.from_int(X) ++ ", " ++ string.from_int(Y) ++ ")"
].
