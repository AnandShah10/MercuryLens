import * as assert from 'assert';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { WorkspaceAnalyzer } from '../../../server/src/analyzer/workspaceAnalyzer';

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mercury-analyzer-test-'));
    try {
        await fn(dir);
    } finally {
        await fs.rm(dir, { recursive: true, force: true });
    }
}

describe('WorkspaceAnalyzer.indexWorkspace', () => {
    it('finds and parses every .m file under the root, skipping build-artifact and hidden directories', async () => {
        await withTempDir(async (dir) => {
            await fs.writeFile(path.join(dir, 'a.m'), ':- module a.\n');
            await fs.mkdir(path.join(dir, 'sub'));
            await fs.writeFile(path.join(dir, 'sub', 'b.m'), ':- module b.\n');
            await fs.mkdir(path.join(dir, 'Mercury')); // compiler build-artifact dir — must be skipped
            await fs.writeFile(path.join(dir, 'Mercury', 'ignored.m'), ':- module ignored.\n');
            await fs.mkdir(path.join(dir, '.git')); // dotdir — must be skipped
            await fs.writeFile(path.join(dir, '.git', 'also_ignored.m'), ':- module also_ignored.\n');
            await fs.writeFile(path.join(dir, 'not_mercury.txt'), 'irrelevant');

            const analyzer = new WorkspaceAnalyzer();
            const count = await analyzer.indexWorkspace(dir);
            assert.strictEqual(count, 2);
            assert.ok(analyzer.index.findModule('a'));
            assert.ok(analyzer.index.findModule('b'));
            assert.ok(!analyzer.index.findModule('ignored'));
            assert.ok(!analyzer.index.findModule('also_ignored'));
        });
    });

    it('reports unreadable files via onWarning without aborting the rest of the walk', async () => {
        await withTempDir(async (dir) => {
            await fs.writeFile(path.join(dir, 'ok.m'), ':- module ok.\n');
            // A broken symlink is a portable, real way to trigger a read
            // failure (fs.readdir lists it as an entry, but fs.readFile
            // fails resolving the dangling target) without needing
            // permission-bit tricks that don't reliably block a root
            // process from reading its own files.
            await fs.symlink(path.join(dir, 'does-not-exist.m'), path.join(dir, 'broken.m'));

            const warnings: string[] = [];
            const analyzer = new WorkspaceAnalyzer();
            const count = await analyzer.indexWorkspace(dir, (w) => warnings.push(w));
            assert.strictEqual(count, 2); // both ok.m and broken.m are *found*
            assert.ok(analyzer.index.findModule('ok'));
            assert.strictEqual(warnings.length, 1);
            assert.ok(warnings[0].includes('broken.m'));
        });
    });

    it('returns 0 without indexing anything for an empty directory', async () => {
        await withTempDir(async (dir) => {
            const analyzer = new WorkspaceAnalyzer();
            const count = await analyzer.indexWorkspace(dir);
            assert.strictEqual(count, 0);
        });
    });
});

describe('WorkspaceAnalyzer.computeDiagnostics', () => {
    it('falls back to syntactic diagnostics (labeled as such) when no compiler is available, or uses mmc when one is', async () => {
        // This environment has no `mmc` on PATH (confirmed elsewhere in this
        // project), so this exercises the syntactic fallback here — but the
        // assertion is written to hold correctly either way, since
        // MercuryCompilerAdapter always tries a bare 'mmc' on PATH as a
        // fallback regardless of a bogus configured path (see
        // mercuryCompilerAdapter.ts::candidatePaths), so a dev machine that
        // does have Mercury installed would legitimately take the other
        // branch here.
        await withTempDir(async (dir) => {
            const analyzer = new WorkspaceAnalyzer('/definitely/not/a/real/compiler/path/mmc');
            const uri = 'file://' + path.join(dir, 'a.m');
            const text = ':- module a.\n:- interface.\n:- import_module totally_unknown_module_xyz.\n:- implementation.\n';
            const detection = await analyzer.compiler.detect();
            const diagnostics = await analyzer.computeDiagnostics(uri, text, dir, { compilerArguments: [], maxAnalysisTime: 5000 });

            if (!detection.found) {
                assert.ok(diagnostics.length > 0);
                assert.ok(diagnostics.every((d) => d.source === 'mercury-syntax'));
                assert.ok(diagnostics.some((d) => d.message.includes('syntactic check only')));
            } else {
                assert.ok(diagnostics.every((d) => d.source === 'mmc'));
            }
        });
    });
});
