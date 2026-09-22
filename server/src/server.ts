import {
    createConnection,
    ProposedFeatures,
    TextDocuments,
    InitializeParams,
    InitializeResult,
    TextDocumentSyncKind,
    Diagnostic,
    DiagnosticSeverity,
    CompletionItem,
    CompletionItemKind,
    TextDocumentPositionParams,
    Hover,
    Location,
    DefinitionParams,
    ReferenceParams,
    RenameParams,
    WorkspaceEdit,
    DocumentSymbolParams,
    DocumentSymbol,
    SymbolKind,
    WorkspaceSymbolParams,
    SymbolInformation,
    CodeLens,
    CodeLensParams,
    SemanticTokensParams,
    SemanticTokensBuilder,
    SemanticTokensLegend,
    DocumentFormattingParams,
    TextEdit,
    SignatureHelpParams,
    SignatureHelp,
    CodeActionParams,
    CodeAction,
    CodeActionKind,
    Range as LspRange,
    Position,
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { URI } from 'vscode-uri';

import { WorkspaceAnalyzer } from './analyzer/workspaceAnalyzer';
import { explainDiagnostic } from './diagnostics/explainer';
import { CallGraphCache } from './cache/callGraphCache';
import { findReferences, computeRenameEdits, validateRenameTarget } from './references/referenceFinder';
import { buildImportGraph } from './dependency/dependencyGraph';
import { formatModeSection } from './modes/modeInfo';
import { describeDeterminism } from './determinism/determinismInfo';
import { formatTypeHover } from './types/typeInfo';
import { ModuleDoc, SymbolNode, ClauseNode } from './parser/ast';

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);

// The analyzer owns the workspace index and the compiler adapter; server.ts
// only owns LSP wiring (connection events, LSP-typed request/response
// shapes) and delegates actual analysis to analyzer/ + the small per-domain
// modules (types/, modes/, determinism/, references/, dependency/, cache/).
// See docs/architecture.md.
const analyzer = new WorkspaceAnalyzer();
const index = analyzer.index;
const compiler = analyzer.compiler;
const callGraphCache = new CallGraphCache();

interface Settings {
    compilerPath: string;
    compilerArguments: string[];
    enableDiagnostics: boolean;
    enableSemanticTokens: boolean;
    showModeInformation: boolean;
    showDeterminismCodeLens: boolean;
    showCallGraphCodeLens: boolean;
    maxAnalysisTime: number;
    formatterEnabled: boolean;
}

const DEFAULT_SETTINGS: Settings = {
    compilerPath: '',
    compilerArguments: [],
    enableDiagnostics: true,
    enableSemanticTokens: true,
    showModeInformation: true,
    showDeterminismCodeLens: true,
    showCallGraphCodeLens: true,
    maxAnalysisTime: 10000,
    formatterEnabled: true,
};
let settings: Settings = { ...DEFAULT_SETTINGS };
let workspaceRoot: string | undefined;

const SEMANTIC_TOKEN_TYPES = ['namespace', 'type', 'class', 'function', 'variable', 'keyword', 'parameter', 'property'];
const semanticLegend: SemanticTokensLegend = { tokenTypes: SEMANTIC_TOKEN_TYPES, tokenModifiers: [] };

connection.onInitialize((params: InitializeParams): InitializeResult => {
    workspaceRoot = params.workspaceFolders?.[0]?.uri ? URI.parse(params.workspaceFolders[0].uri).fsPath : undefined;
    return {
        capabilities: {
            textDocumentSync: TextDocumentSyncKind.Incremental,
            completionProvider: { resolveProvider: false, triggerCharacters: ['.', ':'] },
            hoverProvider: true,
            definitionProvider: true,
            referencesProvider: true,
            renameProvider: { prepareProvider: false },
            documentSymbolProvider: true,
            workspaceSymbolProvider: true,
            codeLensProvider: { resolveProvider: false },
            documentFormattingProvider: true,
            signatureHelpProvider: { triggerCharacters: ['('] },
            codeActionProvider: { codeActionKinds: [CodeActionKind.QuickFix, CodeActionKind.SourceOrganizeImports] },
            semanticTokensProvider: {
                legend: semanticLegend,
                full: true,
            },
        },
    };
});

