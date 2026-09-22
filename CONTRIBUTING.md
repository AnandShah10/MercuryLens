# Contributing to MercuryLens

Thanks for considering contributing. This project follows a few
non-negotiable engineering principles (see `docs/architecture.md` and
`docs/compiler-integration.md` for the full reasoning) — please read those
before proposing a change that touches compiler integration, the parser,
or any feature that presents information to the user as fact:

- **Never fabricate compiler output, syntax, or semantics.** If something
  requires real semantic analysis (type inference, mode correctness,
  determinism verification), defer to `mmc` rather than guessing. If
  `mmc` isn't available, degrade explicitly and say so in the UI — don't
  silently produce a plausible-looking but unverified answer.
- **Never ship a control that does nothing.** A button, breakpoint, or
  panel that looks functional but isn't is worse than not having the
  feature at all. If something is best-effort or experimental, label it
  as such in its command title/UI text, not just in a doc file.
- **Prefer a heuristic that clearly states its own boundary over a
  "smarter" heuristic that might be silently wrong.** See
  `docs/language-server.md`'s call-graph section for the standard this
  project holds itself to: heuristics are fine, but the user should always
  be able to tell what's compiler-verified vs. not.

## Getting started

See `docs/development.md` for the full build/test/package workflow. In short:

```bash
npm install
npm run compile      # esbuild dev build
npm run test:unit    # ~140 tests, no VS Code or mmc dependency
npm run lint
```

Press F5 in VS Code to launch the Extension Development Host against
`fixtures/multi_module/`, or open `manual-test-workspace/` in a real VS
Code window and work through `TESTING_CHECKLIST.md` for anything that
needs actual clicking-through.

## Before opening a PR

1. `npm run typecheck && npm run lint && npm run test:unit` all pass.
2. New logic has unit tests. This project's convention: pure, testable
   logic lives in a `vscode`-free module (see
   `extension/src/utils/extractPredicateHeuristics.ts` or
   `server/src/modes/modeInfo.ts` for examples); thin `vscode`-dependent
   glue in `commands/`/`server.ts` calls into it. Write the test against
   the pure module, not by trying to mock `vscode`.
3. If you're touching anything that talks to `mmc` or `mdb`, and you have
   a real Mercury installation to verify against, please do — large parts
   of this project were built and tested without one (no Mercury
   installation was available in the environment this was originally
   built in), so genuine verification against the real tools is one of
   the most valuable things a contribution can do. Say in the PR
   description what you verified and how.
4. Update the relevant doc (`README.md`'s Limitations section,
   `docs/compiler-integration.md`, `docs/language-server.md`, or
   `docs/development.md`) if your change resolves or introduces a
   limitation. Don't leave a fixed limitation documented as still
   present, and don't leave a new one undocumented — see `CHANGELOG.md`
   for the level of detail expected (what was wrong, what's true now).

## Reporting a bug

The most useful bug reports for this project include:
- Which command/feature, and the exact steps.
- For anything compiler-related: the raw text from the "Mercury Compiler"
  output channel.
- For anything `mdb`/debugging-related: the raw text from the Debug
  Console (the experimental debug bridge always forwards mdb's
  unmodified output there — see `docs/compiler-integration.md#debugging`).
- Your Mercury compiler version (`mmc --version`) and platform.

If you're not sure whether something is a bug or a documented limitation,
check `README.md`'s Limitations section and the relevant `docs/*.md` file
first — several behaviors that look like bugs are deliberate, stated
scope boundaries (e.g. Inline Predicate's safe subset, or the call graph's
static-text heuristic).

## Code style

- Strong TypeScript typing; avoid `any` (one pre-existing exception is
  tracked, not a precedent to extend).
- Small, focused modules over large ones — if a file is doing LSP/vscode
  glue *and* nontrivial logic, the logic probably belongs in its own
  module (see `docs/architecture.md`'s "Keeping server.ts thin" section
  for the rationale and the refactor that enforced it).
- No `TODO` placeholders for core functionality, no "coming soon" UI.
