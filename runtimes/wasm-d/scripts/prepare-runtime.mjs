import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

const THIS_FILE = fileURLToPath(import.meta.url);
const RUNTIME_ROOT = path.resolve(path.dirname(THIS_FILE), '..');
const LOCK_PATH = path.join(RUNTIME_ROOT, 'producer-lock.json');
export const D_PRODUCER_ARTIFACTS = Object.freeze([
	'bin/ldc2.wasm.gz',
	'bin/lld.js',
	'bin/lld.wasm.gz',
	'bin/lld.data.gz',
	'toolchain/toolchain.tar.gz',
	'runtime-manifest.v1.json',
	'runtime-build.json'
]);

/** @typedef {{ schemaVersion: number, producerId: string, manifestSha256: string, sourceLockSha256: string, receiptSha256: string }} DProducerLock */

/** @param {Uint8Array} bytes */
function sha256(bytes) {
	return createHash('sha256').update(bytes).digest('hex');
}

/**
 * Verify the immutable producer receipt before trusting any receipt-selected bytes.
 * @param {string} sourceDir
 * @param {DProducerLock} [lock]
 */
export async function verifyDProducerArtifacts(sourceDir, lock) {
	lock ??= JSON.parse(await readFile(LOCK_PATH, 'utf8'));
	if (
		!lock ||
		lock.schemaVersion !== 1 ||
		lock.producerId !== 'wasm-llvm/d-browser' ||
		!/^[a-f0-9]{64}$/.test(lock.receiptSha256)
	) {
		throw new Error('Invalid wasm-d producer lock');
	}
	const receiptBytes = await readFile(path.join(sourceDir, 'producer-receipt.json'));
	if (sha256(receiptBytes) !== lock.receiptSha256) {
		throw new Error('wasm-d producer receipt integrity mismatch');
	}
	const receipt = JSON.parse(receiptBytes.toString('utf8'));
	if (
		receipt.schemaVersion !== 1 ||
		receipt.format !== 'wasm-llvm-d-browser-artifacts-v1' ||
		receipt.producerId !== lock.producerId ||
		receipt.manifestSha256 !== lock.manifestSha256 ||
		receipt.sourceLockSha256 !== lock.sourceLockSha256
	) {
		throw new Error('wasm-d producer receipt does not match the pinned producer contract');
	}
	if (
		!Array.isArray(receipt.artifacts) ||
		receipt.artifacts.length !== D_PRODUCER_ARTIFACTS.length ||
		new Set(receipt.artifacts.map((entry) => entry.path)).size !==
			D_PRODUCER_ARTIFACTS.length ||
		receipt.artifacts.some((entry) => !D_PRODUCER_ARTIFACTS.includes(entry.path))
	) {
		throw new Error(
			'wasm-d producer receipt must contain exactly the required runtime artifacts'
		);
	}
	/** @type {Map<string, Buffer>} */
	const files = new Map([['producer-receipt.json', receiptBytes]]);
	for (const entry of receipt.artifacts) {
		if (
			!Number.isSafeInteger(entry.bytes) ||
			entry.bytes <= 0 ||
			!/^[a-f0-9]{64}$/.test(entry.sha256)
		) {
			throw new Error(`Invalid wasm-d producer artifact receipt: ${entry.path}`);
		}
		const bytes = await readFile(path.join(sourceDir, entry.path));
		if (bytes.length !== entry.bytes || sha256(bytes) !== entry.sha256) {
			throw new Error(`wasm-d producer artifact integrity mismatch: ${entry.path}`);
		}
		if (entry.path.endsWith('.gz')) {
			if (
				!Number.isSafeInteger(entry.uncompressedBytes) ||
				entry.uncompressedBytes <= 0 ||
				!/^[a-f0-9]{64}$/.test(entry.uncompressedSha256)
			) {
				throw new Error(`Missing wasm-d producer logical receipt: ${entry.path}`);
			}
			const logical = gunzipSync(bytes, { maxOutputLength: entry.uncompressedBytes });
			if (
				logical.length !== entry.uncompressedBytes ||
				sha256(logical) !== entry.uncompressedSha256
			) {
				throw new Error(`wasm-d producer logical integrity mismatch: ${entry.path}`);
			}
		}
		files.set(entry.path, bytes);
	}
	return { receipt, files };
}

/** @param {{ sourceDir: string, targetDir: string, lock?: DProducerLock }} options */
export async function prepareDProducerRuntime({ sourceDir, targetDir, lock }) {
	if (!sourceDir) {
		throw new Error(
			'Set WASM_LLVM_D_ARTIFACT_DIR or --source to the pinned wasm-llvm d-browser artifact directory'
		);
	}
	if (path.resolve(sourceDir) === path.resolve(targetDir)) {
		throw new Error('wasm-d producer source and output directories must differ');
	}
	const { files } = await verifyDProducerArtifacts(sourceDir, lock);
	await mkdir(path.dirname(targetDir), { recursive: true });
	const stagedDir = await mkdtemp(path.join(path.dirname(targetDir), '.wasm-d-import-'));
	try {
		for (const [relativePath, bytes] of files) {
			const destination = path.join(stagedDir, relativePath);
			await mkdir(path.dirname(destination), { recursive: true });
			await writeFile(destination, bytes);
		}
		await rm(targetDir, { recursive: true, force: true });
		await rename(stagedDir, targetDir);
	} finally {
		await rm(stagedDir, { recursive: true, force: true });
	}
}

if (process.argv[1] && path.resolve(process.argv[1]) === THIS_FILE) {
	let sourceDir = process.env.WASM_LLVM_D_ARTIFACT_DIR;
	let targetDir =
		process.env.WASM_IDLE_D_RUNTIME_DIR || path.join(RUNTIME_ROOT, 'dist', 'runtime');
	const argv = process.argv.slice(2);
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === '--help' || arg === '-h') {
			console.log(
				'Usage: node prepare-runtime.mjs --source WASM_LLVM_D_ARTIFACT_DIR [--out DIR]'
			);
			process.exit(0);
		}
		const value = argv[++index];
		if (!value || value.startsWith('--')) throw new Error(`${arg} requires a value`);
		if (arg === '--source') sourceDir = value;
		else if (arg === '--out') targetDir = value;
		else throw new Error(`unexpected argument: ${arg}`);
	}
	await prepareDProducerRuntime({ sourceDir, targetDir: path.resolve(targetDir) });
	console.log(`Imported pinned wasm-llvm D browser artifacts into ${targetDir}`);
}