connection.onInitialized(async () => {
    connection.console.log('Mercury language server initialized.');
    await reindexWorkspace();
});

async function reindexWorkspace(): Promise<number> {
    if (!workspaceRoot) return 0;
    const count = await analyzer.indexWorkspace(workspaceRoot, (msg) => connection.console.warn(msg));
    connection.console.log(`Mercury: indexed ${count} file(s) under ${workspaceRoot}.`);
    return count;
}

connection.onDidChangeConfiguration((change) => {
    const cfg = (change.settings as { mercuryTools?: Partial<Settings> & { compilerPath?: string; compilerArguments?: string[]; enableDiagnostics?: boolean; enableSemanticTokens?: boolean; showModeInformation?: boolean; showDeterminismCodeLens?: boolean; showCallGraphCodeLens?: boolean; maxAnalysisTime?: number; formatter?: { enabled?: boolean } } })?.mercuryTools;
    if (cfg) {
        settings = {
            compilerPath: cfg.compilerPath ?? settings.compilerPath,
            compilerArguments: cfg.compilerArguments ?? settings.compilerArguments,
            enableDiagnostics: cfg.enableDiagnostics ?? settings.enableDiagnostics,
            enableSemanticTokens: cfg.enableSemanticTokens ?? settings.enableSemanticTokens,
            showModeInformation: cfg.showModeInformation ?? settings.showModeInformation,
            showDeterminismCodeLens: cfg.showDeterminismCodeLens ?? settings.showDeterminismCodeLens,
            showCallGraphCodeLens: cfg.showCallGraphCodeLens ?? settings.showCallGraphCodeLens,
            maxAnalysisTime: cfg.maxAnalysisTime ?? settings.maxAnalysisTime,
            formatterEnabled: cfg.formatter?.enabled ?? settings.formatterEnabled,
        };
        compiler.setConfiguredPath(settings.compilerPath || undefined);
    }
    for (const doc of documents.all()) void validateDocument(doc);
});

documents.onDidOpen((e) => {
    index.update(e.document.uri, e.document.getText());
    void validateDocument(e.document);
});
documents.onDidChangeContent((e) => {
    index.update(e.document.uri, e.document.getText());
    void validateDocument(e.document);
});
documents.onDidClose((e) => {
    connection.sendDiagnostics({ uri: e.document.uri, diagnostics: [] });
});

const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
async function validateDocument(doc: TextDocument): Promise<void> {
    if (!settings.enableDiagnostics) {
        connection.sendDiagnostics({ uri: doc.uri, diagnostics: [] });
        return;
    }
    const existing = debounceTimers.get(doc.uri);
    if (existing) clearTimeout(existing);
    debounceTimers.set(
        doc.uri,
        setTimeout(() => void runValidation(doc), 300),
    );
}

async function runValidation(doc: TextDocument): Promise<void> {
    const analyzerDiagnostics = await analyzer.computeDiagnostics(doc.uri, doc.getText(), workspaceRoot, {
        compilerArguments: settings.compilerArguments,
        maxAnalysisTime: settings.maxAnalysisTime,
    });
    const severityMap: Record<'error' | 'warning' | 'info', DiagnosticSeverity> = {
        error: DiagnosticSeverity.Error,
        warning: DiagnosticSeverity.Warning,
        info: DiagnosticSeverity.Information,
    };
    const diagnostics: Diagnostic[] = analyzerDiagnostics.map((d) => ({
        range: LspRange.create(Position.create(d.range.startLine, d.range.startCol), Position.create(d.range.endLine, d.range.endCol)),
        severity: severityMap[d.severity],
        message: d.message,
        source: d.source,
    }));
    connection.sendDiagnostics({ uri: doc.uri, diagnostics });
}

