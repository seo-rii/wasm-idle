import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const THIS_FILE = fileURLToPath(import.meta.url);
const THIS_DIR = path.dirname(THIS_FILE);
const REPO_ROOT = path.resolve(THIS_DIR, '..');
const DEFAULT_SOURCE_DIR = path.resolve(REPO_ROOT, 'runtimes', 'wasm-tinygo', 'dist');
const DEFAULT_TARGET_DIR = path.resolve(REPO_ROOT, 'static', 'wasm-tinygo');
const DEFAULT_VERSION_MODULE_PATH = path.resolve(
	REPO_ROOT,
	'src',
	'lib',
	'playground',
	'wasmTinyGoVersion.ts'
);
const TINYGO_PROFILE_FORMAT = 'wasm-idle-tinygo-runtime-profile-v1';
const TINYGO_PROFILE_ID = 'tinygo-0.40.1-wasip1-protocol-v6';
const TINYGO_PROTOCOL_VERSION = 6;
const UPSTREAM_MANIFEST_PATH = 'tools/upstream/upstream-toolchain.v2.json';
const STATIC_RUNTIME_MIN_COMPRESS_BYTES = 256 * 1024;
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;

/**
 * @param {string} relativePath
 */
function shouldInclude(relativePath) {
	const normalized = relativePath.split(path.sep).join('/');
	if (normalized.startsWith('assets/upstream-compile-worker-') && normalized.endsWith('.js')) {
		return true;
	}
	if (normalized.startsWith('tools/upstream/')) {
		return true;
	}
	return normalized === 'upstream.js';
}

/**
 * @param {string} rootDir
 * @returns {Promise<string[]>}
 */
async function listFiles(rootDir, baseDir = rootDir) {
	const entries = await readdir(rootDir, { withFileTypes: true });
	const files = [];
	for (const entry of entries) {
		const entryPath = path.join(rootDir, entry.name);
		if (entry.isDirectory()) {
			files.push(...(await listFiles(entryPath, baseDir)));
			continue;
		}
		if (entry.isFile()) {
			const relativePath = path.relative(baseDir, entryPath);
			if (shouldInclude(relativePath)) {
				files.push(entryPath);
			}
		}
	}
	return files.sort();
}

/**
 * @param {string} sourceDir
 */
async function computeBundleFingerprint(sourceDir) {
	const hash = createHash('sha256');
	for (const filePath of await listFiles(sourceDir)) {
		hash.update(path.relative(sourceDir, filePath));
		hash.update('\0');
		hash.update(await readFile(filePath));
		hash.update('\n');
	}
	return hash.digest('hex');
}

/** @param {Uint8Array} bytes */
function sha256(bytes) {
	return createHash('sha256').update(bytes).digest('hex');
}

/** @param {string} value */
function formatTypeScriptString(value) {
	return `'${value
		.replaceAll('\\', '\\\\')
		.replaceAll("'", "\\'")
		.replaceAll('\r', '\\r')
		.replaceAll('\n', '\\n')}'`;
}

/** @param {ReturnType<typeof makeAssetReceipt>} receipt @param {string} indent */
function formatReceiptFields(receipt, indent) {
	return Object.entries(receipt)
		.map(
			([property, value]) =>
				`${indent}${property}: ${
					typeof value === 'string' ? formatTypeScriptString(value) : value
				}`
		)
		.join(',\n');
}

/** @param {unknown} value @param {string} label */
function expectObject(value, label) {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error(`${label} must be an object`);
	}
	return /** @type {Record<string, unknown>} */ (value);
}

/** @param {unknown} value @param {string} label */
function parseEvidence(value, label) {
	const evidence = expectObject(value, label);
	if (
		typeof evidence.path !== 'string' ||
		!evidence.path ||
		evidence.path.startsWith('/') ||
		evidence.path.includes('\\') ||
		evidence.path.includes('\0') ||
		evidence.path.split('/').some((part) => !part || part === '.' || part === '..')
	) {
		throw new Error(`${label}.path must be a safe relative path`);
	}
	if (!Number.isSafeInteger(evidence.bytes) || /** @type {number} */ (evidence.bytes) < 0) {
		throw new Error(`${label}.bytes must be a non-negative safe integer`);
	}
	if (typeof evidence.sha256 !== 'string' || !SHA256_PATTERN.test(evidence.sha256)) {
		throw new Error(`${label}.sha256 must be a lowercase SHA-256`);
	}
	return /** @type {{ path: string; bytes: number; sha256: string }} */ (evidence);
}

