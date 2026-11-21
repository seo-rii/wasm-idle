import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { gzipSync } from 'node:zlib';
import { build } from 'vite';
import { buildDuckDbBackport, lockDuckDbArtifacts } from './duckdb-native-assets.mjs';

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const source = JSON.parse(
	await readFile(new URL('./duckdb-native-assets.lock.json', import.meta.url), 'utf8')
).provenance;

async function fixture(t) {
	const dir = await mkdtemp(path.join(os.tmpdir(), 'duckdb-native-test-'));
	t.after(() => rm(dir, { recursive: true, force: true }));
	const artifactDir = path.join(dir, 'native');
	const lockFile = path.join(dir, 'lock.json');
	const targetDir = path.join(dir, 'static', 'wasm-duckdb');
	for (const variant of ['mvp', 'eh']) {
		const variantDir = path.join(artifactDir, variant);
		await mkdir(variantDir, { recursive: true });
		const sums = [];
		for (const [name, value] of [
			['provenance.json', JSON.stringify({ ...source, variant })],
			['duckdb-' + variant + '.wasm', 'fixture native ' + variant],
			['duckdb-browser-' + variant + '.worker.js', 'fixture worker ' + variant]
		]) {
			await writeFile(path.join(variantDir, name), value);
			sums.push(hash(value) + '  ' + name);
		}
		await writeFile(path.join(variantDir, 'SHA256SUMS'), sums.join('\n') + '\n');
	}
	await writeFile(lockFile, JSON.stringify({ provenance: source, assets: {} }));
	await lockDuckDbArtifacts(artifactDir, lockFile);
	return { artifactDir, lockFile, targetDir, packageVersion: source.packageVersion };
}

async function emitAssets(output, alias) {
	const root = path.dirname(output);
	const entry = path.join(root, 'bundles.mjs');
	const names = [
		'duckdb-eh.wasm',
		'duckdb-browser-eh.worker.js',
		'duckdb-mvp.wasm',
		'duckdb-browser-mvp.worker.js'
	];
	await writeFile(
		entry,
		names
			.map(
				(name, i) =>
					`export { default as url${i} } from '@duckdb/duckdb-wasm/dist/${name}?url';`
			)
			.join('\n')
	);
	await build({
		root,
		configFile: false,
		publicDir: false,
		logLevel: 'silent',
		resolve: { alias },
		build: {
			outDir: output,
			assetsInlineLimit: 0,
			rollupOptions: {
				input: entry,
				preserveEntrySignatures: 'strict',
				output: {
					format: 'es',
					entryFileNames: 'runtime.mjs',
					assetFileNames: 'assets/[name]-[hash][extname]'
				}
			}
		}
	});
	const runtime = await readFile(path.join(output, 'runtime.mjs'), 'utf8');
	const files = [];
	for (const name of (await readdir(path.join(output, 'assets'))).sort()) {
		const file = 'assets/' + name;
		assert.ok(runtime.includes(file));
		const bytes = await readFile(path.join(output, file));
		files.push({ path: file, bytes: bytes.length, sha256: hash(bytes) });
	}
	await writeFile(path.join(output, 'runtime-manifest.v1.json'), JSON.stringify({ files }));
}

test('rebuilds the same native workers and Wasm from a fresh checkout or uncompressed output', async (t) => {
	const options = await fixture(t);
	await buildDuckDbBackport(options, emitAssets);
	const manifest = path.join(options.targetDir, 'runtime-manifest.v1.json');
	const initial = await readFile(manifest, 'utf8');
	const offline = { ...options, artifactDir: undefined };
	await buildDuckDbBackport(offline, emitAssets);
	assert.equal(await readFile(manifest, 'utf8'), initial);
	for (const { path: logical } of JSON.parse(initial).files) {
		const file = path.join(options.targetDir, logical);
		await writeFile(file + '.gz', gzipSync(await readFile(file)));
		await rm(file);
	}
	await rm(options.artifactDir, { recursive: true });
	await buildDuckDbBackport(offline, emitAssets);
	assert.equal(await readFile(manifest, 'utf8'), initial);
	const first = JSON.parse(initial).files[0].path;
	await writeFile(path.join(options.targetDir, first), 'different checkout bytes');
	await assert.rejects(buildDuckDbBackport(offline, emitAssets), /Locked DuckDB asset mismatch/);
});

test('verifies producer provenance, the artifact checksum and the independent decoded lock', async (t) => {
	const options = await fixture(t);
	const lock = await readFile(options.lockFile);
	const wasm = path.join(options.artifactDir, 'eh/duckdb-eh.wasm');
	await writeFile(wasm, 'wrong');
	await assert.rejects(
		lockDuckDbArtifacts(options.artifactDir, options.lockFile),
		/artifact checksum mismatch/
	);
	const sums = path.join(options.artifactDir, 'eh/SHA256SUMS');
	await writeFile(
		sums,
		(await readFile(sums, 'utf8')).replace(hash('fixture native eh'), hash('wrong'))
	);
	await assert.rejects(buildDuckDbBackport(options, emitAssets), /Locked DuckDB asset mismatch/);
	const metadata = path.join(options.artifactDir, 'eh/provenance.json');
	const before = await readFile(metadata);
	const changed = JSON.stringify({ ...JSON.parse(before), variant: 'mvp' });
	await writeFile(metadata, changed);
	await writeFile(sums, (await readFile(sums, 'utf8')).replace(hash(before), hash(changed)));
	await assert.rejects(
		lockDuckDbArtifacts(options.artifactDir, options.lockFile),
		/provenance mismatch: variant/
	);
	assert.deepEqual(await readFile(options.lockFile), lock);
	await assert.rejects(
		buildDuckDbBackport({ ...options, packageVersion: 'other' }, emitAssets),
		/JavaScript version does not match/
	);
	const incomplete = JSON.parse(lock);
	delete incomplete.provenance.arrowPatchSha256;
	await writeFile(options.lockFile, JSON.stringify(incomplete));
	await assert.rejects(
		lockDuckDbArtifacts(options.artifactDir, options.lockFile),
		/Incomplete native build provenance/
	);
});

test('keeps the published tree if a rebuild emits an unpatched asset', async (t) => {
	const options = await fixture(t);
	await buildDuckDbBackport(options, emitAssets);
	const before = await readFile(path.join(options.targetDir, 'runtime-manifest.v1.json'));
	await assert.rejects(
		buildDuckDbBackport(options, async (out, alias) => {
			await writeFile(alias[0].replacement.slice(0, -4), 'unpatched fallback');
			await emitAssets(out, alias);
		}),
		/Missing or ambiguous locked DuckDB asset/
	);
	assert.deepEqual(
		await readFile(path.join(options.targetDir, 'runtime-manifest.v1.json')),
		before
	);
	assert.deepEqual(await readdir(path.dirname(options.targetDir)), ['wasm-duckdb']);
});