function wordAt(doc: TextDocument, position: Position): { word: string; range: LspRange } | undefined {
    const text = doc.getText();
    const offset = doc.offsetAt(position);
    const isWordChar = (c: string) => /[A-Za-z0-9_.]/.test(c);
    let start = offset;
    let end = offset;
    while (start > 0 && isWordChar(text[start - 1])) start--;
    while (end < text.length && isWordChar(text[end])) end++;
    if (start === end) return undefined;
    return { word: text.slice(start, end), range: LspRange.create(doc.positionAt(start), doc.positionAt(end)) };
}

function signatureLabel(sym: SymbolNode): string {
    const kw = sym.kind === 'function' ? 'func' : 'pred';
    const args = (sym.args ?? []).map((a) => [a.type, a.mode].filter(Boolean).join('::')).join(', ');
    const det = sym.determinism ? ` is ${sym.determinism}` : '';
    const purity = sym.purity ? `${sym.purity} ` : '';
    return `:- ${purity}${kw} ${sym.name}(${args})${det}.`;
}

// ---------- Completion ----------
const KEYWORDS = [
    'module', 'interface', 'implementation', 'end_module', 'import_module', 'use_module', 'include_module',
    'pred', 'func', 'mode', 'type', 'typeclass', 'instance', 'pragma', 'where', 'is',
    'det', 'semidet', 'multi', 'nondet', 'failure', 'erroneous', 'cc_multi', 'cc_nondet',
    'in', 'out', 'di', 'uo', 'mdi', 'muo', 'unused', 'ground', 'free', 'bound',
    'pure', 'semipure', 'impure', 'if', 'then', 'else', 'not', 'true', 'fail', 'some', 'all',
    'initialise', 'finalise', 'promise_pure', 'promise_semipure', 'promise_impure',
];

connection.onCompletion((params: TextDocumentPositionParams): CompletionItem[] => {
    const doc = documents.get(params.textDocument.uri);
    if (!doc) return [];
    const lineText = doc.getText(LspRange.create(Position.create(params.position.line, 0), params.position));
    const items: CompletionItem[] = [];

    for (const kw of KEYWORDS) {
        items.push({ label: kw, kind: CompletionItemKind.Keyword });
    }

    // module-qualified completion: "modname." -> members of that module
    const qualifiedMatch = lineText.match(/([A-Za-z_][A-Za-z0-9_]*)\.\s*$/);
    if (qualifiedMatch) {
        const modName = qualifiedMatch[1];
        const modDoc = index.findModule(modName);
        if (modDoc) {
            for (const sym of modDoc.symbols) {
                if (sym.kind === 'predicate' || sym.kind === 'function') {
                    items.push({
                        label: sym.name,
                        kind: sym.kind === 'function' ? CompletionItemKind.Function : CompletionItemKind.Method,
                        detail: signatureLabel(sym),
                        documentation: sym.doc?.text,
                    });
                }
            }
        }
        return items;
    }

    // imported/local modules for qualification
    const parsedDoc = index.get(doc.uri);
    const importedModules = new Set<string>([...(parsedDoc?.imports ?? []), ...(parsedDoc?.useModules ?? [])]);
    for (const mod of importedModules) {
        items.push({ label: mod, kind: CompletionItemKind.Module });
    }

    // workspace predicates/functions/types visible from imports + own module
    for (const d of index.allDocs()) {
        const inScope = d.uri === doc.uri || (d.moduleName && importedModules.has(d.moduleName));
        if (!inScope) continue;
        for (const sym of d.symbols) {
            if (sym.kind === 'predicate' || sym.kind === 'function') {
                items.push({
                    label: sym.name,
                    kind: sym.kind === 'function' ? CompletionItemKind.Function : CompletionItemKind.Method,
                    detail: signatureLabel(sym),
                    documentation: sym.doc?.text,
                });
            } else if (sym.kind === 'type') {
                items.push({ label: sym.name, kind: CompletionItemKind.Class, detail: `type ${sym.name}` });
            } else if (sym.kind === 'typeclass') {
                items.push({ label: sym.name, kind: CompletionItemKind.Interface, detail: `typeclass ${sym.name}` });
            }
        }
    }

    // local variables in the current clause context
    if (parsedDoc) {
        const clause = parsedDoc.clauses.find((c) => c.range.startLine <= params.position.line && params.position.line <= c.range.endLine);
        if (clause) {
            const seen = new Set<string>();
            for (const v of clause.variableOccurrences) {
                if (!seen.has(v.name)) {
                    seen.add(v.name);
                    items.push({ label: v.name, kind: CompletionItemKind.Variable });
                }
            }
        }
    }

    return items;
});

