% cyclic_a.m + cyclic_b.m
% PURPOSE: a genuine circular import, for testing "Mercury: Show Module
% Dependencies" — it should detect and display this cycle with a warning,
% whether resolved via mmc --generate-dependencies or the import-decl
% fallback.
:- module cyclic_a.

:- interface.

:- import_module cyclic_b.

:- pred a_pred(int::in, int::out) is det.

:- implementation.

a_pred(X, X).
