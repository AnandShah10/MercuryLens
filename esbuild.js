// Bundles the extension host and language server into single files each
// with esbuild, so the packaged VSIX ships two JS files instead of the
// unbundled node_modules tree. `vscode` (provided by the host at runtime)
// is left external; everything else (vscode-languageclient, -server, etc.)
// is inlined. Source maps are emitted alongside for debugging.
const esbuild = require('esbuild');

const watch = process.argv.includes('--watch');
const production = process.argv.includes('--production');

/** @type {import('esbuild').BuildOptions[]} */
const configs = [
    {
        entryPoints: ['extension/src/extension.ts'],
        outfile: 'extension/out/extension.js',
        bundle: true,
        platform: 'node',
        target: 'node18',
        format: 'cjs',
        external: ['vscode'],
        sourcemap: !production,
        minify: production,
        logLevel: 'info',
    },
    {
        entryPoints: ['server/src/server.ts'],
        outfile: 'server/out/server.js',
        bundle: true,
        platform: 'node',
        target: 'node18',
        format: 'cjs',
        external: [],
        sourcemap: !production,
        minify: production,
        logLevel: 'info',
    },
];

async function main() {
    if (watch) {
        const contexts = await Promise.all(configs.map((c) => esbuild.context(c)));
        await Promise.all(contexts.map((ctx) => ctx.watch()));
        console.log('esbuild: watching for changes...');
    } else {
        await Promise.all(configs.map((c) => esbuild.build(c)));
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
