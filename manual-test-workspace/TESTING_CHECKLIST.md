# MercuryLens — Manual Testing Checklist

Open **this folder** (`manual-test-workspace/`) directly as your VS Code
workspace — not the parent repo — so the extension only indexes these
purpose-built files.

## Setup

1. Install the extension: `code --install-extension MercuryLens.vsix`
   (or Extensions view → `...` → "Install from VSIX...").
2. Open this folder in VS Code.
3. Open `hello.m`. Command Palette → type `Mercury:` — you should see the
   full command list. If you don't, the extension didn't activate; check
   the Extensions view to confirm it's enabled.
4. (Optional but needed for Phase 2+) Install Mercury from
   [mercurylang.org](https://mercurylang.org) and either put `mmc` on your
   `PATH` or set `mercuryTools.compilerPath` in Settings, then run
   `Mercury: Restart Language Server`. The bottom status bar should switch
   from "compiler not found" to showing a version.

Work through the phases in order — later phases assume earlier ones work.

---

## Phase 1 — No compiler required

These should all work immediately, with no Mercury installation.

### 1.1 Syntax highlighting
Open every `.m` file in this folder. Keywords (`pred`, `func`, `is det`,
`in`/`out`, `pragma`), strings, comments, and module-qualified names
(`io.write_string`) should be colored distinctly.

### 1.2 Sidebar
Click the Mercury icon in the Activity Bar (left edge). **Workspace**
should list every module here with expandable Predicates/Functions/Types
categories. **Compiler** should show either a version or "not found".
**Diagnostics** mirrors the Problems panel, Mercury files only.

### 1.3 Hover
In `library.m`, hover over `add`, `double_plus_one`, `sum_list`, and
`point`. Expect a signature, determinism, purity, and (for predicates) a
mode breakdown. In `consumer.m`, hover over the *calls* to
`double_plus_one`/`sum_list`/`add` (declared in a **different file**) —
this should still work, exercising the cross-workspace lookup.

### 1.4 Go to Definition / Find References
In `consumer.m`, Ctrl/Cmd-click `sum_list` → should jump to `library.m`.
Right-click → "Find All References" on `add` → should list its
declaration and both call sites.

### 1.5 Rename
Rename `double_plus_one` (F2, or right-click → Rename Symbol) to
`doubled_plus_one` — should update both `library.m`'s declaration/clause
and `consumer.m`'s call site. **Undo afterward** so later steps in this
checklist still match.

### 1.6 Document / Workspace Symbols
`Ctrl/Cmd+Shift+O` in `library.m` — should list `add`, `double_plus_one`,
`point`, `sum_list`, `describable`. `Ctrl/Cmd+T` and type `sum` — should
find `sum_list` across the workspace.

### 1.7 Completion
In `consumer.m`, on a new line inside `main`, type `library.` — should
suggest `add`, `double_plus_one`, `sum_list`. Type `S` — should suggest
local variables like `Squared`.

### 1.8 CodeLens
Above `sum_list` in `library.m`, you should see two lines: a
determinism/purity lens and a "N callers • M references" + "Run
Predicate" lens. Click the caller-count lens — should open the call graph
(see 1.11).

### 1.9 Signature Help
In `consumer.m`, start typing `add(` inside `main` — a signature tooltip
for `add(int, int) = int` should appear.

### 1.10 Formatting
Mess up the indentation in `debug_target.m`'s `factorial` clause (e.g. put
everything at column 0), then run "Format Document". Indentation should be
restored to consistent 4-space nesting. This is a **conservative**
formatter (see the README) — it won't reflow expressions, only fix
indentation/trailing whitespace.

### 1.11 Predicate Call Graph
`Mercury: Show Predicate Call Graph`. You should see nodes for every
predicate/function across all files, with edges for real calls (e.g.
`main` → `sum_list`, `sum_list` → `sum_list` for the recursive case).
Try the search box and module filter. **Expect**: the toolbar says no
compiler was found to cross-check (unless you did Phase 2 setup) — that's
correct, not a bug.

**Arity-overload check**: find the two `greet` nodes from `consumer.m`.
Since `!IO` is now counted precisely as 2 arguments (matching its
post-expansion arity — see `docs/architecture.md`), the edge from `main`'s
one-name call should resolve to `greet/3` **only**, and the two-name call
to `greet/4` **only** — not both. If you see an edge to both from a single
call site, that's a real bug worth reporting.

### 1.12 Module Dependency Graph
`Mercury: Show Module Dependencies`. You should see `consumer` →
`library`, and — importantly — **`cyclic_a` ↔ `cyclic_b` flagged as a
circular dependency** with a warning banner at the top.

### 1.13 AST Explorer
Open `library.m`, run `Mercury: Open AST Explorer`. Click a few source
lines — the corresponding AST node should highlight and vice versa. Try
"Copy AST as JSON".

### 1.14 Documentation Generator
Open `library.m`, run `Mercury: Generate Documentation`. A
`docs/library.md` file should appear (and open) with sections for Types,
Predicates, Functions, and Type classes, including the doc comments
written above each declaration in the source.

### 1.15 Organize Imports
Open `consumer.m` and temporarily add `:- import_module string.` to the
existing `:- import_module library, list, int.` line (make it its own
line or add to the list) without using anything from `string` anywhere in
the file. Run `Mercury: Organize Imports` — the unused import should be
removed. Undo afterward.

