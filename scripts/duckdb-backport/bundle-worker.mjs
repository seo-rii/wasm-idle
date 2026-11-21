import assert from 'node:assert/strict';
import { copyFile, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

const [upstream, variant, output] = process.argv.slice(2);
assert.ok(['mvp', 'eh'].includes(variant));
const pkg = path.join(upstream, 'packages', 'duckdb-wasm');
const manifest = path.join(pkg, 'package.json');
const require = createRequire(manifest);
const esbuild = require('esbuild');
assert.equal(esbuild.version, '0.20.2');

// npm_version.sh stamps the release version before the upstream bundle is built.
const version = JSON.parse(await readFile(manifest, 'utf8'));
version.version = '1.33.1-dev57.0';
await writeFile(manifest, JSON.stringify(version));

// Match patch_arrow() and the browser worker target in the pinned bundle.mjs.
const arrowManifest = path.join(upstream, 'node_modules/apache-arrow/package.json');
const arrow = JSON.parse(await readFile(arrowManifest, 'utf8'));
assert.equal(arrow.version, '17.0.0');
arrow.exports = {
    node: { import: './Arrow.node.mjs', require: './Arrow.node.js' },
    import: './Arrow.dom.mjs',
    default: './Arrow.dom.js'
};
await writeFile(arrowManifest, JSON.stringify(arrow));

const worker = `duckdb-browser-${variant}.worker.js`;
const glue = `duckdb-${variant}.js`;
const nativeGlue = await readFile(path.join(output, glue), 'utf8');
// Upstream patchFile() leaves the Node-only require dynamic for browser esbuild.
const browserGlue = nativeGlue.replace(/require\((["'])child_process\1\)/g, '["child_process"].map(require)');
await writeFile(path.join(pkg, 'src/bindings', glue), browserGlue);
await esbuild.build({
    absWorkingDir: pkg,
    entryPoints: [`./src/targets/duckdb-browser-${variant}.worker.ts`],
    outfile: `dist/${worker}`,
    platform: 'browser',
    format: 'iife',
    globalName: 'duckdb',
    target: ['chrome64', 'edge79', 'firefox62', 'safari11.1'],
    bundle: true,
    minify: true,
    sourcemap: true,
    external: ['module'],
    define: { 'process.release.name': '"browser"' }
});
for (const name of [worker, `${worker}.map`]) {
    await copyFile(path.join(pkg, 'dist', name), path.join(output, name));
}

const map = JSON.parse(await readFile(path.join(output, `${worker}.map`), 'utf8'));
const index = map.sources.findIndex((source) => source.endsWith(`/src/bindings/${glue}`));
assert.notEqual(index, -1, 'worker source map must contain its Emscripten glue');
assert.equal(map.sourcesContent[index], browserGlue);
const wasm = await WebAssembly.compile(await readFile(path.join(output, `duckdb-${variant}.wasm`)));
assert.ok(WebAssembly.Module.exports(wasm).some(({ name }) => name === 'duckdb_web_query_run_buffer'));