/** @param {string} assetPath @param {Uint8Array} logicalBytes */
function makeAssetReceipt(assetPath, logicalBytes) {
	const shouldCompress =
		logicalBytes.byteLength >= STATIC_RUNTIME_MIN_COMPRESS_BYTES &&
		!assetPath.endsWith('.gz.bin');
	if (!shouldCompress) {
		return {
			bytes: logicalBytes.byteLength,
			sha256: sha256(logicalBytes)
		};
	}
	const storageBytes = gzipSync(logicalBytes, { level: 9 });
	return {
		bytes: storageBytes.byteLength,
		sha256: sha256(storageBytes),
		uncompressedBytes: logicalBytes.byteLength,
		uncompressedSha256: sha256(logicalBytes)
	};
}

/** @param {Record<string, ReturnType<typeof makeAssetReceipt>>} receipts */
function computeProfileFingerprint(receipts, manifestPath, manifestReceipt) {
	let canonical = `${TINYGO_PROFILE_FORMAT}\n`;
	canonical += `profile\0${TINYGO_PROFILE_ID}\0${TINYGO_PROTOCOL_VERSION}\n`;
	canonical += `manifest\0${manifestPath}\0${manifestReceipt.bytes}\0${manifestReceipt.sha256}\n`;
	for (const assetPath of Object.keys(receipts).sort()) {
		const receipt = receipts[assetPath];
		const logicalBytes = receipt.uncompressedBytes ?? receipt.bytes;
		const logicalSha256 = receipt.uncompressedSha256 ?? receipt.sha256;
		const storagePath = receipt.uncompressedSha256 ? `${assetPath}.gz` : assetPath;
		canonical += `asset\0${assetPath}\0${storagePath}\0${receipt.bytes}\0${receipt.sha256}\0${logicalBytes}\0${logicalSha256}\n`;
	}
	return sha256(new TextEncoder().encode(canonical));
}

/** @param {string} sourceDir */
async function createRuntimeProfile(sourceDir) {
	const manifestBytes = await readFile(path.join(sourceDir, UPSTREAM_MANIFEST_PATH));
	let manifestValue;
	try {
		manifestValue = JSON.parse(manifestBytes.toString('utf8'));
	} catch (error) {
		throw new Error('wasm-tinygo upstream toolchain manifest is not valid JSON', {
			cause: error
		});
	}
	const manifest = expectObject(manifestValue, 'wasm-tinygo upstream toolchain manifest');
	if (manifest.schemaVersion !== 2 || manifest.format !== 'wasm-idle-tinygo-upstream-assets-v2') {
		throw new Error('wasm-tinygo upstream toolchain manifest has an unsupported contract');
	}
	const assets = expectObject(manifest.assets, 'wasm-tinygo upstream toolchain manifest.assets');
	const evidenceEntries = [
		parseEvidence(manifest.producerReceipt, 'producerReceipt'),
		parseEvidence(manifest.packageGraphReceipt, 'packageGraphReceipt'),
		parseEvidence(assets.compiler, 'assets.compiler'),
		parseEvidence(assets.packageGraph, 'assets.packageGraph'),
		parseEvidence(assets.rootArchive, 'assets.rootArchive'),
		parseEvidence(assets.lld, 'assets.lld')
	];
	const manifestDirectory = path.posix.dirname(UPSTREAM_MANIFEST_PATH);
	/** @type {Record<string, ReturnType<typeof makeAssetReceipt>>} */
	const assetReceipts = {};
	for (const evidence of evidenceEntries) {
		const assetPath = path.posix.join(manifestDirectory, evidence.path);
		const bytes = await readFile(path.join(sourceDir, assetPath));
		const logicalSha256 = sha256(bytes);
		if (bytes.byteLength !== evidence.bytes || logicalSha256 !== evidence.sha256) {
			throw new Error(`wasm-tinygo upstream manifest does not bind ${assetPath}`);
		}
		if (Object.prototype.hasOwnProperty.call(assetReceipts, assetPath)) {
			throw new Error(`wasm-tinygo upstream manifest repeats ${assetPath}`);
		}
		assetReceipts[assetPath] = makeAssetReceipt(assetPath, bytes);
	}
	const manifestReceipt = {
		bytes: manifestBytes.byteLength,
		sha256: sha256(manifestBytes)
	};
	return {
		profileId: TINYGO_PROFILE_ID,
		protocolVersion: TINYGO_PROTOCOL_VERSION,
		manifestPath: UPSTREAM_MANIFEST_PATH,
		manifestFingerprint: computeProfileFingerprint(
			assetReceipts,
			UPSTREAM_MANIFEST_PATH,
			manifestReceipt
		),
		manifestReceipt,
		assetReceipts
	};
}