// ---------- Hover ----------
connection.onHover((params): Hover | null => {
    const doc = documents.get(params.textDocument.uri);
    if (!doc) return null;
    const w = wordAt(doc, params.position);
    if (!w) return null;

    const declarations = index.findDeclarations(w.word);
    if (declarations.length > 0) {
        const parts = declarations.map(({ symbol }) => {
            const lines = [`\`\`\`mercury\n${signatureLabel(symbol)}\n\`\`\``];
            if (symbol.determinism) lines.push(`**Determinism:** ${symbol.determinism} — ${describeDeterminism(symbol.determinism)}`);
            lines.push(`**Purity:** ${symbol.purity ?? 'pure'}`);
            if (symbol.doc?.text) lines.push(symbol.doc.text);
            if (settings.showModeInformation) {
                const modeSection = formatModeSection(symbol);
                if (modeSection) lines.push(modeSection);
            }
            return lines.join('\n\n');
        });
        return { contents: { kind: 'markdown', value: parts.join('\n\n---\n\n') } };
    }

    const types = index.findNonCallable(w.word, ['type']);
    if (types.length > 0) {
        return { contents: { kind: 'markdown', value: formatTypeHover(types[0].symbol).markdown } };
    }

    // Variable: report what we can determine syntactically (its declared
    // mode if it lines up with an argument position is beyond this parser's
    // scope; we report ground/free only when unambiguous from a direct
    // unification we can see, otherwise say so honestly).
    const parsedDoc = index.get(doc.uri);
    if (parsedDoc && /^[A-Z_]/.test(w.word)) {
        const clause = parsedDoc.clauses.find((c) => c.range.startLine <= params.position.line && params.position.line <= c.range.endLine);
        if (clause && clause.variableOccurrences.some((v) => v.name === w.word)) {
            const isHeadVar = clause.headVars.includes(w.word);
            return {
                contents: {
                    kind: 'markdown',
                    value: `**${w.word}**\n\nVariable in clause \`${clause.name}/${clause.arity}\`.${
                        isHeadVar
                            ? ' Appears in the clause head; its mode is determined by the corresponding argument in the predicate/function\'s `:- pred`/`:- func` declaration.'
                            : ' Local to this clause. Precise instantiation state requires mode analysis, which this extension defers to `mmc` diagnostics rather than guessing.'
                    }`,
                },
            };
        }
    }

    return null;
});

// ---------- Definition ----------
connection.onDefinition((params: DefinitionParams): Location[] => {
    const doc = documents.get(params.textDocument.uri);
    if (!doc) return [];
    const w = wordAt(doc, params.position);
    if (!w) return [];
    const locations: Location[] = [];
    for (const { symbol, uri } of index.findDeclarations(w.word)) {
        locations.push(Location.create(uri, LspRange.create(
            Position.create(symbol.nameRange.startLine, symbol.nameRange.startCol),
            Position.create(symbol.nameRange.endLine, symbol.nameRange.endCol),
        )));
    }
    for (const { symbol, uri } of index.findNonCallable(w.word, ['type', 'typeclass', 'instance', 'module'])) {
        locations.push(Location.create(uri, LspRange.create(
            Position.create(symbol.nameRange.startLine, symbol.nameRange.startCol),
            Position.create(symbol.nameRange.endLine, symbol.nameRange.endCol),
        )));
    }
    return locations;
});

// ---------- References ----------
connection.onReferences((params: ReferenceParams): Location[] => {
    const doc = documents.get(params.textDocument.uri);
    if (!doc) return [];
    const w = wordAt(doc, params.position);
    if (!w) return [];
    return findReferences(index, w.word).map(({ uri, range }) =>
        Location.create(uri, LspRange.create(Position.create(range.startLine, range.startCol), Position.create(range.endLine, range.endCol))),
    );
});

