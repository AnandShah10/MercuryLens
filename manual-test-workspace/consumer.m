% consumer.m
% PURPOSE: calls into library.m, so definitions live in a DIFFERENT file
% than their call sites — this is what exercises the cross-workspace
% lookup (Mode/Type/Determinism Information, go-to-definition across
% files) rather than the same-file fast path. Also the main target for:
%   - Extract Predicate (see the two-line fragment marked below)
%   - Inline Predicate (the double_plus_one call, marked below)
%   - Call graph arity precision (greet/2 vs greet/3 overload)
%   - Mercury: Run File / Run Predicate (this module has main/2)
%   - Debug with mdb / experimental debug session (build + run this)
:- module consumer.

:- interface.

:- import_module io.

:- pred main(io::di, io::uo) is det.

:- implementation.

:- import_module library, list, int.

main(!IO) :-
    % --- Inline Predicate target: place the cursor on the call below and
    % run "Mercury: Inline Predicate". double_plus_one has exactly one
    % clause, is det, and has only in/out arguments, so it qualifies.
    double_plus_one(5, Result),
    io.print(Result, !IO),
    io.nl(!IO),

    Numbers = [1, 2, 3, 4, 5],
    sum_list(Numbers, Total),

    % --- Extract Predicate target: select these next two lines (from
    % "Doubled = " through the comma after "Squared * Squared,") and run
    % "Mercury: Extract Predicate".
    Doubled = add(Total, Total),
    Squared = Doubled * Doubled,

    io.print(Squared, !IO),
    io.nl(!IO),
    greet("world", !IO),
    greet("Dr.", "Who", !IO).

    % --- Call graph arity test: two predicates named 'greet' at different
    % arities. Open "Mercury: Show Predicate Call Graph" and confirm the
    % call from main resolves to the correct one for each call site
    % (greet/3 for the one-argument-plus-io call, greet/4 for the two).
:- pred greet(string::in, io::di, io::uo) is det.
:- pred greet(string::in, string::in, io::di, io::uo) is det.

greet(Name, !IO) :-
    io.format("Hello, %s!\n", [s(Name)], !IO).
greet(Title, Name, !IO) :-
    io.format("Hello, %s %s!\n", [s(Title), s(Name)], !IO).
