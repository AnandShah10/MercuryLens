% hello.m
% PURPOSE: the very first file to open. No errors, no compiler needed to
% see something working. Use this to sanity-check that the extension
% activated at all: syntax highlighting, hover, and the sidebar.
:- module hello.

:- interface.

:- import_module io.

:- pred main(io::di, io::uo) is det.

:- implementation.

main(!IO) :-
    io.write_string("Hello, Mercury!\n", !IO).
