% list_utils.m - a library module imported by other fixtures; exercises
% cross-module symbol resolution, references, and the dependency graph.
:- module list_utils.

:- interface.

:- pred sum_list(list(int)::in, int::out) is det.
:- pred my_map(pred(T, U), list(T), list(U)).
:- mode my_map(pred(in, out) is det, in, out) is det.

:- implementation.

:- import_module int.

sum_list([], 0).
sum_list([H | T], Sum) :-
    sum_list(T, Rest),
    Sum = H + Rest.

my_map(_, [], []).
my_map(Pred, [H | T], [MH | MT]) :-
    Pred(H, MH),
    my_map(Pred, T, MT).
