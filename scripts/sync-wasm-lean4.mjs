#!/usr/bin/env node
// Download the reviewed wasm-llvm lean-browser release from its immutable commit URL (or read a
// local artifact directory), verify it against the committed lock, and publish static/wasm-lean4.
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

const root = fileURLToPath(new URL('../', import.meta.url));
const LOCK_URL = new URL('./wasm-lean4-assets.lock.json', import.meta.url);
const WORKER_URL = new URL('./runtime-workers/wasm-lean4-runner-worker.js', import.meta.url);
const PLACEHOLDER = '__WASM_IDLE_LEAN4_ASSET_LOCK__';
const REQUEST_TIMEOUT_MS = 120_000;
const MAX_ATTEMPTS = 3;
const MAX_ASSET_BYTES = 24_000_000;
const MAX_WASM_BYTES = 512 * 1024 * 1024;
const MAX_CHUNK_BYTES = 48 * 1024 * 1024;
const REQUIRED_ASSETS = [
	'producer-receipt.json',
	'lean.mjs',
	'lean.wasm.gz.bin',
	'lean-init.index.json'
];
const LIBRARY_EXTENSIONS = ['.olean', '.olean.server', '.olean.private', '.ir', '.ir.sig'];
const SHA256 = /^[0-9a-f]{64}$/;
/** @param {any} value @param {number} max */
const validSize = (value, max) => Number.isSafeInteger(value) && value > 0 && value <= max;
/** @param {any} asset @param {number} max */
const validDigest = (asset, max) =>
	validSize(asset?.bytes, max) && typeof asset.sha256 === 'string' && SHA256.test(asset.sha256);
/** @param {Uint8Array} bytes */
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

/** Reject an incomplete or unsafe lock before reading local paths or downloading files. @param {any} lock */
export function validateLean4Lock(lock) {
	if (lock.schemaVersion !== 1 || !lock.assets || !lock.notices)
		throw new Error('Unsupported Lean 4 asset lock.');
	for (const name of REQUIRED_ASSETS)
		if (!Object.hasOwn(lock.assets, name))
			throw new Error(`Lean 4 lock is missing required asset ${name}.`);
	for (const name of ['LICENSE', 'LICENSE.libuv'])
		if (!Object.hasOwn(lock.notices, name))
			throw new Error(`Lean 4 lock is missing required notice ${name}.`);
	if (
		Object.keys(lock.notices).some((name) => !['LICENSE', 'LICENSE.libuv'].includes(name)) ||
		Object.keys(lock.assets).some((name) => ['LICENSE', 'LICENSE.libuv'].includes(name))
	)
		throw new Error('Lean 4 runtime and notice asset sets must be disjoint.');
	for (const [name, asset] of Object.entries({ ...lock.assets, ...lock.notices })) {
		const chunk = /^lean-init-\d{2,}\.pack\.gz\.bin$/.test(name);
		if (
			(!REQUIRED_ASSETS.includes(name) &&
				!['LICENSE', 'LICENSE.libuv'].includes(name) &&
				!chunk) ||
			!validDigest(asset, MAX_ASSET_BYTES) ||
			asset.upstream !== name.replace(/\.gz\.bin$/, '.gz')
		)
			throw new Error(`Invalid Lean 4 asset lock entry ${name}.`);
		if (chunk || name === 'lean.wasm.gz.bin') {
			if (
				asset.encoding !== 'gzip' ||
				asset.logicalName !== asset.upstream.replace(/\.gz$/, '') ||
				!validDigest(asset.uncompressed, chunk ? MAX_CHUNK_BYTES : MAX_WASM_BYTES)
			)
				throw new Error(`Invalid Lean 4 decoded receipt ${name}.`);
		} else if (asset.encoding || asset.uncompressed || asset.logicalName) {
			throw new Error(`Unexpected Lean 4 encoding for ${name}.`);
		}
	}
}

/** Verify the producer contract as well as the independently reviewed asset identities.
 * @param {any} lock @param {Map<string, Uint8Array>} verified
 */
