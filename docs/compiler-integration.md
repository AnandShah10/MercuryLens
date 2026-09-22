# Compiler Integration

Mercury Tools treats the real Mercury compiler (`mmc`) as the single source
of truth for anything requiring semantic analysis (type checking, mode
checking, determinism checking). This document describes exactly what is
invoked, how output is interpreted, and what happens when `mmc` is
unavailable — which, per the project's engineering principles, must never
make the extension unusable.

## Detection

`mercuryTools.compilerPath` (if set) is tried first; otherwise `mmc` is
looked up on `PATH`. Detection runs `mmc --version` with a 5s timeout and
treats a `0` exit code or an `Mercury Compiler` string in the output as
success, extracting the version number from output like `... version
22.01.8 ...`. See `server/src/compiler/mercuryCompilerAdapter.ts::detect`
and `extension/src/compiler/detector.ts::detectCompiler` (the extension host
needs its own copy for commands that must run directly in a VS Code
`withProgress`/terminal context rather than round-tripping through LSP).

If detection fails, every dependent feature degrades explicitly:

- **Diagnostics** fall back to a small set of syntactic checks (see
  `server/src/diagnostics/syntacticDiagnostics.ts`) that are clearly labeled
  `mercury-syntax` (vs. `mmc`) and explicitly say "syntactic check only —
  install/configure mmc for full type, mode, and determinism checking."
  in each message.
- **Build/Run/Clean/Playground** commands show
  `Mercury compiler not found. Syntax and basic language features remain
  available. Configure mercuryTools.compilerPath or install Mercury.`
  and do nothing further (no fabricated build/run output).
- **Module Dependencies** falls back to a graph derived from indexed
  `:- import_module`/`:- use_module` declarations, explicitly labeled as such
  in the webview rather than presented as compiler-verified.

## Diagnostics: `mmc --errorcheck-only`

This flag performs full type, mode, and determinism checking (and reports
warnings) without generating code — the standard way editor tooling gets
compiler diagnostics without paying for a full build. (See the Mercury
User's Guide's description of build-system options; `--errorcheck-only` is
documented there as exactly this: check-without-codegen.)

Diagnostic lines are parsed generically by
`server/src/compiler/mercuryCompilerAdapter.ts::parseCompilerOutput` against
the pattern `<file>:<line>[-<line>]: (Error|Warning): <message>`, with
indented continuation lines folded into the preceding diagnostic's message.
This is intentionally generic rather than pattern-matching specific historical
message wordings, since Mercury's exact phrasing is compiler-owned and can
change between versions; the file/line/severity/message split is the stable
contract this extension relies on.

Each check run is bounded by `mercuryTools.maxAnalysisTime` (default 10s) so
a pathological input can't hang the editor; on timeout, the previous
diagnostics remain and a warning is surfaced instead of silently succeeding.

## Build / Run: `mmc --make`

`Mercury: Build Project` and `Mercury: Run Project` invoke `mmc --make
<mainModule>`, where `<mainModule>` is chosen by the user from files that
look like they define `main/2` (see `extension/src/workspace/
projectDetector.ts`) — this extension never guesses silently; if there's more
than one candidate, the user is prompted with a Quick Pick. `--use-subdirs`
is automatically implied by `--make` (per the Mercury User's Guide), which
this extension relies on rather than reimplementing.

`Mercury: Clean Project` runs `mmc --make <mainModule>.clean` after an
explicit modal confirmation (not `.realclean`, since that also removes
installed interface files that may be shared outside the current build).

## Playground: temporary, isolated compilation

`Mercury: Run File` / `Run Selection` / `Run Predicate` never write build
artifacts into the user's workspace. Each copies the relevant source (plus,
for "Run File", sibling `.m` files in the same directory, best-effort) into a
fresh `os.tmpdir()` scratch directory, compiles there with `mmc --make`, runs
the resulting executable there, and deletes the scratch directory afterward
regardless of outcome.

- **Run Selection** wraps the selected text in an `if-then-else` inside a
  synthesized `main/2`. This only works when the selection is a
  self-contained, callable goal — Mercury has no concept of running an
  arbitrary code fragment outside a valid program, so this is a property of
  the language, not a shortcut this extension is skipping.
- **Run Predicate** parses the target's own `:- pred`/`:- func` declaration
  and will only auto-invoke it when every `in` argument has a primitive type
  (`int`/`float`/`string`/`char`/`bool`) and every other argument is `out` —
  anything else (a `di`/`uo` I/O state, a user-defined type, a higher-order
  argument) is explicitly refused with an explanation, rather than
  guessing a value or silently no-op'ing.

## Module dependencies: `mmc --generate-dependencies`

`Mercury: Show Module Dependencies` runs `mmc --generate-dependencies
<mainModule>` and parses the resulting `.d`/`.dep` file's Make-style rules
for `.m` dependencies. If this fails (or no main module can be found), the
view falls back to the import-declaration-derived graph, and says so.

## Profiling: `mprof` / deep profiling

Mercury has two profiling systems (see the Mercury User's Guide,
"Profiling"):

- **Classic profiling** (`mmc --grade <grade-with-prof>`, e.g.
  `asm_fast.gc.prof`, or `--profiling`) produces `Prof.Counts`, `Prof.Decl`,
  and `Prof.CallPair` in the working directory after a normal-terminating
  run; `mprof` post-processes these into a gprof-style report.
