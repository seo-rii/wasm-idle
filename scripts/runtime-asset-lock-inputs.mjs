#!/usr/bin/env node
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import {
	copyFile,
	lstat,
	mkdir,
	mkdtemp,
	readFile,
	rename,
	rm,
	statfs,
	writeFile
} from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import {
	generateRuntimeAssetLock,
	renderRuntimeAssetLock
} from './generate-runtime-asset-lock.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const defaultLock = path.join(root, 'packages/core/src/runtime-asset-lock.generated.ts');
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const groups = {
	clang: 'clang',
	clangd: 'clang',
	'wasm-c3': 'c3',
	'wasm-lfortran': 'lfortran',
	'wasm-of-js-of-ocaml': 'ocaml',
	'wasm-lean4': 'lean4',
	'wasm-commonlisp': 'commonlisp',
	'wasm-picat': 'picat',
	'wasm-parigp': 'parigp',
	'wasm-debug': 'debug'
};

function safePath(value) {
	return (
		typeof value === 'string' &&
		value.length > 0 &&
		!/[\\\0%]/u.test(value) &&
		!value.startsWith('/') &&
		value.split('/').every((part) => part && part !== '.' && part !== '..')
	);
}

function validateManifest(manifest) {
	if (
		manifest?.schemaVersion !== 1 ||
		typeof manifest.version !== 'string' ||
		!manifest.assets ||
		typeof manifest.assets !== 'object' ||
		Array.isArray(manifest.assets)
	)
		throw new Error('Invalid runtime asset lock manifest');
	for (const [name, item] of Object.entries(manifest.assets)) {
		if (
			!safePath(name) ||
			!item ||
			!Number.isSafeInteger(item.bytes) ||
			item.bytes < 0 ||
			!/^[a-f0-9]{64}$/u.test(item.sha256)
		)
			throw new Error('Invalid runtime asset receipt: ' + name);
		if (
			item.deliveryPath !== undefined &&
			(!safePath(item.deliveryPath) ||
				!manifest.assets[item.deliveryPath] ||
				item.deliveryPath === name)
		)
			throw new Error('Invalid runtime delivery path: ' + name);
		if (
			item.layer !== undefined &&
			(!safePath(item.layer?.path) ||
				!manifest.assets[item.layer.path] ||
				!Number.isSafeInteger(item.layer.offset) ||
				item.layer.offset < 0 ||
				!Number.isSafeInteger(item.layer.bytes) ||
				item.layer.bytes < 0)
		)
			throw new Error('Invalid runtime layer: ' + name);
		if (item.layer && item.deliveryPath) throw new Error('Ambiguous runtime delivery: ' + name);
	}
}

/** Read only the canonical generated literal. Never execute a metadata source file. */
export function parseRuntimeAssetLockSource(source) {
	const version = source.match(/export const WASM_IDLE_ASSET_VERSION: string = '([^']+)';/u)?.[1];
	const begin = source.indexOf('\tassets: {\n');
	const end = source.indexOf('\n\t}\n});', begin);
	if (!version || begin < 0 || end < 0)
		throw new Error('Runtime asset lock must use its canonical generated format');
	let manifest;
	try {
		manifest = {
			schemaVersion: 1,
			version,
			assets: JSON.parse('{' + source.slice(begin + 11, end) + '}')
		};
	} catch {
		throw new Error('Invalid generated runtime asset literal');
	}
	validateManifest(manifest);
	if (renderRuntimeAssetLock(manifest) !== source)
		throw new Error(
			'Runtime asset lock is not canonical; do not execute or silently repair it'
		);
	return manifest;
}

async function containedFile(rootDir, name) {
	if (!safePath(name)) throw new Error('Unsafe runtime asset path: ' + name);
	const parts = name.split('/');
	for (let i = 1; i <= parts.length; i++) {
		const file = path.join(rootDir, ...parts.slice(0, i));
		let stat;
		try {
			stat = await lstat(file);
		} catch (error) {
			if (error?.code === 'ENOENT') return undefined;
			throw error;
		}
		if (stat.isSymbolicLink()) throw new Error('Symbolic runtime asset path: ' + name);
		if (i === parts.length) {
			if (!stat.isFile()) throw new Error('Runtime asset must be a regular file: ' + name);
			return { file, stat };
		}
		if (!stat.isDirectory())
			throw new Error('Runtime asset parent must be a directory: ' + name);
	}
}

async function verifyFile(rootDir, name, expected) {
	const item = await containedFile(rootDir, name);
	if (!item) return false;
	if (item.stat.size !== expected.bytes) throw new Error('Size mismatch');
	const hash = createHash('sha256');
	for await (const chunk of createReadStream(item.file)) hash.update(chunk);
	if (hash.digest('hex') !== expected.sha256) throw new Error('SHA-256 mismatch');
	return true;
}

