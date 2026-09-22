# Architecture

MercuryLens follows a client/server split, as recommended for VS Code
language extensions: the **extension host** (`extension/`) owns VS Code UI
(commands, webviews, tree views, status bar, terminal/process execution) and
the **language server** (`server/`) owns Mercury-specific language
intelligence, communicating over the Language Server Protocol.

```
extension/            VS Code extension host (TypeScript, compiled to CommonJS)
  src/
    extension.ts       activation, LanguageClient wiring, command registration
    commands/          build/check/clean/run, playground, analysis/visualization,
                        extract predicate, debug-with-mdb, organize-imports/
                        restart-server
    compiler/          client-side mmc detection + call-graph/compiler
                        cross-checking (mirrors server/src/compiler for
                        commands that must run in the extension host, e.g.
                        because they need a VS Code terminal/progress UI)
    configuration/     typed, centralized reads of every `mercuryTools.*`
                        setting (the language server keeps its own separate
                        settings snapshot — see server.ts's `Settings`
                        interface — since it has no `vscode` API of its own)
    diagnostics/       the Mercury sidebar's diagnostics tree view (a
                        Problems-panel mirror; actual diagnostics are
                        computed entirely server-side — see below)
    providers/         sidebar TreeDataProviders (workspace explorer,
                        compiler status)
    views/             webview panels (call graph, module deps, AST
                        explorer, mode/type/determinism info, playground,
                        deep profile) and their shared CSP/HTML helpers
    workspace/         project/main-module detection
    utils/             safe process spawning, output channel/status bar,
                        wire type definitions shared with the server's JSON
                        payloads, the Extract Predicate heuristics (kept
                        `vscode`-free so they're independently unit-testable)

server/               Mercury language server (TypeScript, runs as a Node
                       child process over stdio/IPC via vscode-languageserver)
  src/
    parser/            lexer, top-level term splitter, declaration/clause
                        parser, AST/symbol type definitions
    symbols/           workspace-wide symbol index
    analyzer/          orchestrates parser+symbols+compiler: walks the
                        workspace to build the initial index, and chooses
                        between compiler-backed and syntactic-fallback
                        diagnostics for a document (server.ts owns LSP
                        wiring only; analyzer/ has no LSP dependency)
    compiler/          mmc adapter: detect/check/build/clean/run/
                        generate-dependencies, compiler-output parsing
    diagnostics/       syntactic fallback diagnostics, diagnostic explainer
    types/             type-declaration hover/lookup formatting
    modes/             mode/instantiation-state descriptions
    determinism/       determinism-category descriptions
    references/        reference-finding and rename-edit computation
                        (returns plain data; server.ts converts to LSP types)
    dependency/        import-declaration-derived module dependency graph
                        (the fallback when --generate-dependencies isn't
                        available — see compiler/mercuryCompilerAdapter.ts)
    callgraph/         heuristic static-call-site graph builder
    cache/             version-keyed memoizing cache for the call graph
                        (invalidated automatically via WorkspaceIndex.version)
    server.ts          thin LSP request/notification wiring — delegates to
                        the modules above rather than implementing analysis
                        itself (see "Keeping server.ts thin" below)

syntax/                TextMate grammar + language-configuration.json
fixtures/              sample Mercury programs used by tests
test/unit/             mocha unit tests (no VS Code or mmc dependency)
test/integration/      @vscode/test-electron-based extension activation tests
docs/                  this file and friends
```

## Keeping server.ts thin

`server.ts` originally grew into a single ~770-line file implementing every
LSP handler's logic inline — hover's mode/determinism formatting, the
reference/rename traversal, the dependency-graph request's data derivation,
and the call-graph computation were all written directly inside their
`connection.on*` callbacks. That violated this project's own "no giant
monolithic files" principle and left several planned directories
(`types/`, `modes/`, `determinism/`, `references/`, `dependency/`, `cache/`,
`analyzer/`) sitting empty in the scaffold with nothing in them.

That logic has since been factored out into the modules listed in the tree
above. `server.ts` now only does LSP-specific work: registering handlers,
converting between this project's own plain data shapes (`Range`,
`RefLocation`, `AnalyzerDiagnostic`, ...) and `vscode-languageserver`'s LSP
types, and gluing settings changes through to the modules that need them.
Every extracted module is `vscode-languageserver`-free and independently
unit tested (see `test/unit/{types,modes,determinism,references,dependency,
cache,analyzer}/`) — a meaningful difference from before, when this logic
could only be exercised by simulating LSP requests against the whole
server. The equivalent extension-host cleanup moved the sidebar
`TreeDataProvider`s into `providers/` and `diagnostics/`, and centralized
scattered `vscode.workspace.getConfiguration('mercuryTools')` calls (one of
which was duplicated verbatim in two files) into `configuration/`.

One planned directory was deliberately *not* filled: an extension-host
`codelens/` folder. CodeLens in this project is entirely server-driven via
the LSP `codeLensProvider` capability (see `server.ts`'s
`connection.onCodeLens`) — `vscode-languageclient` wires that up
automatically from the server's declared capabilities, so the extension
host needs no CodeLens-specific code of its own beyond the command handlers
a lens's `command.arguments` invoke, which already live in `commands/`
where they belong. Populating an empty folder just to avoid it being empty
would have been padding, not architecture, so it was removed instead.

