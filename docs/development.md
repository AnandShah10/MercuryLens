# Development

## Prerequisites

- Node.js 18+ and npm
- VS Code 1.85+
- (Optional, for compiler-backed features) the Mercury compiler (`mmc`) —
  see the README for installation. All non-compiler-backed features work
  without it.

## Setup

```bash
npm install
npm run compile     # bundles extension + server with esbuild (dev build, with source maps)
```

## Build system

The extension host and language server are each bundled into a single file
with esbuild (`esbuild.js`) — `extension/out/extension.js` and
`server/out/server.js` — rather than shipped as an unbundled `node_modules`
tree. `vscode` (provided by the host at runtime) is left external; every
other dependency (`vscode-languageclient`, `vscode-languageserver`, etc.) is
inlined. This is why the packaged VSIX is a handful of files instead of a
few hundred, and it measurably improves activation time since Node isn't
resolving a deep `node_modules` tree on every extension load.

Type-checking is a separate step from bundling (esbuild does not type-check):

```bash
npm run typecheck   # tsc --noEmit against both projects
```

`npm run watch` runs esbuild in watch mode (dev build, source maps, no
minification) for use with the "Run Extension" launch configuration.
`npm run bundle` produces the production build (minified, no source maps)
used by `npm run package`.

## Running the extension

Open this folder in VS Code and press F5 (uses `.vscode/launch.json`'s "Run
Extension" configuration), which opens a new Extension Development Host
window with `fixtures/multi_module` as the workspace. To debug the language
server itself, use the "Extension + Server" compound launch configuration,
which additionally attaches to the server process on port 6009 (the server
is started with `--inspect=6009` in debug mode automatically).

## Testing

```bash
npm run test:unit          # mocha + ts-node, no VS Code/mmc dependency
npm run test:integration   # @vscode/test-electron — see note below
```

Unit tests (`test/unit/**`) exercise the parser, compiler-output parsing,
diagnostics, call graph, and workspace index directly against the fixtures
in `fixtures/`, using `test/unit/compiler/mockCompilerAdapter.ts` where a
deterministic stand-in for `mmc` is needed. These have no environment
dependencies and are the primary test suite.

Integration tests (`test/integration/**`) launch a real VS Code instance via
`@vscode/test-electron` and verify the extension activates, registers its
commands, and recognizes `.m` files. **This requires downloading a VS Code
test binary from `update.code.visualstudio.com` and a display (or Xvfb) to
run Electron** — neither is available in every environment (notably, the
sandbox this extension was developed in has neither), so this suite is kept
separate from `test:unit` and is expected to be run in a normal developer
machine or a CI job configured for Electron/Xvfb.

## Linting

```bash
npm run lint
```

## Packaging

```bash
npm run package   # typecheck && lint && test:unit && bundle && vsce package
```

Both the extension host and language server are bundled into a single file
each via esbuild (see `esbuild.js` and the "Build system" note above), so
the packaged VSIX ships without an unbundled `node_modules` tree.

This produces `MercuryLens.vsix`, installable via VS Code's
"Install from VSIX..." command, or `code --install-extension
MercuryLens.vsix`.

## Extending the parser for a new declaration form

1. Add a case to `parseDirective` in `server/src/parser/parser.ts` (or a new
   handler on `DirectiveHandlers` if it's a genuinely new category).
2. Add a fixture exercising it under `fixtures/`.
3. Add a unit test in `test/unit/parser/parser.test.ts` asserting the
   extracted `SymbolNode` fields.
4. If the new symbol kind should appear in hover/CodeLens/the sidebar,
   extend `signatureLabel`/`toDocumentSymbol` in `server/src/server.ts` and
   the relevant provider in `extension/src/providers/workspaceTreeProvider.ts`.

## What a fuller implementation would still need

Documented here rather than silently deferred:

- **A live-verified DAP bridge to `mdb`.** `Mercury: Start Experimental
  Debug Session (mdb)` (`extension/src/debug/`) implements a real Debug
  Adapter Protocol bridge — breakpoints, continue/step, stack, variables —
  and its request/response translation logic is unit tested end-to-end
  against a fake mdb process (`test/unit/debug/mdbSession.test.ts`). What
  it could not get is verification against a *real* `mdb`: the commands it
  sends are stably-documented and used with high confidence, but the exact
  text format of mdb's trace-event/`stack`/`vars` output
  (`extension/src/debug/mdbProtocol.ts`) was assumed from documentation,
  not confirmed live (no Mercury installation was available while building
  this — see the README's Limitations section). Every parser there is
  defensive and mdb's raw output is always additionally shown in the Debug
  Console, and `Mercury: Debug with mdb (Terminal)` remains a fully
  reliable, non-experimental fallback with none of this uncertainty. The
  natural next step, given a real Mercury install, is running the fixtures
  through the experimental session and fixing whatever in
  `mdbProtocol.ts` doesn't match reality.
- **Inline Predicate's safe subset could be widened.** The current
  implementation (`extension/src/utils/inlinePredicateHeuristics.ts`) only
  handles a single-clause, `det`, in/out-only-moded predicate called as a
  standalone top-level goal. Extending it to `semidet` targets (would need
  to wrap the call site in an if-then-else), function-style calls nested
  inside a larger expression (would need to hoist the call into a
  preceding goal binding a fresh variable), or multi-clause targets (would
  require synthesizing a disjunction or switch that faithfully reproduces
  Mercury's own clause-indexing/backtracking behavior) are all real
  possible extensions, each with its own correctness subtleties that
  weren't attempted here to avoid the risk of silently changing program
  behavior.
- A fully general formatter (would need the compiler's own operator-table-
  aware parser to be safe on programs with custom operators).
- Consuming `.int`/`.int2`/`.int3` interface files directly (they're
  human-readable but compiler-internal text formats without a documented
  stable machine-readable schema; this extension's own indexer serves the
  equivalent purpose for navigation without depending on undocumented
  interface-file internals).
