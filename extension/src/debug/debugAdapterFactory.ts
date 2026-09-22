import * as vscode from 'vscode';
import { LanguageClient } from 'vscode-languageclient/node';
import { MercuryDebugSession, EnclosingPredicate } from './mdbSession';

interface WireSymbol {
    kind: string;
    name: string;
    arity?: number;
    module?: string;
    determinism?: string;
    args?: { mode?: string }[];
    range: { startLine: number; startCol: number; endLine: number; endCol: number };
}
interface WireClause {
    name: string;
    arity: number;
    range: { startLine: number; startCol: number; endLine: number; endCol: number };
}
interface WireModuleDoc {
    uri: string;
    moduleName?: string;
    symbols: WireSymbol[];
    clauses: WireClause[];
}

/**
 * Registers the EXPERIMENTAL "mercury-mdb" debug type (see
 * mdbSession.ts's module doc). Resolves breakpoint lines and stack-frame
 * predicates using this project's own workspace index (via the language
 * client) rather than anything mdb itself reports about source positions,
 * since that part is reliable and already-tested — see
 * docs/compiler-integration.md#debugging.
 */
export function registerMercuryDebugAdapter(context: vscode.ExtensionContext, getClient: () => LanguageClient | undefined): void {
    const factory: vscode.DebugAdapterDescriptorFactory = {
        createDebugAdapterDescriptor: () => {
            const resolveEnclosingPredicate = async (uriString: string, line: number): Promise<EnclosingPredicate | undefined> => {
                const client = getClient();
                if (!client) return undefined;
                const uri = vscode.Uri.file(uriString).toString();
                const doc = await client.sendRequest<WireModuleDoc | null>('mercury/moduleDoc', { uri });
                if (!doc) return undefined;
                const clause = doc.clauses.find((c) => c.range.startLine <= line && line <= c.range.endLine);
                if (!clause) return undefined;
                return { name: clause.name, arity: clause.arity, moduleQualifier: doc.moduleName, line: clause.range.startLine };
            };

            const session = new MercuryDebugSession(resolveEnclosingPredicate);
            session.resolveDeclarationLocation = async (name, arity) => {
                const client = getClient();
                if (!client) return undefined;
                const result = await client.sendRequest<{ symbol: WireSymbol; uri: string } | null>('mercury/findDeclaration', {
                    name,
                    kinds: ['predicate', 'function'],
                });
                if (!result) return undefined;
                // Accept a nearby arity too (function arity conventions can
                // differ by one depending on whether the return slot is
                // counted — see docs/architecture.md's note on this).
                if (result.symbol.arity !== arity && result.symbol.arity !== arity + 1 && result.symbol.arity !== arity - 1) return undefined;
                return { uri: result.uri, line: result.symbol.range.startLine };
            };
            return new vscode.DebugAdapterInlineImplementation(session);
        },
    };
    context.subscriptions.push(vscode.debug.registerDebugAdapterDescriptorFactory('mercury-mdb', factory));

    const configProvider: vscode.DebugConfigurationProvider = {
        resolveDebugConfiguration: (_folder, config) => {
            if (!config.type && !config.request) {
                // Launched via F5 with no launch.json entry for this type.
                return null;
            }
            return config;
        },
    };
    context.subscriptions.push(vscode.debug.registerDebugConfigurationProvider('mercury-mdb', configProvider));
}