export function verifyLean4Release(lock, verified) {
	validateLean4Lock(lock);
	/** @param {string} name */
	const bytesFor = (name) => {
		const bytes = verified.get(name);
		if (!bytes) throw new Error(`Lean 4 verified asset ${name} is missing.`);
		return bytes;
	};
	const receipt = JSON.parse(Buffer.from(bytesFor('producer-receipt.json')).toString('utf8'));
	if (
		receipt.schemaVersion !== 1 ||
		receipt.producerId !== 'wasm-llvm/lean-browser' ||
		receipt.sources?.lean4?.commit !== lock.source ||
		receipt.sources?.lean4?.version !== lock.version ||
		receipt.acceptance?.node?.program?.exitCode !== 0 ||
		receipt.acceptance?.node?.program?.stdout !== 'Hello, 안녕!\nsum = 40\n' ||
		receipt.acceptance?.node?.diagnostic?.exitCode !== 1
	)
		throw new Error('Lean 4 producer receipt does not match the reviewed release.');
	const declared = Object.entries({ ...lock.assets, ...lock.notices }).filter(
		([name]) => name !== 'producer-receipt.json'
	);
	if (
		!receipt.assets ||
		JSON.stringify(Object.keys(receipt.assets).sort()) !==
			JSON.stringify(declared.map(([, asset]) => asset.upstream).sort())
	)
		throw new Error('Lean 4 producer receipt has a different required asset set.');
	for (const [, asset] of declared) {
		const entry = receipt.assets[asset.upstream];
		if (
			entry?.bytes !== asset.bytes ||
			entry?.sha256 !== asset.sha256 ||
			(asset.upstream === 'lean.wasm.gz' &&
				JSON.stringify(entry.uncompressed) !== JSON.stringify(asset.uncompressed))
		)
			throw new Error(`Lean 4 producer receipt differs from the lock for ${asset.upstream}.`);
	}
	if (receipt.requalification) {
		const { kind, compilerRebuilt, originalReceipt, originalReceiptSha256 } =
			receipt.requalification;
		if (
			kind !== 'same-byte-repackage' ||
			compilerRebuilt !== false ||
			!originalReceipt ||
			sha256(Buffer.from(`${JSON.stringify(originalReceipt, null, '\t')}\n`)) !==
				originalReceiptSha256
		)
			throw new Error('Invalid Lean 4 same-byte requalification provenance.');
		for (const field of [
			'assets',
			'sources',
			'bootstrap',
			'patches',
			'manifestSha256',
			'runtime'
		])
			if (JSON.stringify(originalReceipt[field]) !== JSON.stringify(receipt[field]))
				throw new Error(`Lean 4 requalification changed original ${field}.`);
		const recipes = new Set([
			...Object.keys(originalReceipt.recipe ?? {}),
			...Object.keys(receipt.recipe ?? {})
		]);
		for (const name of recipes)
			if (
				!['scripts/package.mjs', 'scripts/publish-directory.mjs'].includes(name) &&
				originalReceipt.recipe?.[name] !== receipt.recipe?.[name]
			)
				throw new Error(`Lean 4 requalification changed build recipe ${name}.`);
	}
	const index = JSON.parse(Buffer.from(bytesFor('lean-init.index.json')).toString('utf8'));
	if (
		index.schemaVersion !== 1 ||
		index.root !== '/lean/lib/lean' ||
		!validSize(index.totalBytes, Number.MAX_SAFE_INTEGER) ||
		!validSize(index.modules, Number.MAX_SAFE_INTEGER) ||
		index.modules !== receipt.library ||
		!SHA256.test(index.sha256) ||
		!Array.isArray(index.chunks) ||
		!index.chunks.length ||
		!Array.isArray(index.files)
	)
		throw new Error('Invalid Lean 4 library index.');
	let offset = 0;
	const chunkNames = new Set();
	for (const chunk of index.chunks) {
		const asset = lock.assets[`${chunk.path}.bin`];
		if (
			typeof chunk.path !== 'string' ||
			!/^lean-init-\d{2,}\.pack\.gz$/.test(chunk.path) ||
			chunkNames.has(chunk.path) ||
			!asset ||
			chunk.offset !== offset ||
			!validSize(chunk.uncompressedBytes, MAX_CHUNK_BYTES) ||
			!Number.isSafeInteger(offset + chunk.uncompressedBytes) ||
			offset + chunk.uncompressedBytes > index.totalBytes ||
			chunk.bytes !== asset.bytes ||
			chunk.sha256 !== asset.sha256 ||
			chunk.uncompressedBytes !== asset.uncompressed.bytes ||
			chunk.uncompressedSha256 !== asset.uncompressed.sha256
		)
			throw new Error(`Invalid Lean 4 library chunk ${chunk.path}.`);
		chunkNames.add(chunk.path);
		offset += chunk.uncompressedBytes;
	}
	if (
		offset !== index.totalBytes ||
		Object.keys(lock.assets).some(
			(name) => name.endsWith('.pack.gz.bin') && !chunkNames.has(name.slice(0, -4))
		)
	)
		throw new Error('Lean 4 library chunks do not cover the locked pack.');
	offset = 0;
	const paths = new Set();
	for (const file of index.files) {
		if (
			typeof file.path !== 'string' ||
			!/^Init(\/[A-Za-z0-9_]+)*\.(olean(\.server|\.private)?|ir(\.sig)?)$/.test(file.path) ||
			paths.has(file.path) ||
			file.offset !== offset ||
			!validSize(file.bytes, index.totalBytes) ||
			!Number.isSafeInteger(offset + file.bytes) ||
			offset + file.bytes > index.totalBytes
		)
			throw new Error(`Invalid Lean 4 library entry ${file.path}.`);
		paths.add(file.path);
		offset += file.bytes;
	}
	const modules = [...paths].filter((name) => name.endsWith('.olean'));
	if (offset !== index.totalBytes || modules.length !== index.modules || !paths.has('Init.olean'))
		throw new Error('Lean 4 library files do not cover the declared modules and pack.');
	for (const name of modules)
		for (const extension of LIBRARY_EXTENSIONS)
			if (!paths.has(name.replace(/\.olean$/, extension)))
				throw new Error(`Lean 4 module ${name} is missing ${extension}.`);
	const wasmAsset = lock.assets['lean.wasm.gz.bin'];
	const wasm = gunzipSync(bytesFor('lean.wasm.gz.bin'), {
		maxOutputLength: wasmAsset.uncompressed.bytes
	});
	if (
		wasm.length !== wasmAsset.uncompressed.bytes ||
		sha256(wasm) !== wasmAsset.uncompressed.sha256 ||
		!WebAssembly.validate(wasm)
	)
		throw new Error('Lean 4 runtime decodes to unreviewed or invalid WebAssembly.');
	const packDigest = createHash('sha256');
	// Verify one bounded chunk at a time, in index order rather than object-key order.
	for (const chunk of index.chunks) {
		const decoded = gunzipSync(bytesFor(`${chunk.path}.bin`), {
			maxOutputLength: chunk.uncompressedBytes
		});
		if (
			decoded.length !== chunk.uncompressedBytes ||
			sha256(decoded) !== chunk.uncompressedSha256
		)
			throw new Error(`Lean 4 ${chunk.path} decodes to unreviewed bytes.`);
		packDigest.update(decoded);
	}
	if (packDigest.digest('hex') !== index.sha256)
		throw new Error('Lean 4 library pack digest mismatch.');
}

