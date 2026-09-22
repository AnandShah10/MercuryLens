% errors_mode.m
% PURPOSE: a deliberate MODE error (using X before it's bound), for testing
% diagnostics. Same story as errors_type.m: requires mmc to actually catch
% this; "Mercury: Explain Diagnostic" should recognize the mode/
% instantiation category.
:- module errors_mode.

:- interface.

:- pred use_before_bind(int::out) is det.

:- implementation.

use_before_bind(X) :-
    Y = X + 1,
    X = Y.