// ---------- Rename ----------
connection.onRenameRequest((params: RenameParams): WorkspaceEdit | null => {
    const doc = documents.get(params.textDocument.uri);
    if (!doc) return null;
    const w = wordAt(doc, params.position);
    if (!w) return null;
    if (!validateRenameTarget(params.newName).valid) return null;

    const changes: Record<string, TextEdit[]> = {};
    for (const { uri, range } of computeRenameEdits(index, w.word)) {
        changes[uri] = changes[uri] ?? [];
        changes[uri].push(TextEdit.replace(
            LspRange.create(Position.create(range.startLine, range.startCol), Position.create(range.endLine, range.endCol)),
            params.newName,
        ));
    }
    return { changes };
});

// ---------- Document Symbols ----------
connection.onDocumentSymbol((params: DocumentSymbolParams): DocumentSymbol[] => {
    const doc = index.get(params.textDocument.uri);
    if (!doc) return [];
    return doc.symbols
        .filter((s) => s.kind !== 'import' && s.kind !== 'use_module' && s.kind !== 'unknown')
        .map((s) => toDocumentSymbol(s));
});

function toDocumentSymbol(s: SymbolNode): DocumentSymbol {
    const kindMap: Partial<Record<SymbolNode['kind'], SymbolKind>> = {
        module: SymbolKind.Module,
        predicate: SymbolKind.Method,
        function: SymbolKind.Function,
        type: SymbolKind.Class,
        typeclass: SymbolKind.Interface,
        instance: SymbolKind.Interface,
        mode: SymbolKind.Property,
        pragma: SymbolKind.Constant,
        initialise: SymbolKind.Event,
        finalise: SymbolKind.Event,
    };
    const range = LspRange.create(Position.create(s.range.startLine, s.range.startCol), Position.create(s.range.endLine, s.range.endCol));
    const selRange = LspRange.create(Position.create(s.nameRange.startLine, s.nameRange.startCol), Position.create(s.nameRange.endLine, s.nameRange.endCol));
    return DocumentSymbol.create(
        s.arity !== undefined ? `${s.name}/${s.arity}` : s.name,
        s.kind,
        kindMap[s.kind] ?? SymbolKind.Object,
        range,
        selRange,
    );
}

// ---------- Workspace Symbols ----------
connection.onWorkspaceSymbol((params: WorkspaceSymbolParams): SymbolInformation[] => {
    const query = params.query.toLowerCase();
    const results: SymbolInformation[] = [];
    for (const d of index.allDocs()) {
        for (const s of d.symbols) {
            if (s.kind === 'import' || s.kind === 'use_module') continue;
            if (query && !s.name.toLowerCase().includes(query)) continue;
            results.push(SymbolInformation.create(
                s.arity !== undefined ? `${s.name}/${s.arity}` : s.name,
                (toDocumentSymbol(s).kind),
                LspRange.create(Position.create(s.nameRange.startLine, s.nameRange.startCol), Position.create(s.nameRange.endLine, s.nameRange.endCol)),
                d.uri,
                d.moduleName,
            ));
        }
    }
    return results.slice(0, 500);
});

