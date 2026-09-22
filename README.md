# <img src="media/mercury.svg" width="64" height="64" alt="Mercury" /> Mercury Language Tools

<p align="center">
  <a href="https://github.com/AnandShah10/MercuryLens/blob/main/LICENSE">
    <img src="https://img.shields.io/github/license/AnandShah10/MercuryLens?color=blue&logo=github" alt="License: MIT" />
  </a>
  <a href="https://github.com/AnandShah10/MercuryLens/stargazers">
    <img src="https://img.shields.io/github/stars/AnandShah10/MercuryLens?color=yellow&logo=github" alt="GitHub stars" />
  </a>
  <a href="https://github.com/AnandShah10/MercuryLens/issues">
    <img src="https://img.shields.io/github/issues/AnandShah10/MercuryLens?color=orange&logo=github" alt="GitHub issues" />
  </a>
  <a href="https://github.com/AnandShah10/MercuryLens/commits/main">
    <img src="https://img.shields.io/github/last-commit/AnandShah10/MercuryLens?logo=github" alt="Last commit" />
  </a>
</p>

**A comprehensive Mercury development environment for VS Code**: syntax highlighting, full language server, real `mmc` compiler integration, advanced analysis tools, interactive visualizations, refactoring, debugging, and an in-editor Playground.

> Mercury Tools is transparent about its capabilities — every feature clearly indicates whether it requires the Mercury compiler (`mmc`).

**Made with love by Anand Shah for Mercury developer community** ❤️

## Features

- **Syntax highlighting** for modules, predicates/functions, types, modes,
  determinism/purity keywords, pragmas, DCGs, and more (`syntax/mercury.tmLanguage.json`)
- **Language server**: completion, hover, go-to-definition, find references,
  rename, document/workspace symbols, CodeLens, semantic tokens, signature
  help, code actions, formatting
- **Real compiler integration**: detects `mmc`, runs `--errorcheck-only` for
  diagnostics, `--make` for build/run, `--generate-dependencies` for module
  deps — never fabricates compiler output, and falls back to clearly-labeled
  syntactic checks when `mmc` isn't installed
- **Mode / instantiation visualization** (`Mercury: Show Mode Information`)
- **Determinism analysis** (`Mercury: Show Determinism`, and a CodeLens on
  every predicate/function)
- **Type exploration** (`Mercury: Show Type Information`)
- **Predicate call graph** — interactive, pan/zoom/search/filter, and
  cross-checked against real `mmc` output when a compiler is available
  (`Mercury: Show Predicate Call Graph`)
- **Module dependency graph** with cycle detection
  (`Mercury: Show Module Dependencies`)
- **AST Explorer** — synced source/AST panes, click either way, copy AST as
  JSON (`Mercury: Open AST Explorer`)
- **Mercury Playground** — Run File / Run Selection / Run Predicate, all via
  real compilation in an isolated temp directory