/** Audit every required delivery, including files absent from the compression indexes. */
export async function auditRuntimeAssetLockInputs({ rootDir, manifest }) {
	validateManifest(manifest);
	const missing = [],
		invalid = [];
	let verifiedCount = 0,
		missingBytes = 0;
	for (const [name, expected] of Object.entries(manifest.assets)) {
		if (expected.deliveryPath || expected.layer) continue;
		try {
			if (await verifyFile(rootDir, name, expected)) verifiedCount++;
			else {
				missing.push({
					path: name,
					bytes: expected.bytes,
					sha256: expected.sha256,
					group: Object.hasOwn(groups, name.split('/')[0])
						? groups[name.split('/')[0]]
						: null
				});
				missingBytes += expected.bytes;
			}
		} catch (error) {
			invalid.push({ path: name, reason: String(error?.message || error) });
		}
	}
	return { missing, invalid, verifiedCount, missingBytes };
}

async function atomicWrite(file, bytes) {
	await mkdir(path.dirname(file), { recursive: true });
	const temporary = file + '.asset-inputs-' + randomUUID();
	try {
		await writeFile(temporary, bytes, { flag: 'wx' });
		await rename(temporary, file);
	} finally {
		await rm(temporary, { force: true });
	}
}

// Preserve the committed delivery graph. A general compression pass changes direct assets too.
async function normalizeIndexedDeliveries({ rootDir, manifest }) {
	for (const [name, logical] of Object.entries(manifest.assets)) {
		if (!logical.deliveryPath || (await containedFile(rootDir, logical.deliveryPath))) continue;
		if (!(await verifyFile(rootDir, name, logical))) continue;
		const encoded = gzipSync(await readFile(path.join(rootDir, name)), { level: 9 });
		const expected = manifest.assets[logical.deliveryPath];
		if (
			encoded.length !== expected.bytes ||
			sha256(encoded) !== expected.sha256 ||
			(expected.uncompressedBytes !== undefined &&
				expected.uncompressedBytes !== logical.bytes) ||
			(expected.uncompressedSha256 !== undefined &&
				expected.uncompressedSha256 !== logical.sha256)
		)
			throw new Error(
				'Prepared asset does not reproduce committed gzip receipt: ' + logical.deliveryPath
			);
		await atomicWrite(path.join(rootDir, logical.deliveryPath), encoded);
	}
}

async function defaultPrepareGroup(group, { rootDir, manifest, missing, cacheDir }) {
	await mkdir(cacheDir, { recursive: true });
	const temporary = await mkdtemp(path.join(cacheDir, group + '-'));
	const stage = path.join(temporary, 'static');
	await mkdir(stage);
	try {
		for (const name of [
			'compressed-runtime-assets.v1.json',
			'layered-runtime-assets.v1.json',
			'clang/runtime-build.json'
		]) {
			const old = await containedFile(rootDir, name);
			if (old) {
				await mkdir(path.dirname(path.join(stage, name)), { recursive: true });
				await copyFile(old.file, path.join(stage, name));
			}
		}
		const versionModulePath = path.join(temporary, 'version.ts');
		if (group === 'debug') {
			const { prepareWasmDebugRelease } = await import('./prepare-wasm-debug-release.mjs');
			await prepareWasmDebugRelease({ staticDir: stage, versionModulePath });
		} else if (['lean4', 'commonlisp', 'picat', 'parigp'].includes(group)) {
			const definitions = {
				lean4: ['./sync-wasm-lean4.mjs', 'syncWasmLean4Assets'],
				commonlisp: ['./sync-wasm-commonlisp.mjs', 'syncWasmCommonLispAssets'],
				picat: ['./sync-wasm-picat.mjs', 'syncWasmPicatAssets'],
				parigp: ['./sync-wasm-parigp.mjs', 'syncWasmPariGpAssets']
			};
			const [module, method] = definitions[group];
			await (
				await import(module)
			)[method]({ targetDir: path.join(stage, 'wasm-' + group), versionModulePath });
		} else {
			const { prepareBrowserTestAssets } = await import('./prepare-browser-test-assets.mjs');
			await prepareBrowserTestAssets({
				groups: [group],
				staticDir: stage,
				cacheDir: path.join(temporary, 'cache'),
				versionModulePath
			});
		}
		await normalizeIndexedDeliveries({ rootDir: stage, manifest });
		// Publish only previously absent files in the frozen expected graph, never generated extras.
		for (const item of missing) {
			const expected = manifest.assets[item.path];
			if (!(await verifyFile(stage, item.path, expected)))
				throw new Error('Pinned preparer did not supply ' + item.path);
			await atomicWrite(
				path.join(rootDir, item.path),
				await readFile(path.join(stage, item.path))
			);
		}
	} finally {
		await rm(temporary, { recursive: true, force: true });
	}
}