// ---------- CodeLens ----------
connection.onCodeLens((params: CodeLensParams): CodeLens[] => {
    const doc = index.get(params.textDocument.uri);
    if (!doc) return [];
    const lenses: CodeLens[] = [];
    for (const sym of doc.symbols) {
        if (sym.kind !== 'predicate' && sym.kind !== 'function') continue;
        const range = LspRange.create(Position.create(sym.range.startLine, 0), Position.create(sym.range.startLine, 1));
        if (settings.showDeterminismCodeLens) {
            const label = `${sym.determinism ?? 'determinism unknown'} • ${sym.purity ?? 'pure'}`;
            lenses.push(CodeLens.create(range, undefined));
            lenses[lenses.length - 1].command = { title: label, command: 'mercuryTools.showDeterminism', arguments: [params.textDocument.uri, sym.name, sym.arity] };
        }
        if (settings.showCallGraphCodeLens) {
            const callSiteArity = sym.kind === 'function' && sym.arity !== undefined ? Math.max(0, sym.arity - 1) : sym.arity;
            const callers = index.countCallers(sym.name, callSiteArity);
            const refs = index.countReferences(sym.name, callSiteArity);
            lenses.push(CodeLens.create(range, undefined));
            lenses[lenses.length - 1].command = {
                title: `${callers} caller${callers === 1 ? '' : 's'} • ${refs} reference${refs === 1 ? '' : 's'}`,
                command: 'mercuryTools.showCallGraph',
                arguments: [params.textDocument.uri, sym.name, sym.arity],
            };
            lenses.push(CodeLens.create(range, undefined));
            lenses[lenses.length - 1].command = { title: 'Run Predicate', command: 'mercuryTools.runPredicate', arguments: [params.textDocument.uri, sym.name, sym.arity] };
        }
    }
    return lenses;
});

// ---------- Formatting ----------
connection.onDocumentFormatting((params: DocumentFormattingParams): TextEdit[] => {
    if (!settings.formatterEnabled) return [];
    const doc = documents.get(params.textDocument.uri);
    if (!doc) return [];
    const formatted = formatMercurySource(doc.getText());
    if (formatted === doc.getText()) return [];
    const fullRange = LspRange.create(Position.create(0, 0), doc.positionAt(doc.getText().length));
    return [TextEdit.replace(fullRange, formatted)];
});

/**
 * A conservative, non-destructive formatter: it normalizes indentation of
 * clause-body lines (4-space steps per nesting level from parens/if-then-
 * else/disjunction) and trims trailing whitespace. It deliberately does NOT
 * reflow expressions, realign operators, or otherwise rewrite term
 * structure — Mercury's operator-precedence grammar means a fully general
 * pretty-printer needs the compiler's own parser to avoid corrupting valid
 * programs. See docs/development.md for this scope decision.
 */
function formatMercurySource(source: string): string {
    const lines = source.split(/\r\n|\r|\n/);
    const out: string[] = [];
    let depth = 0;
    for (const rawLine of lines) {
        const line = rawLine.replace(/[ \t]+$/, '');
        const trimmed = line.trim();
        if (trimmed.length === 0) { out.push(''); continue; }
        let lineDepth = depth;
        if (/^(else|then|\)|\]|\})/.test(trimmed)) lineDepth = Math.max(0, depth - 1);
        if (trimmed.startsWith('%')) {
            out.push('    '.repeat(lineDepth) + trimmed);
            continue;
        }
        out.push('    '.repeat(lineDepth) + trimmed);
        for (const ch of trimmed) {
            if (ch === '(' || ch === '[' || ch === '{') depth++;
            else if (ch === ')' || ch === ']' || ch === '}') depth = Math.max(0, depth - 1);
        }
        if (/\b(if)\s*$/.test(trimmed) || /\bthen\s*$/.test(trimmed) || /\belse\s*$/.test(trimmed)) depth++;
        if (trimmed === ')' || /^\)\s*(\.|,)?$/.test(trimmed)) depth = Math.max(0, depth);
    }
    return out.join('\n');
}

// ---------- Signature Help ----------
connection.onSignatureHelp((params: SignatureHelpParams): SignatureHelp | null => {
    const doc = documents.get(params.textDocument.uri);
    if (!doc) return null;
    const lineText = doc.getText(LspRange.create(Position.create(params.position.line, 0), params.position));
    const m = lineText.match(/([A-Za-z_][A-Za-z0-9_.]*)\s*\(([^)]*)$/);
    if (!m) return null;
    const name = m[1].includes('.') ? m[1].slice(m[1].lastIndexOf('.') + 1) : m[1];
    const decls = index.findDeclarations(name);
    if (decls.length === 0) return null;
    const activeParameter = m[2].split(',').length - 1;
    return {
        signatures: decls.map(({ symbol }) => ({
            label: signatureLabel(symbol),
            parameters: (symbol.args ?? []).map((a) => ({ label: a.raw })),
            documentation: symbol.doc?.text,
        })),
        activeSignature: 0,
        activeParameter,
    };
});

