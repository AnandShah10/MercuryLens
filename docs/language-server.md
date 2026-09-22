# Language Server

`server/src/server.ts` implements a standard LSP server using
`vscode-languageserver`/`vscode-languageserver-textdocument`, run as a
separate Node process (IPC transport) from the extension host.

## Capabilities

| Feature | Backing | Notes |
|---|---|---|
| Text sync | Incremental | `TextDocuments` from `vscode-languageserver-textdocument` |
| Completion | Workspace symbol index + keywords + local clause variables | Context-aware: module-qualified (`Mod.`) completion returns only that module's exported predicates/functions; otherwise scoped to imported modules + the current file |
| Hover | Symbol index | Predicate/function signature, determinism, purity, per-argument mode/type; variables get scope information (head vs. local) without inventing an instantiation state the parser can't determine |
| Definition | Symbol index | Predicates/functions/types/typeclasses/instances/modules, qualified or not |
| References | Static call-site + symbol-name scan across the workspace | See the call-graph caveat below — this is a text/name-based match, not overload-resolved |
| Rename | Symbol name + call-site occurrences | Only predicate/function/type/typeclass declarations and call sites are renamed; validates the new name is a legal Mercury identifier before producing an edit |
| Document/workspace symbols | Symbol index | |
| CodeLens | Symbol index + call-site heuristic | Determinism/purity, caller/reference counts, "Run Predicate" |
| Semantic tokens | Symbol index + call sites | `full` only (no delta/range) for this pass |
| Formatting | Custom conservative formatter | See below |
| Signature help | Symbol index | Triggered on `(` |
| Code actions | Organize imports, diagnostic explanations | See below |

## Diagnostics pipeline

On open/change (debounced 300ms), the server re-parses the document into the
workspace index and then either:

1. Runs `mmc --errorcheck-only` against the file (if `mmc` is detected) and
   maps its output to LSP diagnostics, filtered to the current file; or
2. Falls back to `computeSyntacticDiagnostics` (see
   `server/src/diagnostics/syntacticDiagnostics.ts`) when no compiler is
   available.

Diagnostics are re-sent (as an empty array) when a document closes.

## Formatter scope

Mercury's grammar is operator-precedence based with user-definable
operators; a fully general pretty-printer needs the compiler's own parser to
avoid corrupting valid-but-unusually-formatted programs (e.g. custom infix
operators declared via `:- op`). `mercuryTools.formatter.enabled` therefore
controls a **conservative** formatter
(`server/src/server.ts::formatMercurySource`) that only:

- Normalizes indentation to 4-space steps based on bracket/`if`/`then`/`else`
  nesting depth
- Trims trailing whitespace

It deliberately does not reflow expressions, break/join lines, or realign
operators. This is a scope decision, not an oversight — see
`docs/development.md` for what a fuller formatter would require.

## Call-graph-derived features (CodeLens counts, References, heuristic Call Graph)

These features rely on a **static-text call-site heuristic**: an
`identifier(` in a clause body is treated as a call to any indexed
predicate/function of that name. This does not perform Mercury's actual
overload resolution (same name, different arity is legal and common in
Mercury; a real call graph would need full type/mode information to
disambiguate calls through higher-order values, too). Where a call name
matches multiple declared arities, the actual parenthesized argument count
at the call site is computed (state-variable-aware — a bare `!Name`
argument counts as 2, exactly matching its post-expansion arity; see
`docs/architecture.md`'s note on this) and used to prefer an exact-arity
match; only when that still leaves more than one same-arity candidate does
this extension link/count all of them rather than guessing one — this is
visible in the CodeLens counts and called out in the Call Graph webview's
toolbar text.

### Cross-checking the call graph against `mmc`

`Mercury: Show Predicate Call Graph` additionally runs `mmc
--errorcheck-only` across the workspace (when a compiler is available) and
scans its real output for backtick-quoted `` `name/arity' `` references —
the form Mercury's own diagnostics consistently use for "undefined
predicate", "ambiguous overloading", and similar messages (see
`extension/src/compiler/verifyCallGraph.ts`). Any call-graph node matching
one of those references is marked with a warning glyph in the webview, and
the toolbar reports whether the workspace compiles cleanly at all.

This is real signal, not a re-guess: it only ever surfaces what the actual
compiler already said. But it has a specific, stated boundary — a clean
compile proves the program as a whole type/mode-checks, which in turn
proves *some* resolution of every overloaded call was valid, but it does
**not** prove this extension's heuristic picked the *same* resolution
Mercury's real (type-based) overload resolution did whenever more than one
same-arity candidate exists for a name. That case can't be distinguished
from the compiler's plain output alone, and the toolbar says so rather than
implying full verification.

## Custom (non-LSP-standard) requests

See `docs/architecture.md#extension--server-wire-contracts` for the full
list (`mercury/callGraph`, `mercury/moduleDependencies`, `mercury/ast`,
`mercury/moduleDoc`, `mercury/explainDiagnostic`, `mercury/compilerStatus`,
`mercury/reindex`). These exist because VS Code's webviews, tree views, and
custom panels need structured data the standard LSP surface doesn't carry.