## Why a "structural AST", not a full Mercury parser

Mercury's real grammar is an operator-precedence grammar with user-definable
operators, full unification-based term syntax, DCG translation, and a
non-trivial mode/type system. Re-implementing that faithfully in TypeScript
would be a large, perpetually-behind-the-compiler undertaking, and any subtle
divergence would produce wrong navigation/hover results with no way for a
user to know they'd been misled.

Instead, `server/src/parser` implements a **lexically precise, semantically
shallow** parser:

- It correctly tokenizes strings, quoted atoms, character literals, line/block
  comments, and nested brackets, so it never misinterprets a `.` inside a
  string as end-of-clause, etc.
- It splits source into top-level declarations and clauses precisely (this is
  unambiguous in Mercury: a `.` followed by whitespace/EOL/comment at
  paren-depth 0 always ends a term).
- It extracts declaration *heads* (predicate/function/mode/type signatures,
  import lists, clause heads, call sites) using targeted parsing of each
  declaration form, rather than building a full expression tree for clause
  bodies.

This is sufficient for navigation (definition/references/rename), symbol
indexing, CodeLens, hover, and the AST Explorer, and it is explicit about its
own limits (see in-code comments in `server/src/parser/ast.ts` and
`lexer.ts`). It intentionally does **not** attempt full term/expression
parsing (operator precedence resolution) — where a feature genuinely needs
that level of semantic fidelity, this extension defers to the real Mercury
compiler (see `compiler-integration.md`) instead of guessing.

### State-variable (`!X`) argument counting

Mercury's `!IO`-style state-variable notation expands to two ordinary
arguments (e.g. `!IO` → `IO0, IO`) during compilation. A bare `!Name`
argument is counted as **2** when computing a clause's or call site's
arity (`stateVarAwareArity` in `server/src/parser/parser.ts`) — this is an
exact consequence of the language's state-variable transformation, not a
heuristic, so it lines up precisely with a declaration's own arity for the
very common case of `!IO`-threading predicates. The partial forms `!.Name`
and `!:Name` (referencing just the "before" or "after" half) are each a
single ordinary term and are correctly counted as 1, not 2.

This used to be a documented limitation (bare `!Name` was counted as a
single token, undercounting arity for any predicate using state-variable
notation — which is most Mercury programs, since `!IO` is idiomatic). It's
called out here now as a *resolved* case rather than removed from the docs
silently, since the distinction between "always correct" and "was wrong
until a specific fix landed" is worth keeping visible.

## Data flow for Mercury-specific analysis (modes, determinism, types)

1. The parser extracts what's **declared** — `:- pred`/`:- func` argument
   modes, types, and `is <determinism>` — directly from source text. This is
   always available, even with no compiler installed, and is what powers
   hover, the Mode/Determinism/Type Information panels, and CodeLens.
2. Whether the **implementation** actually satisfies those declarations (a
   mode-correctness or determinism-correctness question) is answered only by
   `mmc --errorcheck-only`. This extension does not attempt to re-derive
   mode/determinism correctness itself — see `compiler-integration.md`.

## Security

- All external process execution goes through a single choke point per
  process (`extension/src/utils/process.ts` on the client,
  `server/src/compiler/mercuryCompilerAdapter.ts` on the server), both of
  which call `child_process.spawn` with an argument array and `shell: false`
  — never a concatenated shell string.
- Build/run/clean/playground commands check `vscode.workspace.isTrusted` and
  refuse to run in untrusted workspaces.
- Webviews are created with a strict Content-Security-Policy (`default-src
  'none'`), no remote resources, no `eval`, and communicate with the
  extension host only via typed `postMessage` contracts (see
  `extension/src/views/webviewUtils.ts`).
- Destructive commands (Clean Project) ask for explicit confirmation via a
  modal before running.

## Extension ↔ server wire contracts

Beyond the standard LSP requests, the server exposes a small set of custom
JSON-RPC methods the extension host uses to power its UI:

| Method                        | Purpose                                                |
|--------------------------------|---------------------------------------------------------|
| `mercury/compilerStatus`       | Current `mmc` detection result                          |
| `mercury/callGraph`            | Heuristic predicate/function call graph                 |
| `mercury/moduleDependencies`   | Compiler-backed + import-declaration-derived module deps|
| `mercury/ast`                  | Full structural AST for one document (AST Explorer)      |
| `mercury/moduleDoc`            | Parsed symbols/clauses for one document                  |
| `mercury/findDeclaration`      | Cross-workspace symbol lookup by name + kind filter — used by Mode/Type/Determinism Information when the cursor is on a *use* of a symbol declared in a different file |
| `mercury/explainDiagnostic`    | Plain-English explanation for a compiler message         |
| `mercury/reindex`              | Re-walks the workspace for `.m` files                    |

These are documented here because they are not part of the LSP spec; the
`WireModuleDoc`/`WireSymbol`/etc. types in
`extension/src/utils/wireTypes.ts` mirror (a subset of)
`server/src/parser/ast.ts` and must be kept in sync by hand since the two
projects compile independently.
