/**
 * Maps well-understood categories of Mercury compiler messages to a
 * plain-English explanation. This module is deliberately conservative: it
 * only adds an explanation when the diagnostic text matches a pattern whose
 * meaning is well documented (see the Mercury User's Guide / FAQ), and
 * otherwise returns the compiler's own message unchanged rather than
 * guessing.
 */

export interface Explanation {
    category: string;
    explanation: string;
}

const RULES: { pattern: RegExp; category: string; explanation: string }[] = [
    {
        pattern: /mode mismatch|insufficient instantiation|has instantiatedness `free'|not sufficiently instantiated/i,
        category: 'Mode / instantiation error',
        explanation:
            "This argument must already have a known (ground) value at this point in the program, but the variable is still unbound ('free') on at least one branch. In Mercury, modes describe how each argument's instantiation changes from call to call, so a variable must be bound before it is used in a context that requires it to be ground.",
    },
    {
        pattern: /type error|type mismatch|has type `.*' expected type `.*'/i,
        category: 'Type error',
        explanation:
            "The compiler inferred a different type for this expression than the type required by its context (e.g. a predicate's declared argument type). Check the argument types in the surrounding predicate/function declaration and any literals involved.",
    },
    {
        pattern: /undefined predicate|undefined symbol|no visible predicate/i,
        category: 'Undefined predicate/function',
        explanation:
            "No predicate or function with this name (and this number of arguments) is visible in this module. This usually means a missing `:- import_module` / `:- use_module` declaration, a typo, or an arity mismatch.",
    },
    {
        pattern: /determinism declaration.*not satisfied|determinism.*(too lax|too loose|wrong)/i,
        category: 'Determinism mismatch',
        explanation:
            "The predicate's actual determinism (how many solutions it can produce, and whether it can fail) does not match what its `:- pred ... is <det>` declaration promises. For example, a predicate declared `det` must succeed exactly once and never fail; if the compiler can prove it might fail, you'll see this error.",
    },
    {
        pattern: /unused import|module.*imported but not used|unused variable/i,
        category: 'Unused import / variable',
        explanation:
            "This import or variable is not referenced anywhere it's visible. It's safe to remove for clarity, though it isn't a correctness problem.",
    },
    {
        pattern: /singleton variable/i,
        category: 'Singleton variable',
        explanation:
            "This variable is only used once in the clause. That's usually a typo (Mercury variables are capitalized, so a small naming mistake silently creates a new variable instead of reusing the intended one). If it's intentional, prefix the name with an underscore, e.g. `_Unused`.",
    },
    {
        pattern: /purity/i,
        category: 'Purity mismatch',
        explanation:
            "This call's purity (`pure`, `semipure`, or `impure`) does not match what's required at the call site. Impure/semipure operations must be explicitly marked and cannot be called from a `pure` context without an explicit promise.",
    },
];

export function explainDiagnostic(message: string): Explanation | undefined {
    for (const rule of RULES) {
        if (rule.pattern.test(message)) {
            return { category: rule.category, explanation: rule.explanation };
        }
    }
    return undefined;
}