- **Deep profiling** (`--deep-profiling`) produces much more detailed
  call-tree data via a CGI-based web tool (`mdprof_cgi`), is not compatible
  with the classic profiling grades, and (per Mercury's own documentation)
  isn't available for every backend.

`Mercury: Open Performance Profile` checks the workspace root for the three
classic-profiling files; if present, it runs `mprof` and displays its raw
report. If absent, it explains exactly what to do (rebuild with a profiling
grade, run the program, re-open the view) rather than fabricating a
plausible-looking report.

### Deep profiling: `Mercury: Open Deep Profile`

`mdprof_cgi` is, as its name says, a CGI program: a normal deployment runs
it behind a web server, invoked with the data file / drill-down parameters
in the `QUERY_STRING` environment variable, printing HTTP headers then HTML
to stdout. `Mercury: Open Deep Profile` uses exactly that CGI contract
directly — it looks for a `*.data` deep-profiling file (the format Mercury
names `programname_date_time.data` by default) in the workspace root, then
invokes `mdprof_cgi` with `QUERY_STRING` set to that file's full path
(`extension/src/utils/mdprofCgi.ts`). The returned HTML's own links are
intercepted in the webview; clicking one re-invokes `mdprof_cgi` with the
link's query portion as the new `QUERY_STRING` and replaces the panel
content with the result. This gives real interactive drill-down through
clique pages, call sites, etc. — every page shown is `mdprof_cgi`'s own
unmodified output (scripts/styles/meta tags are stripped defensively, since
the panel supplies its own theme-aware CSS and navigation script; the tool
itself doesn't rely on client-side script to render its tables) — without
requiring the user to configure an actual CGI-capable web server.

## Debugging

Mercury's debugger (`mdb`) is a source-level declarative/procedural debugger
with its own command language and (for many grades) requires a
debug-enabled grade (`--debug`/`--decl-debug`) to get full trace-event
coverage.

This project offers two ways to use it, both building on `mmc --make
--debug <module>` (the documented way to get a debugging-grade executable):

1. **`Mercury: Debug with mdb (Terminal)`** — opens `mdb <executable>`
   directly in a VS Code integrated terminal. Fully reliable, since it's
   just a terminal running the real tool, completely unmodified; the
   tradeoff is no breakpoint gutters or step/continue toolbar.

2. **`Mercury: Start Experimental Debug Session (mdb)`** — a genuine Debug
   Adapter Protocol bridge (`extension/src/debug/`) so VS Code's breakpoint
   gutters and debug toolbar drive real `mdb` commands: breakpoints resolve
   to a `break Module.Name/Arity` command (mdb breaks on predicate entry,
   not arbitrary lines — a breakpoint is snapped to its enclosing
   predicate's actual declaration line, reported to VS Code as such, rather
   than pretending exact-line accuracy Mercury's execution model doesn't
   have); continue/step-over/step-in/step-out map to `continue`/`next`/
   `step`/`finish`; the stack/variables views come from `stack`/`vars`;
   the Debug Console's expression field passes anything typed straight
   through to mdb as a raw command (so real `mdb` commands like `dd` always
   work even where this bridge's own structured views don't cover
   something).

   At launch, the bridge also sends `context prevline` — a real, documented
   mdb command (see the Mercury User's Guide's "Parameter commands"
   chapter) that makes mdb print a `filename:line` context on its own line
   immediately before every subsequent event/stack report. When present,
   this **real, mdb-reported source location is used and preferred** over
   the declaration-snapped fallback described above, so stopped locations
   and stack frames can point at a call's actual current position, not
   just its enclosing predicate's declaration line.

   This is explicitly labeled **EXPERIMENTAL** in its UI name, and the
   remaining uncertainty is now narrower and more precisely stated than "we
   guessed": the commands sent (`break`, `continue`, `next`, `step`,
   `finish`, `stack`, `vars`, `print`, `quit`, `context prevline`) are
   long-standing, documented mdb commands. The `pred Name/Arity-ModeNum`
   reference format `mdbProtocol.ts`'s parsers match against is not a
   guess either — it's taken from a literal example in the User's Guide's
   own `dice` command documentation. What genuinely remains unverified
   without a live `mdb` is the exact column layout/whitespace of a plain
   trace or `stack` line in ordinary interactive ("creep") mode, since the
   documentation describes the fields present but not their literal
   separator characters outside that one `dice`-table example — which is
   exactly why every parser matches on distinctive substrings (the port
   keyword, the `pred|func Name/Arity` reference, a `file.m:line` context
   line) rather than fixed column positions, and returns nothing rather
   than guessing when a line doesn't match. mdb's raw, unmodified output is
   always additionally forwarded to the Debug Console, so a format
   mismatch on a given mdb version is visible and diagnosable rather than
   silently wrong — and option 1 above remains a fully reliable fallback
   that shares none of this uncertainty. `pause` is intentionally
   reported as unsupported (mdb's prompt-driven model has no clean way to
   interrupt a running computation) rather than faked. The end-to-end DAP
   request/response translation logic itself (protocol framing, breakpoint
   resolution, stack/variable shaping, and now the context-line-preferred
   location resolution) is unit tested against a fake mdb
   process (`test/unit/debug/mdbSession.test.ts`) — that proves the
   translation logic is correct *given* mdb behaves as documented; it
   cannot prove mdb actually does.