/** @param {any} lock */
export function releaseBaseUrl(lock) {
	const { repository, revision, path: artifactPath } = lock.producer;
	if (repository !== 'https://github.com/seo-rii/wasm-llvm' || !/^[0-9a-f]{40}$/.test(revision))
		throw new Error('Lean 4 lock must pin a seo-rii/wasm-llvm commit.');
	return `https://raw.githubusercontent.com/seo-rii/wasm-llvm/${revision}/${artifactPath}/`;
}

/** @param {string} url @param {number} expectedBytes @param {typeof fetch} fetchImpl */
async function download(url, expectedBytes, fetchImpl) {
	let lastError;
	for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
		try {
			const response = await fetchImpl(url, {
				redirect: 'error',
				signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
			});
			if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
			const bytes = new Uint8Array(await response.arrayBuffer());
			if (bytes.length !== expectedBytes)
				throw new Error(`${url} returned ${bytes.length} bytes, expected ${expectedBytes}`);
			return bytes;
		} catch (error) {
			lastError = error;
		}
	}
	throw lastError;
}

/**
 * @param {{ sourceDir?: string; targetDir?: string; versionModulePath?: string; fetchImpl?: typeof fetch }} [options]
 */
export async function syncWasmLean4Assets({
	sourceDir,
	targetDir = path.join(root, 'static/wasm-lean4'),
	versionModulePath = path.join(root, 'packages/lsp/src/bundledLean4Runtime.ts'),
	fetchImpl = globalThis.fetch
} = {}) {
	const lock = JSON.parse(await readFile(LOCK_URL, 'utf8'));
	validateLean4Lock(lock);
	const baseUrl = releaseBaseUrl(lock);
	/** @type {Map<string, Uint8Array>} */
	const verified = new Map();
	for (const [name, receipt] of Object.entries({ ...lock.assets, ...lock.notices })) {
		const bytes = sourceDir
			? new Uint8Array(await readFile(path.join(sourceDir, receipt.upstream)))
			: await download(new URL(receipt.upstream, baseUrl).href, receipt.bytes, fetchImpl);
		if (bytes.length !== receipt.bytes || sha256(bytes) !== receipt.sha256)
			throw new Error(`Lean 4 ${receipt.upstream} does not match the reviewed lock.`);
		verified.set(name, bytes);
	}
	verifyLean4Release(lock, verified);
	const workerSource = await readFile(WORKER_URL, 'utf8');
	if (workerSource.split(PLACEHOLDER).length !== 2)
		throw new Error('Lean 4 worker must contain exactly one asset-lock placeholder.');
	const runtimeLock = { ...lock };
	delete runtimeLock.notices;
	const worker = Buffer.from(workerSource.replace(PLACEHOLDER, JSON.stringify(runtimeLock)));
	const workerReceipt = { bytes: worker.length, sha256: sha256(worker) };
	const { format } = await import('prettier');
	const version = await format(
		`// Generated by sync:wasm-lean4 from the reviewed asset lock.\nexport const WASM_LEAN4_PROFILE = ${JSON.stringify({ ...runtimeLock, workerReceipt }, null, '\t')} as const;\n`,
		{
			parser: 'typescript',
			printWidth: 100,
			singleQuote: true,
			tabWidth: 4,
			trailingComma: 'none',
			useTabs: true
		}
	);
	await publish({ targetDir, versionModulePath, verified, worker, version });
	return { baseUrl, targetDir: path.resolve(targetDir), workerReceipt };
}

