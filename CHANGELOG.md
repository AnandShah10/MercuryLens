# Changelog

All notable changes to MercuryLens are documented here. Format loosely
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.1.1]

### Fixed
- **Experimental mdb debug bridge now uses `context prevline`** (a real,
  documented mdb command found via the official Mercury User's Guide) to
  get genuine `filename:line` source locations from mdb itself, preferred
  over the declaration-based fallback wherever available. The `pred
  Name/Arity-ModeNum` reference format the bridge's parsers match against
  was also confirmed against a literal example in the User's Guide (the
  `dice` command documentation) rather than left as an unverified
  assumption from memory. This narrows — though does not eliminate,
  absent a live `mdb` to test against — the bridge's remaining
  uncertainty; see `docs/compiler-integration.md#debugging`.
- **Call-graph / CodeLens arity resolution for state-variable arguments.**
  A bare `!Name` argument (e.g. `!IO`) now counts as 2 arguments when
  computing a clause's or call site's arity, matching its real
  post-expansion arity exactly (`server/src/parser/parser.ts`'s
  `stateVarAwareArity`). Previously it was counted as a single syntactic
  token, which could under-count arity for any predicate using state
  variables — the majority of realistic Mercury code — and could cause
  the call graph to link a call site to every same-named overload instead
  of just the correct one. The partial forms `!.Name`/`!:Name` are
  correctly left at 1 each (they are single ordinary terms, not a pair).
- Fixed a discarded-value bug in `Mercury: Show Predicate Call Graph`
  where the module to pre-filter to (computed from the invoking CodeLens)
  was calculated and then never used.
- Fixed Mode/Type/Determinism Information commands only searching the
  current file for a declaration; they now fall back to a genuine
  cross-workspace lookup (`mercury/findDeclaration`) when the declaration
  lives in a different file than the cursor.
- Fixed Extract Predicate's mode-inference arity check silently
  mismatching for clause heads with a compound-term/pattern argument
  (e.g. `double(X, X * 2).`) rather than a plain variable, which produced
  a confusing generic "argument count mismatch" refusal instead of an
  accurate one.
- Fixed a disjunction detector (used by Inline Predicate's safety checks)
  that missed Mercury's idiomatic parenthesized disjunction form
  (`( A ; B )`), only catching a bare top-level `;`.

### Added
- **Inline Predicate** (`Mercury: Inline Predicate`) — safe-subset
  inlining for a single-clause, `det`, in/out-only-moded predicate called
  as a standalone clause-body goal, with alpha-renaming to avoid variable
  capture and automatic `mmc --errorcheck-only` verification afterward.
- **Experimental Debug Adapter Protocol bridge to `mdb`**
  (`Mercury: Start Experimental Debug Session (mdb)`) — real breakpoints,
  step/continue, call stack, and variables driven by the actual Mercury
  debugger, alongside the original terminal-based `Mercury: Debug with
  mdb (Terminal)` command, which remains available and fully reliable.
- **Deep Profile view** (`Mercury: Open Deep Profile`) — drives the real
  `mdprof_cgi` tool directly (via its CGI environment-variable contract)
  for interactive drill-down profiling without needing a web server.
- Compiler cross-check for the predicate call graph: nodes named in an
  actual `mmc --errorcheck-only` diagnostic are flagged in the webview.
- A memoizing cache for the call graph, invalidated automatically on any
  workspace edit, to avoid recomputing it from scratch on every CodeLens
  refresh.
- `manual-test-workspace/` — a dedicated set of `.m` files and a
  step-by-step `TESTING_CHECKLIST.md` for manually exercising every
  feature in a real VS Code instance.
- A marketplace-ready icon (`media/icon.png`) and corrected activity-bar
  icon (`media/mercury.svg`, now a proper vector glyph rather than a
  `<text>`-in-a-mask approach that didn't render legibly).

### Changed
- Extension host and language server are now bundled with esbuild into a
  single file each, rather than shipped with an unbundled `node_modules`
  tree — meaningfully faster activation and a much smaller package.
- `server.ts` was refactored from one large file into focused modules
  (`analyzer/`, `types/`, `modes/`, `determinism/`, `references/`,
  `dependency/`, `cache/`), each independently unit tested. The
  extension host's sidebar providers and configuration reads were
  similarly split into `providers/`, `diagnostics/`, and `configuration/`.

## [0.1.0] — Initial implementation

- Syntax highlighting, language server (completion, hover, definition,
  references, rename, document/workspace symbols, CodeLens, semantic
  tokens, signature help, code actions, formatting).
- Mercury compiler (`mmc`) integration: detection, `--errorcheck-only`
  diagnostics, `--make` build/run, `--generate-dependencies`, with a
  syntactic-diagnostics fallback when no compiler is available.
- Mode/instantiation, determinism, and type information panels.
- Predicate call graph and module dependency graph (with cycle
  detection) webviews.
- AST Explorer with synced source/AST panes.
- Mercury Playground: Run File, Run Selection, Run Predicate.
- `Mercury: Debug with mdb (Terminal)`.
- Compiler error explanations, Markdown documentation generation.
- Rename and organize-imports refactoring; Extract Predicate.
- Classic performance profiling via `mprof`.
- Mercury sidebar (Workspace / Diagnostics / Compiler views), status bar.

---

Nothing in this project has been version-tagged/published to a
marketplace yet — see the README's Limitations section for what has and
hasn't been verified against a live Mercury installation.