// ---------- Code Actions ----------
connection.onCodeAction((params: CodeActionParams): CodeAction[] => {
    const doc = documents.get(params.textDocument.uri);
    const parsedDoc = index.get(params.textDocument.uri);
    if (!doc || !parsedDoc) return [];
    const actions: CodeAction[] = [];

    // Organize imports: dedupe + sort import_module/use_module lines, and
    // drop imports that have zero call-site references to their module's
    // exported names within this file (best-effort; only offered, never
    // applied automatically).
    const importSymbols = parsedDoc.symbols.filter((s) => s.kind === 'import' || s.kind === 'use_module');
    if (importSymbols.length > 1) {
        const text = doc.getText();
        const usedModules = new Set<string>();
        for (const mod of [...parsedDoc.imports, ...parsedDoc.useModules]) {
            const modDoc = index.findModule(mod);
            const exportedNames = modDoc ? modDoc.symbols.filter((s) => s.kind === 'predicate' || s.kind === 'function').map((s) => s.name) : [];
            const qualifiedRe = new RegExp(`\\b${mod.replace('.', '\\.')}\\.`);
            const anyCallRe = exportedNames.length ? new RegExp(`\\b(${exportedNames.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\s*\\(`) : null;
            if (qualifiedRe.test(text) || (anyCallRe && anyCallRe.test(text)) || exportedNames.length === 0) {
                usedModules.add(mod);
            }
        }
        const edits: TextEdit[] = [];
        for (const sym of importSymbols) {
            const kind = sym.kind === 'use_module' ? 'use_module' : 'import_module';
            const kept = (sym.importedModules ?? []).filter((m) => usedModules.has(m));
            const range = LspRange.create(Position.create(sym.range.startLine, sym.range.startCol), Position.create(sym.range.endLine, sym.range.endCol));
            if (kept.length === 0) {
                edits.push(TextEdit.replace(range, ''));
            } else if (kept.length !== (sym.importedModules ?? []).length) {
                edits.push(TextEdit.replace(range, `:- ${kind} ${kept.join(', ')}.`));
            }
        }
        if (edits.length > 0) {
            actions.push({
                title: 'Organize imports (remove unused)',
                kind: CodeActionKind.SourceOrganizeImports,
                edit: { changes: { [params.textDocument.uri]: edits } },
            });
        }
    }

    for (const d of params.context.diagnostics) {
        const explanation = explainDiagnostic(d.message);
        if (explanation) {
            actions.push({
                title: `Explain: ${explanation.category}`,
                kind: CodeActionKind.QuickFix,
                diagnostics: [d],
                command: { title: 'Explain Diagnostic', command: 'mercuryTools.explainDiagnostic', arguments: [explanation] },
            });
        }
    }

    return actions;
});

// ---------- Semantic Tokens ----------
connection.languages.semanticTokens.on((params: SemanticTokensParams) => {
    const builder = new SemanticTokensBuilder();
    if (!settings.enableSemanticTokens) return builder.build();
    const doc = index.get(params.textDocument.uri);
    if (!doc) return builder.build();

    type Tok = { line: number; startCol: number; length: number; type: number };
    const tokens: Tok[] = [];
    const typeIndex = (t: string) => SEMANTIC_TOKEN_TYPES.indexOf(t);

    for (const sym of doc.symbols) {
        let type = -1;
        if (sym.kind === 'module') type = typeIndex('namespace');
        else if (sym.kind === 'predicate') type = typeIndex('function');
        else if (sym.kind === 'function') type = typeIndex('function');
        else if (sym.kind === 'type') type = typeIndex('type');
        else if (sym.kind === 'typeclass' || sym.kind === 'instance') type = typeIndex('class');
        if (type >= 0) {
            tokens.push({ line: sym.nameRange.startLine, startCol: sym.nameRange.startCol, length: sym.nameRange.endCol - sym.nameRange.startCol, type });
        }
    }
    for (const clause of doc.clauses) {
        for (const call of clause.calls) {
            tokens.push({ line: call.range.startLine, startCol: call.range.startCol, length: call.range.endCol - call.range.startCol, type: typeIndex('function') });
        }
        for (const v of clause.variableOccurrences) {
            tokens.push({ line: v.range.startLine, startCol: v.range.startCol, length: v.range.endCol - v.range.startCol, type: typeIndex('variable') });
        }
    }
    tokens.sort((a, b) => a.line - b.line || a.startCol - b.startCol);
    for (const t of tokens) {
        if (t.type < 0 || t.length <= 0) continue;
        builder.push(t.line, t.startCol, t.length, t.type, 0);
    }
    return builder.build();
});

