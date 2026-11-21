import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
	readStaticRuntimeAsset,
	STATIC_RUNTIME_MANIFEST_FILE
} from './static-runtime-manifest.mjs';

const lockPath = fileURLToPath(new URL('./duckdb-native-assets.lock.json', import.meta.url));
const variants = ['mvp', 'eh'];
const names = (variant) => [`duckdb-${variant}.wasm`, `duckdb-browser-${variant}.worker.js`];
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

async function readLock(file) {
	const lock = JSON.parse(await readFile(file, 'utf8'));
	const pins = lock.provenance;
	if (
		pins?.schemaVersion !== 1 ||
		!pins.packageVersion ||
		!pins.emscriptenVersion ||
		!/^[0-9a-f]{64}$/u.test(pins.arrowPatchSha256) ||
		!['duckdbWasmCommit', 'duckdbCommit', 'arrowCommit', 'arrowPatchCommit'].every((key) =>
			/^[0-9a-f]{40}$/u.test(pins[key])
		)
	)
		throw new Error('Incomplete native build provenance in the DuckDB asset lock');
	return lock;
}

async function readArtifactVariant(directory, variant, provenance) {
	const dir = path.join(directory, variant);
	const sums = new Map();
	for (const line of (await readFile(path.join(dir, 'SHA256SUMS'), 'utf8'))
		.trimEnd()
		.split('\n')) {
		const match = /^([0-9a-f]{64}) [ *]([^/\\]+)$/u.exec(line);
		if (!match || sums.has(match[2]))
			throw new Error('Invalid DuckDB ' + variant + ' SHA256SUMS');
		sums.set(match[2], match[1]);
	}
	const verified = async (name) => {
		const bytes = await readFile(path.join(dir, name));
		if (digest(bytes) !== sums.get(name))
			throw new Error('DuckDB artifact checksum mismatch: ' + name);
		return bytes;
	};
	const actual = JSON.parse((await verified('provenance.json')).toString('utf8'));
	for (const [key, value] of Object.entries({ ...provenance, variant })) {
		if (actual[key] !== value)
			throw new Error('DuckDB ' + variant + ' provenance mismatch: ' + key);
	}
	const assets = new Map();
	for (const name of names(variant)) assets.set(name, await verified(name));
	return assets;
}

function lockedRuntimePath(manifest, name, expected) {
	const { name: stem, ext } = path.parse(name);
	const matches = manifest.files.filter(
		(file) =>
			file.sha256 === expected.sha256 &&
			file.bytes === expected.bytes &&
			path.posix.dirname(file.path) === 'assets' &&
			path.posix.basename(file.path).startsWith(stem + '-') &&
			file.path.endsWith(ext)
	);
	if (matches.length !== 1) throw new Error('Missing or ambiguous locked DuckDB asset: ' + name);
	return matches[0].path;
}

async function readArtifacts(directory, provenance) {
	const assets = new Map();
	for (const variant of variants) {
		for (const [name, bytes] of await readArtifactVariant(directory, variant, provenance))
			assets.set(name, bytes);
	}
	return assets;
}

/** Requalify only with both variants from the matching native backport build. */
export async function lockDuckDbArtifacts(directory, file = lockPath) {
	const lock = await readLock(file);
	const native = await readArtifacts(directory, lock.provenance);
	lock.assets = Object.fromEntries(
		[...native]
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([name, bytes]) => [name, { bytes: bytes.length, sha256: digest(bytes) }])
	);
	const temp = file + '.next-' + process.pid;
	try {
		await writeFile(temp, JSON.stringify(lock, null, '\t') + '\n');
		await rename(temp, file);
	} finally {
		await rm(temp, { force: true });
	}
}

/** Build with the four verified native inputs before replacing the published runtime. */
export async function buildDuckDbBackport(
	{ targetDir, packageVersion, artifactDir, lockFile = lockPath },
	build
) {
	const lock = await readLock(lockFile);
	if (lock.provenance.packageVersion !== packageVersion)
		throw new Error('DuckDB JavaScript version does not match the native backport');
	const artifacts = artifactDir ? await readArtifacts(artifactDir, lock.provenance) : null;
	const manifest = artifacts
		? null
		: JSON.parse(await readFile(path.join(targetDir, STATIC_RUNTIME_MANIFEST_FILE), 'utf8'));
	const parent = path.dirname(targetDir);
	await mkdir(parent, { recursive: true });
	const stage = await mkdtemp(path.join(parent, '.duckdb-'));
	// Keep the old directory outside stage so even a failed rollback preserves it.
	const previous = stage + '.previous';
	try {
		const inputs = path.join(stage, 'inputs');
		const output = path.join(stage, 'output');
		await mkdir(inputs);
		const alias = [];
		for (const name of variants.flatMap(names)) {
			const expected = lock.assets[name];
			if (!expected) throw new Error('Missing locked DuckDB asset: ' + name);
			let bytes;
			if (artifacts) {
				bytes = artifacts.get(name);
			} else {
				bytes = await readStaticRuntimeAsset(
					targetDir,
					lockedRuntimePath(manifest, name, expected),
					{ allowCompressed: true }
				);
			}
			if (bytes.length !== expected.bytes || digest(bytes) !== expected.sha256)
				throw new Error('Locked DuckDB asset mismatch: ' + name);
			const file = path.join(inputs, name);
			await writeFile(file, bytes);
			alias.push({
				find: '@duckdb/duckdb-wasm/dist/' + name + '?url',
				replacement: file + '?url'
			});
		}
		await build(output, alias);
		const emitted = JSON.parse(
			await readFile(path.join(output, STATIC_RUNTIME_MANIFEST_FILE), 'utf8')
		);
		for (const name of variants.flatMap(names))
			lockedRuntimePath(emitted, name, lock.assets[name]);

		let hadPrevious = false;
		try {
			await rename(targetDir, previous);
			hadPrevious = true;
		} catch (error) {
			if (error.code !== 'ENOENT') throw error;
		}
		try {
			await rename(output, targetDir);
		} catch (error) {
			if (hadPrevious) await rename(previous, targetDir);
			throw error;
		}
		if (hadPrevious) await rm(previous, { recursive: true, force: true });
	} finally {
		await rm(stage, { recursive: true, force: true });
	}
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const [option, directory, ...extra] = process.argv.slice(2);
	if (option !== '--lock' || !directory || extra.length)
		throw new Error(
			'Usage: node scripts/duckdb-native-assets.mjs --lock <native-artifacts-directory>'
		);
	await lockDuckDbArtifacts(path.resolve(directory));
}
