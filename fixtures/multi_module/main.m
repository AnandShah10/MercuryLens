% main.m - the entry point of the multi-module fixture project.
:- module main.

:- interface.

:- import_module io.

:- pred main(io::di, io::uo) is det.

:- implementation.

:- import_module list_utils.
:- import_module int, list.

main(!IO) :-
    Numbers = [1, 2, 3, 4, 5],
    sum_list(Numbers, Total),
    io.format("Total: %d\n", [i(Total)], !IO),
    my_map(double, Numbers, Doubled),
    io.write_line(Doubled, !IO).

:- pred double(int::in, int::out) is det.

double(X, X * 2).