// ---------- Custom requests used by the extension host (not part of core LSP) ----------
connection.onRequest('mercury/compilerStatus', async () => {
    return compiler.detect();
});

connection.onRequest('mercury/callGraph', async (params: { moduleFilter?: string }) => {
    return callGraphCache.get(index, params.moduleFilter);
});

connection.onRequest('mercury/moduleDependencies', async (params: { mainModule: string; cwd: string }) => {
    const result = await compiler.getDependencyInfo(params.mainModule, params.cwd, settings.maxAnalysisTime);
    return {
        success: result.success,
        stderr: result.stderr,
        edges: [...result.edges.entries()].map(([from, to]) => ({ from, to })),
        // Fallback: also derive an approximate dependency graph purely from
        // `:- import_module` / `:- use_module` declarations already indexed,
        // used when mmc isn't available or --generate-dependencies fails.
        importGraph: buildImportGraph(index),
    };
});

connection.onRequest('mercury/ast', async (params: { uri: string }) => {
    return index.get(params.uri) ?? null;
});

connection.onRequest('mercury/moduleDoc', async (params: { uri: string }): Promise<ModuleDoc | null> => {
    return index.get(params.uri) ?? null;
});

connection.onRequest('mercury/explainDiagnostic', (params: { message: string }) => {
    return explainDiagnostic(params.message) ?? null;
});

connection.onRequest('mercury/reindex', async () => {
    const fileCount = await reindexWorkspace();
    return { fileCount };
});

connection.onRequest('mercury/findClauses', (params: { name: string; arity: number }) => {
    // All clauses matching name+arity across the whole workspace, with
    // their owning uri — used by Inline Predicate to enforce "exactly one
    // clause" (a real safety precondition, not a style preference: merging
    // more than one clause into a call site would silently drop Mercury's
    // backtracking-across-clauses semantics).
    const results: { uri: string; clause: ClauseNode }[] = [];
    for (const doc of index.allDocs()) {
        for (const clause of doc.clauses) {
            if (clause.name === params.name && clause.arity === params.arity) {
                results.push({ uri: doc.uri, clause });
            }
        }
    }
    return results;
});

connection.onRequest('mercury/findDeclaration', (params: { name: string; kinds: SymbolNode['kind'][] }) => {
    // Cross-workspace symbol lookup, used by commands (Mode/Type/Determinism
    // Information) invoked with the cursor on a *use* of a symbol rather
    // than its declaration — the declaration may live in a different file
    // than the one currently open. This reuses the same WorkspaceIndex
    // methods `onHover`/`onDefinition` already rely on, so behavior
    // (including module-qualified name resolution, e.g. "list_utils.foo")
    // stays consistent across all of them.
    const callableKinds = params.kinds.filter((k): k is 'predicate' | 'function' => k === 'predicate' || k === 'function');
    const nonCallableKinds = params.kinds.filter((k) => k !== 'predicate' && k !== 'function');
    const results: { symbol: SymbolNode; uri: string }[] = [];
    const callableKindsSet = new Set<string>(callableKinds);
    if (callableKinds.length > 0) {
        results.push(...index.findDeclarations(params.name).filter((r) => callableKindsSet.has(r.symbol.kind)));
    }
    if (nonCallableKinds.length > 0) {
        results.push(...index.findNonCallable(params.name, nonCallableKinds));
    }
    return results[0] ?? null;
});

documents.listen(connection);
connection.listen();
