% hello.m - a minimal Mercury program used as a parser/symbol-index fixture.
:- module hello.

:- interface.

:- import_module io.

:- pred main(io::di, io::uo) is det.

:- implementation.

main(!IO) :-
    greet("world", !IO).

    % greet/3 prints a friendly greeting to stdout.
:- pred greet(string::in, io::di, io::uo) is det.

greet(Name, !IO) :-
    io.format("Hello, %s!\n", [s(Name)], !IO).