- **Debug with mdb** — a terminal command (100% reliable) plus an
  **experimental** Debug Adapter Protocol bridge so VS Code's breakpoint
  gutters and step/continue toolbar drive real `mdb` (see
  [Limitations](#limitations) for exactly what's verified vs. best-effort)
- **Compiler error explanations** for well-understood diagnostic categories
  (`Mercury: Explain Diagnostic`)
- **Documentation generator** — Markdown from your declarations + doc
  comments (`Mercury: Generate Documentation`)
- **Safe refactoring**: rename, organize imports (remove unused), extract
  predicate, inline predicate (see [Limitations](#limitations) re:
  mode-inference heuristics and the safe subset each operates on)
- **Performance profiling**: classic `mprof` reports, and a real
  interactive **Deep Profile** view driven by `mdprof_cgi` itself (no web
  server required — see `docs/compiler-integration.md#deep-profiling-mercury-open-deep-profile`),
  with clear instructions when no profiling data exists yet
- A **Mercury sidebar** (Workspace / Diagnostics / Compiler views), status
  bar compiler status, and Problems-panel integration

## Prerequisites

- VS Code **1.85.0** or newer
- [Mercury compiler](https://mercurylang.org) (`mmc`) **strongly recommended** for full functionality (auto-detected from PATH or set via `mercuryTools.compilerPath`)

Without `mmc`, core editing features (highlighting, structural LSP features, AST Explorer) continue to work. Compiler-dependent features (diagnostics, build, run, analysis, profiling) show clear messages explaining the limitation.

## Quick Start

1. Install **Mercury Language Tools** from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=AnandShah.MercuryLens)
2. Open or create a Mercury project containing `.m` files
3. The extension automatically detects your Mercury compiler and shows status in the status bar
4. Open the Command Palette (`Ctrl+Shift+P`) and try **Mercury: Open Playground** or **Mercury: Show Call Graph**
5. Use the Mercury icon in the Activity Bar for Workspace, Diagnostics, and Compiler views

## Installation

### Marketplace (Recommended)

Search for **Mercury Language Tools** by AnandShah in the VS Code Extensions view (`Ctrl+Shift+X` or `Cmd+Shift+X` on macOS) and click Install.

**Direct link**: [Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=AnandShah.MercuryLens)

### From VSIX

```bash
code --install-extension MercuryLens.vsix
```

Or use the "Extensions: Install from VSIX..." command in VS Code.

See the [GitHub repository](https://github.com/AnandShah10/MercuryLens) to build from source or download the latest VSIX.

## Configuration

The extension is highly configurable via VS Code settings (search for "mercury" in Settings). Key options:

| Setting | Default | Description |
|---------|---------|-------------|
| `compilerPath` | `""` | Path to `mmc`. Leave empty to auto-detect from `PATH`. |
| `enableDiagnostics` | `true` | Enable compiler-backed (or syntactic fallback) diagnostics. |
| `enableSemanticTokens` | `true` | Enable advanced semantic syntax highlighting. |
| `showModeInformation` | `true` | Show mode/instantiation details in hovers. |
| `showDeterminismCodeLens` | `true` | Show determinism and purity above predicates/functions. |
| `showCallGraphCodeLens` | `true` | Show caller counts and "Run Predicate" CodeLens. |
| `enableProfiling` | `false` | Enable performance profiling views. |
| `trace.server` | `"off"` | LSP server trace level (`off` / `messages` / `verbose`). |
| `autoBuild` | `false` | Automatically check project on file save. |
| `formatter.enabled` | `true` | Enable basic clause formatting. |

Full configuration and more advanced options are available in the extension settings UI.

## Commands

All commands appear in the Command Palette with the **Mercury:** prefix (e.g. **Mercury: Show Predicate Call Graph**, **Mercury: Extract Predicate**, **Mercury: Open AST Explorer**). See the full list in `package.json` or by typing "Mercury" in the Command Palette.

## Screenshots

> **Screenshots and animated GIFs should be added here before publishing to the VS Code Marketplace.** Recommended images/GIFs:
>
> - Editor showing syntax highlighting, semantic tokens, CodeLens, hovers, and refactoring
> - Interactive Predicate **Call Graph** (with pan, zoom, search, filter)
> - **AST Explorer** with synchronized source and tree views
> - **Mercury sidebar** (Workspace tree, Diagnostics, Compiler status)
> - Deep Profile viewer and Playground in action

*(High quality visuals are one of the most important factors for a successful VS Code Marketplace listing.)*

## Documentation

- **[Architecture](docs/architecture.md)** — Extension/server architecture and parser design
- **[Compiler Integration](docs/compiler-integration.md)** — How `mmc` is used (and what happens without it)
- **[Language Server](docs/language-server.md)** — LSP capabilities and heuristics
- **[Development](docs/development.md)** — Building, testing, packaging
- **[CHANGELOG](CHANGELOG.md)** — What's new in each release
- **[Contributing](CONTRIBUTING.md)** — Guidelines and engineering principles

For troubleshooting, see the docs above or the [GitHub Issues](https://github.com/AnandShah10/MercuryLens/issues).

## Limitations

All limitations are documented in detail in the linked docs. In summary:
- Full functionality requires the Mercury compiler (`mmc`)
- Experimental mdb debug adapter has some documented assumptions (terminal mdb command is 100% reliable)
- Parser is structural (declaration/clause level)
- Call graph uses a verified heuristic with cross-checks against compiler output where possible
- Refactorings (extract/inline) are conservative and auto-verified by the compiler when available

## License

MIT — see [LICENSE](LICENSE).

---

**Made with love by Anand Shah for Mercury developer community** ❤️
