import { createHash } from 'node:crypto';
import { lstat, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import ts from 'typescript';

/** Load the repository-owned generated profile used by the browser consumer. */
export async function loadBundledProfile(moduleUrl) {
	const source = await readFile(moduleUrl, 'utf8');
	const { outputText } = ts.transpileModule(source, {
		compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ESNext }
	});
	return import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
}

async function metadata(file) {
	try {
		return await lstat(file);
	} catch (error) {
		if (error.code === 'ENOENT') return null;
		throw error;
	}
}

async function readRegularFile(file, maxBytes) {
	const stat = await metadata(file);
	if (!stat?.isFile() || stat.size > maxBytes) {
		throw new Error(`Missing, oversized or non-regular runtime asset: ${file}`);
	}
	const bytes = await readFile(file);
	if (bytes.length > maxBytes) throw new Error(`Runtime asset exceeds byte limit: ${file}`);
	return bytes;
}

/** Verify the logical bytes served by the existing raw/gzip runtime delivery path. */
export async function verifyPinnedRuntimeAssets({ rootDir, directory, assets }) {
	if (!/^wasm-[a-z0-9-]+$/.test(directory)) throw new Error('Invalid runtime directory');
	const runtimeDir = path.join(rootDir, directory);
	for (const dir of [rootDir, runtimeDir]) {
		if (!(await metadata(dir))?.isDirectory()) {
			throw new Error(`Missing or non-regular runtime directory: ${dir}`);
		}
	}
	const manifestPath = path.join(rootDir, 'compressed-runtime-assets.v1.json');
	let compressed = { assets: [], sizes: {} };
	if (await metadata(manifestPath)) {
		compressed = JSON.parse(await readRegularFile(manifestPath, 4 * 1024 * 1024));
		if (
			!Array.isArray(compressed.assets) ||
			!compressed.sizes ||
			typeof compressed.sizes !== 'object'
		) {
			throw new Error('Invalid compressed runtime asset manifest');
		}
	}
	const expectedFiles = new Set();
	let logicalBytes = 0;
	for (const [name, receipt] of Object.entries(assets)) {
		if (
			!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(name) ||
			!Number.isSafeInteger(receipt.bytes) ||
			receipt.bytes < 1 ||
			!/^[0-9a-f]{64}$/.test(receipt.sha256)
		) {
			throw new Error(`Invalid pinned asset receipt: ${name}`);
		}
		const logicalPath = `${directory}/${name}`;
		const indexed = compressed.assets.filter((entry) => entry === logicalPath).length;
		if (
			indexed > 1 ||
			(indexed === 1 && compressed.sizes[logicalPath] !== receipt.bytes) ||
			(indexed === 0 && Object.hasOwn(compressed.sizes, logicalPath))
		) {
			throw new Error(`Stale compressed runtime asset entry: ${logicalPath}`);
		}
		const storedName = `${name}${indexed ? '.gz' : ''}`;
		expectedFiles.add(storedName);
		const stored = await readRegularFile(
			path.join(runtimeDir, storedName),
			receipt.bytes + 65536
		);
		const bytes = indexed ? gunzipSync(stored, { maxOutputLength: receipt.bytes }) : stored;
		if (
			bytes.length !== receipt.bytes ||
			createHash('sha256').update(bytes).digest('hex') !== receipt.sha256
		) {
			throw new Error(`Pinned runtime asset size/SHA-256 mismatch: ${logicalPath}`);
		}
		logicalBytes += bytes.length;
	}
	for (const entry of await readdir(runtimeDir)) {
		if (!expectedFiles.has(entry))
			throw new Error(`Unexpected runtime bundle entry: ${directory}/${entry}`);
	}
	for (const entry of [...compressed.assets, ...Object.keys(compressed.sizes)]) {
		if (
			typeof entry === 'string' &&
			entry.startsWith(`${directory}/`) &&
			!Object.hasOwn(assets, entry.slice(directory.length + 1))
		) {
			throw new Error(`Stale compressed runtime asset entry: ${entry}`);
		}
	}
	return { directory, assetCount: expectedFiles.size, logicalBytes };
}