/**
 * @param {string} versionModulePath
 * @param {string} fingerprint
 */
async function writeVersionModule(versionModulePath, fingerprint, profile) {
	await mkdir(path.dirname(versionModulePath), { recursive: true });
	const assetReceipts = Object.entries(profile.assetReceipts)
		.sort(([left], [right]) => left.localeCompare(right))
		.map(
			([assetPath, receipt]) =>
				`\t\t${formatTypeScriptString(assetPath)}: Object.freeze({\n${formatReceiptFields(receipt, '\t\t\t')}\n\t\t})`
		)
		.join(',\n');
	const moduleSource = `export const WASM_TINYGO_RUNTIME_PROFILE = Object.freeze({
\tprofileId: ${formatTypeScriptString(profile.profileId)},
\tprotocolVersion: ${profile.protocolVersion},
\tmanifestPath: ${formatTypeScriptString(profile.manifestPath)},
\tmanifestFingerprint: ${formatTypeScriptString(profile.manifestFingerprint)},
\tmanifestReceipt: Object.freeze({
${formatReceiptFields(profile.manifestReceipt, '\t\t')}
\t}),
\tassetReceipts: Object.freeze({
${assetReceipts}
\t})
});

export const WASM_TINYGO_ASSET_VERSION =
\t${formatTypeScriptString(fingerprint)};
`;
	const current = await readFile(versionModulePath, 'utf8').catch(() => '');
	if (current === moduleSource) return;
	await writeFile(versionModulePath, moduleSource, 'utf8');
}

/**
 * @param {{ sourceDir?: string; targetDir?: string; versionModulePath?: string }} [options]
 */
export async function syncWasmTinyGoDist({
	sourceDir = DEFAULT_SOURCE_DIR,
	targetDir = DEFAULT_TARGET_DIR,
	versionModulePath = DEFAULT_VERSION_MODULE_PATH
} = {}) {
	const sourceStats = await stat(sourceDir).catch(() => null);
	if (!sourceStats?.isDirectory()) {
		throw new Error(
			`wasm-tinygo dist directory was not found at ${sourceDir}. Build the public runtime first with "pnpm --dir runtimes/wasm-tinygo build:upstream".`
		);
	}
	const upstreamModulePath = path.join(sourceDir, 'upstream.js');
	const upstreamModuleStats = await stat(upstreamModulePath).catch(() => null);
	if (!upstreamModuleStats?.isFile()) {
		throw new Error(`wasm-tinygo upstream module was not found at ${upstreamModulePath}.`);
	}
	const [fingerprint, profile] = await Promise.all([
		computeBundleFingerprint(sourceDir),
		createRuntimeProfile(sourceDir)
	]);

	await rm(targetDir, { recursive: true, force: true });
	await mkdir(targetDir, { recursive: true });
	const filesToCopy = await listFiles(sourceDir);
	for (const sourcePath of filesToCopy) {
		const relativePath = path.relative(sourceDir, sourcePath);
		const targetPath = path.join(targetDir, relativePath);
		await mkdir(path.dirname(targetPath), { recursive: true });
		await cp(sourcePath, targetPath);
	}
	await writeVersionModule(versionModulePath, fingerprint, profile);

	return {
		sourceDir,
		targetDir,
		fingerprint,
		profile,
		versionModulePath
	};
}

if (process.argv[1] && path.resolve(process.argv[1]) === THIS_FILE) {
	const [, , sourceDirArg, targetDirArg] = process.argv;
	const { sourceDir, targetDir } = await syncWasmTinyGoDist({
		sourceDir: sourceDirArg || DEFAULT_SOURCE_DIR,
		targetDir: targetDirArg || DEFAULT_TARGET_DIR
	});

	console.log(`Synced wasm-tinygo from ${sourceDir} to ${targetDir}`);
}