### 1.16 Syntactic diagnostics (no compiler)
With **no compiler configured**, open `errors_undefined.m`. You should see
an **info-level** diagnostic on the `totally_missing_module` import
("not found among the .m files currently indexed..."), labeled
`mercury-syntax` in the Problems panel. Open `errors_type.m` and
`errors_mode.m` — you should see **no diagnostics** here, since those are
semantic errors only a real compiler can catch. That absence is correct
behavior, not a bug.

---

## Phase 2 — Requires a real Mercury install

Do the compiler setup in "Setup" step 4 before this phase.

### 2.1 Build / Check / Run / Clean Project
`Mercury: Check Project` on this folder — should report the real errors
in `errors_type.m` and `errors_mode.m` (now visible in the Problems panel,
sourced `mmc`) in addition to a real "undefined predicate" error in
`errors_undefined.m`. `Mercury: Build Project` and `Mercury: Run Project`
— pick `consumer` or `hello` when prompted; `Run Project` should print
real output. `Mercury: Clean Project` should ask for confirmation first.

### 2.2 Explain Diagnostic
Put the cursor on the type-error diagnostic in `errors_type.m` and run
`Mercury: Explain Diagnostic` — expect a plain-English "Type error"
explanation. Same for the mode error in `errors_mode.m` — expect a
"Mode / instantiation error" explanation.

### 2.3 Call graph compiler cross-check
Re-run `Mercury: Show Predicate Call Graph` now that a compiler is
configured. The toolbar should report whether the workspace compiles
cleanly. Since `errors_type.m`/`errors_mode.m`/`errors_undefined.m` are
still broken, expect **some nodes flagged with a ⚠** and the toolbar
reporting real compiler-found problems.

### 2.4 Mercury Playground
`Mercury: Run File` on `hello.m` — should compile and run it in an
isolated temp directory, showing real stdout. `Mercury: Run Selection` —
select a self-contained goal like `X = 1 + 1` in a scratch spot and run it.
`Mercury: Run Predicate` on `square/1` or `is_even/2` in
`playground_demo.m` (via the CodeLens link or command palette with cursor
on the declaration) — you'll be prompted for input values.

### 2.5 Extract Predicate
In `consumer.m`, select the two marked lines (`Doubled = add(...)` through
`Squared = Doubled * Doubled,`) and run `Mercury: Extract Predicate`. Give
it a name. It should apply the edit, then **automatically run
`mmc --errorcheck-only`** and report whether it compiles — expect success
here. Undo afterward if you want to keep the file pristine for re-testing.

### 2.6 Inline Predicate
In `consumer.m`, place the cursor on the `double_plus_one(5, Result)` call
(marked in a comment above it) and run `Mercury: Inline Predicate`. It
should replace the call with an inlined, alpha-renamed conjunction and
auto-verify with `mmc`. Undo afterward.

**Negative test**: try `Mercury: Inline Predicate` on a call to
`sum_list` instead — it should **refuse**, explaining that `sum_list` has
more than one clause (this is a real safety check, not a bug).

### 2.7 Debug with mdb (Terminal) — reliable
`Mercury: Debug with mdb (Terminal)` on `debug_target.m`. This builds a
debug-grade executable and opens real `mdb` in a VS Code terminal. Try
`break factorial/1`, `continue`, `step`, `print R` — this is the actual
Mercury debugger; refer to `mdb`'s own `help` command for its syntax.

### 2.8 Start Experimental Debug Session (mdb) — best-effort
`Mercury: Start Experimental Debug Session (mdb)` on `debug_target.m`.
Confirm the experimental-session warning. Try setting a breakpoint on the
`factorial` line, then Continue/Step Over/Step Into from the debug
toolbar, and check the Call Stack / Variables panels.

**This is the least-verified feature in the whole extension** — the
commands it sends to `mdb` are well-documented, but the *parsing* of
`mdb`'s trace/stack/variable output was never checked against a real
`mdb` (see the README's Limitations section and
`docs/compiler-integration.md`). If breakpoints don't stop correctly, or
the Variables panel is empty/garbled: that's exactly the kind of gap this
manual pass is meant to surface. **The Debug Console always shows mdb's
raw, unmodified output alongside the structured views** — check there
first if the structured UI seems wrong, and fall back to 2.7 if this
doesn't work well enough to use.

### 2.9 Performance Profile / Deep Profile
These need profiling data this checklist can't pre-generate (it depends
on your Mercury installation's grades). Follow the on-screen instructions
in `Mercury: Open Performance Profile` / `Mercury: Open Deep Profile` —
briefly: rebuild `debug_target` with a profiling grade
(`mmc --make --grade asm_fast.gc.prof debug_target` for classic profiling,
or `--deep-profiling` for the interactive deep profiler), run it once,
then reopen the relevant command from this folder.

---

## Reporting what you find

For anything that doesn't match the expected behavior above, the most
useful details are: which numbered step, what you saw vs. expected, and
(for anything compiler/mdb-related) the raw text from the "Mercury
Compiler" output channel or the Debug Console — since several parts of
this extension were built without a live Mercury installation to verify
against (see the README), raw tool output is usually the fastest way to
tell whether it's a real bug or an environment difference.
