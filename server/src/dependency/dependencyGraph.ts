import { WorkspaceIndex } from '../symbols/workspaceIndex';

export interface ImportGraphEdge {
    from: string;
    to: string[];
}

/**
 * Derives a module dependency graph purely from indexed `:- import_module`
 * / `:- use_module` declarations. This is the fallback source of truth for
 * `Mercury: Show Module Dependencies` when the compiler-backed
 * `mmc --generate-dependencies` path (see
 * server/src/compiler/mercuryCompilerAdapter.ts::getDependencyInfo) isn't
 * available — see docs/compiler-integration.md.
 */
export function buildImportGraph(index: WorkspaceIndex): ImportGraphEdge[] {
    return index
        .allDocs()
        .filter((d) => d.moduleName)
        .map((d) => ({ from: d.moduleName as string, to: [...d.imports, ...d.useModules] }));
}