export async function prepareRuntimeAssetLockInputs({
	rootDir,
	manifest,
	prepareGroup = defaultPrepareGroup,
	cacheDir = path.join(path.dirname(rootDir), '.asset-inputs-cache')
}) {
	const before = await auditRuntimeAssetLockInputs({ rootDir, manifest });
	if (before.invalid.length)
		throw new Error(
			'Corrupt existing runtime assets; preparation will not overwrite them: ' +
				before.invalid.map((item) => item.path).join(', ')
		);
	if (before.missing.some((item) => !item.group))
		throw new Error(
			'Missing assets require manual pinned preparation: ' +
				before.missing
					.filter((item) => !item.group)
					.map((item) => item.path)
					.join(', ')
		);
	const selected = [...new Set(before.missing.map((item) => item.group))];
	if (selected.length) {
		let directory = path.resolve(rootDir),
			available;
		for (;;) {
			try {
				const space = await statfs(directory);
				available = space.bavail * space.bsize;
				break;
			} catch (error) {
				if (error?.code !== 'ENOENT' || path.dirname(directory) === directory) throw error;
				directory = path.dirname(directory);
			}
		}
		// Pinned preparers stage a complete group even when only one small file is absent.
		// Include encoded and decoded receipts; logical aliases share those physical inputs.
		const stagedBytes = new Map(selected.map((group) => [group, 0]));
		for (const [name, item] of Object.entries(manifest.assets)) {
			const group = Object.hasOwn(groups, name.split('/')[0])
				? groups[name.split('/')[0]]
				: null;
			if (!stagedBytes.has(group) || item.deliveryPath || item.layer) continue;
			const decoded =
				Number.isSafeInteger(item.uncompressedBytes) && item.uncompressedBytes > 0
					? item.uncompressedBytes
					: 0;
			stagedBytes.set(group, stagedBytes.get(group) + item.bytes + decoded);
		}
		const largest = Math.max(...stagedBytes.values());
		const required = before.missingBytes + 2 * largest + 32 * 1024 * 1024;
		if (available < required)
			throw new Error(
				`Runtime input preparation requires at least ${required} free bytes including staging; ${available} available. Use an asset root on a filesystem with sufficient space.`
			);
	}
	for (const group of selected) {
		await prepareGroup(group, {
			rootDir,
			manifest,
			missing: before.missing.filter((item) => item.group === group),
			cacheDir
		});
		await normalizeIndexedDeliveries({ rootDir, manifest });
	}
	const after = await auditRuntimeAssetLockInputs({ rootDir, manifest });
	if (after.missing.length || after.invalid.length)
		throw new Error(
			'Prepared runtime assets failed receipt verification: ' +
				[...after.missing, ...after.invalid].map((item) => item.path).join(', ')
		);
	return after;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const args = process.argv.slice(2);
	const prepare = args.includes('--prepare');
	if (
		args.some((arg) => arg.startsWith('--') && !['--prepare', '--check'].includes(arg)) ||
		(args.includes('--prepare') && args.includes('--check'))
	)
		throw new Error(
			'Usage: runtime-asset-lock-inputs.mjs [static|asset-root] [--check|--prepare]'
		);
	const positional = args.filter((arg) => !arg.startsWith('--'));
	if (positional.length > 1) throw new Error('Only one runtime asset root may be supplied');
	const rootDir = positional[0] ? path.resolve(root, positional[0]) : path.join(root, 'static');
	const manifest = parseRuntimeAssetLockSource(await readFile(defaultLock, 'utf8'));
	const audit = prepare
		? await prepareRuntimeAssetLockInputs({ rootDir, manifest })
		: await auditRuntimeAssetLockInputs({ rootDir, manifest });
	if (audit.missing.length || audit.invalid.length) {
		for (const item of audit.missing)
			console.error(
				`Missing ${item.path}: ${item.bytes} bytes, SHA-256 ${item.sha256}; prepare ${item.group || 'manually'}`
			);
		for (const item of audit.invalid) console.error(`Invalid ${item.path}: ${item.reason}`);
		throw new Error(
			`${audit.missing.length} missing runtime inputs (${audit.missingBytes} bytes), ${audit.invalid.length} invalid. Run pnpm run prepare:assets-lock for receipt-pinned preparation; lock/index files are never regenerated by this command.`
		);
	}
	await generateRuntimeAssetLock({ rootDir, check: true });
	console.log(
		`Verified all ${audit.verifiedCount} runtime delivery inputs and the complete ${Object.keys(manifest.assets).length}-receipt lock`
	);
}