/** @param {{ targetDir: string; versionModulePath: string; verified: Map<string, Uint8Array>; worker: Uint8Array; version: string }} options */
async function publish({ targetDir, versionModulePath, verified, worker, version }) {
	const staging = `${path.resolve(targetDir)}.staging-${randomUUID()}`;
	const backup = `${path.resolve(targetDir)}.backup-${randomUUID()}`;
	const stagedVersion = `${path.resolve(versionModulePath)}.staging-${randomUUID()}`;
	await mkdir(staging, { recursive: true });
	let moved = false;
	let published = false;
	let complete = false;
	try {
		for (const [name, bytes] of verified) await writeFile(path.join(staging, name), bytes);
		await writeFile(path.join(staging, 'runner-worker.js'), worker);
		await mkdir(path.dirname(versionModulePath), { recursive: true });
		await writeFile(stagedVersion, version, { flag: 'wx' });
		try {
			await rename(targetDir, backup);
			moved = true;
		} catch (error) {
			if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT')
				throw error;
		}
		await rename(staging, targetDir);
		published = true;
		await rename(stagedVersion, versionModulePath);
		complete = true;
	} catch (error) {
		if (published) await rm(targetDir, { recursive: true, force: true });
		if (moved) await rename(backup, targetDir);
		throw error;
	} finally {
		const cleanup = [
			{ path: staging, options: { recursive: true, force: true } },
			{ path: stagedVersion, options: { force: true } },
			...(complete && moved ? [{ path: backup, options: { recursive: true } }] : [])
		];
		for (const entry of cleanup) {
			try {
				await rm(entry.path, entry.options);
			} catch (error) {
				if (!complete) throw error;
				console.warn(
					`Lean 4 runtime and profile were published, but cleanup failed for ${entry.path}: ${error instanceof Error ? error.message : error}. Remove this leftover path manually.`
				);
			}
		}
	}
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const args = process.argv.slice(2);
	if (args.length && (args[0] !== '--source' || args.length !== 2))
		throw new Error(
			'Usage: sync-wasm-lean4.mjs [--source /path/to/wasm-llvm/artifacts/lean-browser]'
		);
	console.log(
		JSON.stringify(await syncWasmLean4Assets({ sourceDir: args[1] && path.resolve(args[1]) }))
	);
}
