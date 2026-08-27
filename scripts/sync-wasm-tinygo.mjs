import {
	cp,
	lstat,
	mkdir,
	open,
	readdir,
	readFile,
	realpath,
	rename,
	rm,
	unlink,
	writeFile
} from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const THIS_FILE = fileURLToPath(import.meta.url);
const THIS_DIR = path.dirname(THIS_FILE);
const REPO_ROOT = path.resolve(THIS_DIR, '..');
const DEFAULT_TARGET_DIR = path.resolve(REPO_ROOT, 'static', 'wasm-tinygo');
const DEFAULT_VERSION_MODULE_PATH = path.resolve(
	REPO_ROOT,
	'src',
	'lib',
	'playground',
	'wasmTinyGoVersion.ts'
);
const DEFAULT_GRAPH_LOCK_PATH = path.resolve(THIS_DIR, 'wasm-tinygo-assets.lock.json');
const TINYGO_PROFILE_FORMAT = 'wasm-idle-tinygo-runtime-profile-v1';
const TINYGO_PROFILE_ID = 'tinygo-0.40.1-wasip1-protocol-v6';
const TINYGO_PROTOCOL_VERSION = 6;
const UPSTREAM_MANIFEST_PATH = 'tools/upstream/upstream-toolchain.v2.json';
const STATIC_RUNTIME_MIN_COMPRESS_BYTES = 256 * 1024;
const GRAPH_LOCK_FORMAT = 'wasm-idle-tinygo-executable-graph-lock-v1';
export const TINYGO_EXECUTABLE_GRAPH_FORMAT = 'wasm-idle-tinygo-executable-graph-v1';
export const TINYGO_EXECUTABLE_GRAPH_FINGERPRINT_DOMAIN = 'wasm-idle:tinygo-executable-graph:v1\n';
export const TINYGO_EXECUTABLE_GRAPH_MANIFEST_PATH = 'runtime-executable-graph.v1.json';
const SYNC_LOCK_FORMAT = 'wasm-idle-tinygo-sync-lock-v1';
const SYNC_TRANSACTION_FORMAT = 'wasm-idle-tinygo-sync-transaction-v1';
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const SAFE_PATH_PATTERN = /^[A-Za-z0-9._/-]+$/u;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const GRAPH_KINDS = new Set(['dynamic', 'static', 'worker']);
const MAX_GRAPH_MODULES = 32;
const MAX_GRAPH_IMPORTS = 128;

/** @param {string} left @param {string} right */
function compareCodeUnits(left, right) {
	return left === right ? 0 : left < right ? -1 : 1;
}

/** @param {Uint8Array} bytes */
function sha256(bytes) {
	return createHash('sha256').update(bytes).digest('hex');
}

/** @param {unknown} value */
function isObject(value) {
	return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

/** @param {unknown} value @param {string} label */
function expectObject(value, label) {
	if (!isObject(value)) throw new Error(`${label} must be an object`);
	return /** @type {Record<string, unknown>} */ (value);
}

/** @param {Record<string, unknown>} value @param {string[]} keys @param {string} label */
function assertExactKeys(value, keys, label) {
	const actual = Object.keys(value).sort(compareCodeUnits);
	const expected = [...keys].sort(compareCodeUnits);
	if (JSON.stringify(actual) !== JSON.stringify(expected)) {
		throw new Error(`${label} must contain exactly: ${expected.join(', ')}`);
	}
}

/** @param {unknown} value @param {string} label */
function requireSafeInteger(value, label) {
	if (!Number.isSafeInteger(value) || /** @type {number} */ (value) < 0) {
		throw new Error(`${label} must be a non-negative safe integer`);
	}
	return /** @type {number} */ (value);
}

/** @param {unknown} value @param {string} label */
function requireSha256(value, label) {
	if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) {
		throw new Error(`${label} must be a lowercase SHA-256`);
	}
	return value;
}

/** @param {unknown} value @param {string} label */
function requireCanonicalString(value, label) {
	if (
		typeof value !== 'string' ||
		value.length === 0 ||
		value.includes('\0') ||
		value.includes('\r') ||
		value.includes('\n')
	) {
		throw new Error(`${label} must be a non-empty single-line string`);
	}
	return value;
}

/** @param {unknown} value @param {string} label */
function requireSafeRelativePath(value, label) {
	const candidate = requireCanonicalString(value, label);
	if (
		candidate.startsWith('/') ||
		!SAFE_PATH_PATTERN.test(candidate) ||
		candidate.includes('\\') ||
		candidate.includes('?') ||
		candidate.includes('#') ||
		candidate.split('/').some((part) => !part || part === '.' || part === '..') ||
		path.posix.normalize(candidate) !== candidate
	) {
		throw new Error(`${label} must be a safe canonical relative path`);
	}
	return candidate;
}

/** @param {unknown} value @param {string} label */
function requireGraphSpecifier(value, label) {
	const candidate = requireCanonicalString(value, label);
	const segments = candidate.split('/');
	if (
		candidate.startsWith('/') ||
		candidate.includes('\\') ||
		candidate.includes('?') ||
		candidate.includes('#') ||
		candidate.includes(':') ||
		segments.some(
			(part) => !part || part === '..' || (part !== '.' && !/^[A-Za-z0-9._-]+$/u.test(part))
		)
	) {
		throw new Error(`${label} must be a safe local module specifier`);
	}
	return candidate;
}

/** @param {string} importer @param {string} specifier */
function resolveGraphSpecifier(importer, specifier) {
	const normalizedSpecifier = specifier.startsWith('./') ? specifier.slice(2) : specifier;
	const target = path.posix.normalize(
		path.posix.join(path.posix.dirname(importer), normalizedSpecifier)
	);
	return requireSafeRelativePath(target, `resolved import ${specifier}`);
}

/**
 * @typedef {{ specifier: string; target: string; kind: 'static' | 'dynamic' | 'worker' }} GraphImport
 * @typedef {{ path: string; bytes: number; sha256: string; imports: GraphImport[] }} GraphLockModule
 */

/** @param {Uint8Array} bytes */
export function parseTinyGoExecutableGraphLock(bytes) {
	let parsed;
	try {
		parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
	} catch (error) {
		throw new Error('wasm-tinygo executable graph lock is not valid UTF-8 JSON', {
			cause: error
		});
	}
	const root = expectObject(parsed, 'wasm-tinygo executable graph lock');
	assertExactKeys(root, ['entryPath', 'format', 'modules'], 'wasm-tinygo executable graph lock');
	if (root.format !== GRAPH_LOCK_FORMAT) {
		throw new Error('wasm-tinygo executable graph lock has an unsupported format');
	}
	const entryPath = requireSafeRelativePath(root.entryPath, 'executable graph entryPath');
	if (
		!Array.isArray(root.modules) ||
		root.modules.length === 0 ||
		root.modules.length > MAX_GRAPH_MODULES
	) {
		throw new Error('wasm-tinygo executable graph lock.modules must be a non-empty array');
	}
	/** @type {Map<string, GraphLockModule>} */
	const modules = new Map();
	let importCount = 0;
	for (const [index, rawModule] of root.modules.entries()) {
		const module = expectObject(rawModule, `executable graph module ${index}`);
		assertExactKeys(
			module,
			['bytes', 'imports', 'path', 'sha256'],
			`executable graph module ${index}`
		);
		const modulePath = requireSafeRelativePath(
			module.path,
			`executable graph module ${index}.path`
		);
		if (!modulePath.endsWith('.js')) {
			throw new Error(`executable graph module ${modulePath} must be JavaScript`);
		}
		if (modules.has(modulePath)) {
			throw new Error(`wasm-tinygo executable graph repeats module ${modulePath}`);
		}
		if (!Array.isArray(module.imports)) {
			throw new Error(`executable graph module ${modulePath}.imports must be an array`);
		}
		/** @type {GraphImport[]} */
		const imports = [];
		const importSpecifiers = new Set();
		for (const [importIndex, rawImport] of module.imports.entries()) {
			const graphImport = expectObject(
				rawImport,
				`executable graph module ${modulePath}.imports[${importIndex}]`
			);
			assertExactKeys(
				graphImport,
				['kind', 'specifier', 'target'],
				`executable graph module ${modulePath}.imports[${importIndex}]`
			);
			if (typeof graphImport.kind !== 'string' || !GRAPH_KINDS.has(graphImport.kind)) {
				throw new Error(`executable graph module ${modulePath} has an invalid import kind`);
			}
			const specifier = requireGraphSpecifier(
				graphImport.specifier,
				`executable graph module ${modulePath} import specifier`
			);
			const target = requireSafeRelativePath(
				graphImport.target,
				`executable graph module ${modulePath} import target`
			);
			if (resolveGraphSpecifier(modulePath, specifier) !== target) {
				throw new Error(
					`executable graph module ${modulePath} import ${specifier} does not resolve to ${target}`
				);
			}
			if (importSpecifiers.has(specifier)) {
				throw new Error(
					`executable graph module ${modulePath} repeats import ${specifier}`
				);
			}
			importSpecifiers.add(specifier);
			importCount += 1;
			if (importCount > MAX_GRAPH_IMPORTS) {
				throw new Error('wasm-tinygo executable graph contains too many imports');
			}
			imports.push({
				specifier,
				target,
				kind: /** @type {'static' | 'dynamic' | 'worker'} */ (graphImport.kind)
			});
		}
		const moduleBytes = requireSafeInteger(
			module.bytes,
			`executable graph module ${modulePath}.bytes`
		);
		if (moduleBytes === 0) {
			throw new Error(`executable graph module ${modulePath}.bytes must be positive`);
		}
		modules.set(modulePath, {
			path: modulePath,
			bytes: moduleBytes,
			sha256: requireSha256(module.sha256, `executable graph module ${modulePath}.sha256`),
			imports
		});
	}
	if (!modules.has(entryPath)) {
		throw new Error(`wasm-tinygo executable graph entry is unknown: ${entryPath}`);
	}
	for (const module of modules.values()) {
		for (const graphImport of module.imports) {
			if (!modules.has(graphImport.target)) {
				throw new Error(
					`wasm-tinygo executable graph has an unknown edge ${module.path} -> ${graphImport.target}`
				);
			}
		}
	}
	const visiting = new Set();
	const visited = new Set();
	/** @param {string} modulePath */
	const visit = (modulePath) => {
		if (visiting.has(modulePath)) {
			throw new Error(`wasm-tinygo executable graph contains a cycle at ${modulePath}`);
		}
		if (visited.has(modulePath)) return;
		visiting.add(modulePath);
		for (const graphImport of /** @type {GraphLockModule} */ (modules.get(modulePath))
			.imports) {
			visit(graphImport.target);
		}
		visiting.delete(modulePath);
		visited.add(modulePath);
	};
	visit(entryPath);
	const reachable = new Set([entryPath]);
	const queue = [entryPath];
	while (queue.length > 0) {
		const modulePath = /** @type {string} */ (queue.shift());
		for (const graphImport of /** @type {GraphLockModule} */ (modules.get(modulePath))
			.imports) {
			if (!reachable.has(graphImport.target)) {
				reachable.add(graphImport.target);
				queue.push(graphImport.target);
			}
		}
	}
	if (reachable.size !== modules.size) {
		const unreachable = [...modules.keys()]
			.filter((modulePath) => !reachable.has(modulePath))
			.sort(compareCodeUnits);
		throw new Error(
			`wasm-tinygo executable graph contains unreachable modules: ${unreachable.join(', ')}`
		);
	}
	return Object.freeze({ entryPath, modules });
}

/** @param {string} source @param {string} importer */
export function extractTinyGoExecutableImports(source, importer) {
	/** @type {Array<GraphImport & { index: number }>} */
	const imports = [];
	/** @param {number} index @param {'static'|'dynamic'|'worker'} kind @param {string} specifier */
	const add = (index, kind, specifier) => {
		if (!specifier.endsWith('.js')) {
			throw new Error(
				`wasm-tinygo executable module ${importer} has an unsupported import: ${specifier}`
			);
		}
		const safeSpecifier = requireGraphSpecifier(
			specifier,
			`wasm-tinygo executable module ${importer} import`
		);
		imports.push({
			index,
			specifier: safeSpecifier,
			target: resolveGraphSpecifier(importer, safeSpecifier),
			kind
		});
	};
	for (const match of source.matchAll(/\bimport\s*\(\s*(["'`])([^"'`\r\n]+)\1\s*\)/gu)) {
		add(match.index, 'dynamic', match[2]);
	}
	for (const match of source.matchAll(
		/(?:^|[;}\n])\s*import(?!\s*\()\s*[\w$*{},\s]{0,512}?from\s*(["'`])([^"'`\r\n]+)\1/gu
	)) {
		add(match.index, 'static', match[2]);
	}
	for (const match of source.matchAll(
		/(?:^|[;}\n])\s*import(?!\s*\()\s*(["'`])([^"'`\r\n]+)\1/gu
	)) {
		add(match.index, 'static', match[2]);
	}
	for (const match of source.matchAll(
		/\bnew\s+URL\s*\(\s*(["'`])([^"'`\r\n]+)\1\s*,\s*import\.meta\.url\s*\)/gu
	)) {
		if (match[2].endsWith('.js')) add(match.index, 'worker', match[2]);
	}
	imports.sort((left, right) => left.index - right.index);
	const seen = new Set();
	return imports.map(({ index: _index, ...graphImport }) => {
		if (seen.has(graphImport.specifier)) {
			throw new Error(
				`wasm-tinygo executable module ${importer} repeats import ${graphImport.specifier}`
			);
		}
		seen.add(graphImport.specifier);
		return graphImport;
	});
}

/** @param {string} rootDir @param {string} [baseDir] */
async function listRegularFiles(rootDir, baseDir = rootDir) {
	const rootStats = await lstat(rootDir).catch(() => null);
	if (!rootStats?.isDirectory()) {
		throw new Error(`wasm-tinygo directory is missing or unsafe: ${rootDir}`);
	}
	const files = [];
	for (const name of (await readdir(rootDir)).sort(compareCodeUnits)) {
		const candidate = path.join(rootDir, name);
		const stats = await lstat(candidate);
		if (stats.isDirectory()) {
			files.push(...(await listRegularFiles(candidate, baseDir)));
		} else if (stats.isFile()) {
			files.push(path.relative(baseDir, candidate).split(path.sep).join('/'));
		} else {
			throw new Error(`wasm-tinygo tree contains a non-regular path: ${candidate}`);
		}
	}
	return files;
}

/** @param {string} filePath @param {string} label */
async function readRegularFileOnce(filePath, label) {
	const before = await lstat(filePath, { bigint: true }).catch(() => null);
	if (!before?.isFile()) throw new Error(`${label} must be a regular file: ${filePath}`);
	const bytes = await readFile(filePath);
	const after = await lstat(filePath, { bigint: true }).catch(() => null);
	if (
		!after?.isFile() ||
		before.dev !== after.dev ||
		before.ino !== after.ino ||
		before.size !== after.size ||
		before.mtimeNs !== after.mtimeNs ||
		before.ctimeNs !== after.ctimeNs
	) {
		throw new Error(`${label} changed while it was being read: ${filePath}`);
	}
	return bytes;
}

/** @param {string} sourceDir @param {{ entryPath: string; modules: Map<string, GraphLockModule> }} lock */
async function readExecutableGraphSnapshot(sourceDir, lock) {
	const allFiles = await listRegularFiles(sourceDir);
	const jsPaths = allFiles.filter((relativePath) => relativePath.endsWith('.js'));
	const expectedPaths = [...lock.modules.keys()].sort(compareCodeUnits);
	if (JSON.stringify(jsPaths) !== JSON.stringify(expectedPaths)) {
		throw new Error(
			`wasm-tinygo executable JS inventory differs from the lock: expected ${expectedPaths.join(', ')}`
		);
	}
	/** @type {Map<string, Buffer>} */
	const snapshot = new Map();
	for (const modulePath of expectedPaths) {
		const module = /** @type {GraphLockModule} */ (lock.modules.get(modulePath));
		const bytes = await readRegularFileOnce(
			path.join(sourceDir, modulePath),
			`wasm-tinygo executable module ${modulePath}`
		);
		if (bytes.byteLength !== module.bytes || sha256(bytes) !== module.sha256) {
			throw new Error(`wasm-tinygo executable module ${modulePath} differs from its lock`);
		}
		const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
		const imports = extractTinyGoExecutableImports(source, modulePath);
		if (JSON.stringify(imports) !== JSON.stringify(module.imports)) {
			throw new Error(
				`wasm-tinygo executable module ${modulePath} imports differ from its lock`
			);
		}
		snapshot.set(modulePath, bytes);
	}
	return snapshot;
}

/** @param {{ entryPath: string; modules: Map<string, GraphLockModule> }} lock */
export function computeTinyGoExecutableGraphFingerprint(lock) {
	let canonical = TINYGO_EXECUTABLE_GRAPH_FINGERPRINT_DOMAIN;
	canonical += `schema\0${TINYGO_EXECUTABLE_GRAPH_FORMAT}\0${1}\n`;
	canonical += `entry\0${lock.entryPath}\n`;
	const modules = [...lock.modules.values()].sort((left, right) =>
		compareCodeUnits(left.path, right.path)
	);
	for (const module of modules) {
		canonical += `module\0${module.path}\0${module.bytes}\0${module.sha256}\n`;
	}
	const edges = modules
		.flatMap((module) =>
			module.imports.map((graphImport) => ({ importer: module.path, ...graphImport }))
		)
		.sort(
			(left, right) =>
				compareCodeUnits(left.importer, right.importer) ||
				compareCodeUnits(left.kind, right.kind) ||
				compareCodeUnits(left.specifier, right.specifier) ||
				compareCodeUnits(left.target, right.target)
		);
	for (const edge of edges) {
		canonical += `edge\0${edge.importer}\0${edge.kind}\0${edge.specifier}\0${edge.target}\n`;
	}
	return sha256(new TextEncoder().encode(canonical));
}

/** @param {{ entryPath: string; modules: Map<string, GraphLockModule> }} lock */
function createExecutableGraphProfile(lock) {
	const modules = {};
	for (const module of [...lock.modules.values()].sort((left, right) =>
		compareCodeUnits(left.path, right.path)
	)) {
		modules[module.path] = Object.freeze({
			bytes: module.bytes,
			sha256: module.sha256,
			imports: Object.freeze(
				module.imports.map((graphImport) => Object.freeze({ ...graphImport }))
			)
		});
	}
	return Object.freeze({
		schemaVersion: 1,
		format: TINYGO_EXECUTABLE_GRAPH_FORMAT,
		entryPath: lock.entryPath,
		fingerprint: computeTinyGoExecutableGraphFingerprint(lock),
		modules: Object.freeze(modules)
	});
}

/** @param {unknown} value @param {string} label */
function parseEvidence(value, label) {
	const evidence = expectObject(value, label);
	return {
		path: requireSafeRelativePath(evidence.path, `${label}.path`),
		bytes: requireSafeInteger(evidence.bytes, `${label}.bytes`),
		sha256: requireSha256(evidence.sha256, `${label}.sha256`)
	};
}

/** @param {string} assetPath @param {Uint8Array} logicalBytes */
function makeAssetReceipt(assetPath, logicalBytes) {
	const shouldCompress =
		logicalBytes.byteLength >= STATIC_RUNTIME_MIN_COMPRESS_BYTES &&
		!assetPath.endsWith('.gz.bin');
	if (!shouldCompress) return { bytes: logicalBytes.byteLength, sha256: sha256(logicalBytes) };
	const storageBytes = gzipSync(logicalBytes, { level: 9 });
	return {
		bytes: storageBytes.byteLength,
		sha256: sha256(storageBytes),
		uncompressedBytes: logicalBytes.byteLength,
		uncompressedSha256: sha256(logicalBytes)
	};
}

/** @param {Record<string, ReturnType<typeof makeAssetReceipt>>} receipts @param {string} manifestPath @param {{bytes: number; sha256: string}} manifestReceipt */
function computeProfileFingerprint(receipts, manifestPath, manifestReceipt) {
	let canonical = `${TINYGO_PROFILE_FORMAT}\n`;
	canonical += `profile\0${TINYGO_PROFILE_ID}\0${TINYGO_PROTOCOL_VERSION}\n`;
	canonical += `manifest\0${manifestPath}\0${manifestReceipt.bytes}\0${manifestReceipt.sha256}\n`;
	for (const assetPath of Object.keys(receipts).sort(compareCodeUnits)) {
		const receipt = receipts[assetPath];
		const logicalBytes = receipt.uncompressedBytes ?? receipt.bytes;
		const logicalSha256 = receipt.uncompressedSha256 ?? receipt.sha256;
		const storagePath = receipt.uncompressedSha256 ? `${assetPath}.gz` : assetPath;
		canonical += `asset\0${assetPath}\0${storagePath}\0${receipt.bytes}\0${receipt.sha256}\0${logicalBytes}\0${logicalSha256}\n`;
	}
	return sha256(new TextEncoder().encode(canonical));
}

/** @param {string} runtimeDir */
async function createRuntimeProfile(runtimeDir) {
	const manifestBytes = await readRegularFileOnce(
		path.join(runtimeDir, UPSTREAM_MANIFEST_PATH),
		'wasm-tinygo upstream toolchain manifest'
	);
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
	const assetReceipts = {};
	for (const evidence of evidenceEntries) {
		const assetPath = path.posix.join(manifestDirectory, evidence.path);
		const bytes = await readRegularFileOnce(
			path.join(runtimeDir, assetPath),
			`wasm-tinygo toolchain asset ${assetPath}`
		);
		if (bytes.byteLength !== evidence.bytes || sha256(bytes) !== evidence.sha256) {
			throw new Error(`wasm-tinygo upstream manifest does not bind ${assetPath}`);
		}
		if (Object.prototype.hasOwnProperty.call(assetReceipts, assetPath)) {
			throw new Error(`wasm-tinygo upstream manifest repeats ${assetPath}`);
		}
		assetReceipts[assetPath] = makeAssetReceipt(assetPath, bytes);
	}
	const manifestReceipt = { bytes: manifestBytes.byteLength, sha256: sha256(manifestBytes) };
	return Object.freeze({
		profileId: TINYGO_PROFILE_ID,
		protocolVersion: TINYGO_PROTOCOL_VERSION,
		manifestPath: UPSTREAM_MANIFEST_PATH,
		manifestFingerprint: computeProfileFingerprint(
			assetReceipts,
			UPSTREAM_MANIFEST_PATH,
			manifestReceipt
		),
		manifestReceipt: Object.freeze(manifestReceipt),
		assetReceipts: Object.freeze(assetReceipts)
	});
}

/** @param {string} relativePath */
function isLegacyBundleFile(relativePath) {
	return (
		relativePath === 'upstream.js' ||
		(relativePath.startsWith('assets/upstream-compile-worker-') &&
			relativePath.endsWith('.js')) ||
		relativePath.startsWith('tools/upstream/')
	);
}

/** @param {string} runtimeDir */
async function computeLegacyBundleFingerprint(runtimeDir) {
	const hash = createHash('sha256');
	for (const relativePath of (await listRegularFiles(runtimeDir)).filter(isLegacyBundleFile)) {
		hash.update(relativePath.split('/').join(path.sep));
		hash.update('\0');
		hash.update(
			await readRegularFileOnce(
				path.join(runtimeDir, relativePath),
				`wasm-tinygo legacy bundle asset ${relativePath}`
			)
		);
		hash.update('\n');
	}
	return hash.digest('hex');
}

/** @param {string} value */
function formatTypeScriptString(value) {
	return `'${value
		.replaceAll('\\', '\\\\')
		.replaceAll("'", "\\'")
		.replaceAll('\r', '\\r')
		.replaceAll('\n', '\\n')}'`;
}

/** @param {Record<string, unknown>} receipt @param {string} indent */
function formatReceiptFields(receipt, indent) {
	return Object.entries(receipt)
		.map(
			([property, value]) =>
				`${indent}${property}: ${typeof value === 'string' ? formatTypeScriptString(value) : value}`
		)
		.join(',\n');
}

/** @param {ReturnType<typeof createExecutableGraphProfile>} graphProfile @param {Awaited<ReturnType<typeof createRuntimeProfile>>} runtimeProfile @param {string} bundleFingerprint */
function createVersionModuleSource(graphProfile, runtimeProfile, bundleFingerprint) {
	const assetReceipts = Object.entries(runtimeProfile.assetReceipts)
		.sort(([left], [right]) => compareCodeUnits(left, right))
		.map(
			([assetPath, receipt]) =>
				`\t\t${formatTypeScriptString(assetPath)}: Object.freeze({\n${formatReceiptFields(receipt, '\t\t\t')}\n\t\t})`
		)
		.join(',\n');
	const graphModules = Object.entries(graphProfile.modules)
		.sort(([left], [right]) => compareCodeUnits(left, right))
		.map(([modulePath, module]) => {
			const imports = module.imports
				.map(
					(graphImport) =>
						`\t\t\t\tObject.freeze({\n\t\t\t\t\tspecifier: ${formatTypeScriptString(graphImport.specifier)},\n\t\t\t\t\ttarget: ${formatTypeScriptString(graphImport.target)},\n\t\t\t\t\tkind: ${formatTypeScriptString(graphImport.kind)}\n\t\t\t\t})`
				)
				.join(',\n');
			return `\t\t${formatTypeScriptString(modulePath)}: Object.freeze({\n\t\t\tbytes: ${module.bytes},\n\t\t\tsha256: ${formatTypeScriptString(module.sha256)},\n\t\t\timports: Object.freeze([${imports ? `\n${imports}\n\t\t\t` : ''}])\n\t\t})`;
		})
		.join(',\n');
	return `export const WASM_TINYGO_RUNTIME_PROFILE = Object.freeze({
\tprofileId: ${formatTypeScriptString(runtimeProfile.profileId)},
\tprotocolVersion: ${runtimeProfile.protocolVersion},
\tmanifestPath: ${formatTypeScriptString(runtimeProfile.manifestPath)},
\tmanifestFingerprint: ${formatTypeScriptString(runtimeProfile.manifestFingerprint)},
\tmanifestReceipt: Object.freeze({
${formatReceiptFields(runtimeProfile.manifestReceipt, '\t\t')}
\t}),
\tassetReceipts: Object.freeze({
${assetReceipts}
\t})
});

export const WASM_TINYGO_EXECUTABLE_GRAPH_FORMAT = ${formatTypeScriptString(TINYGO_EXECUTABLE_GRAPH_FORMAT)};
export const WASM_TINYGO_EXECUTABLE_GRAPH_FINGERPRINT_DOMAIN =
\t${formatTypeScriptString(TINYGO_EXECUTABLE_GRAPH_FINGERPRINT_DOMAIN)};
export const WASM_TINYGO_EXECUTABLE_GRAPH_PROFILE = Object.freeze({
\tschemaVersion: 1,
\tformat: WASM_TINYGO_EXECUTABLE_GRAPH_FORMAT,
\tentryPath: ${formatTypeScriptString(graphProfile.entryPath)},
\tfingerprint: ${formatTypeScriptString(graphProfile.fingerprint)},
\tmodules: Object.freeze({
${graphModules}
\t})
});

export const WASM_TINYGO_ASSET_VERSION =
\t${formatTypeScriptString(bundleFingerprint)};
`;
}

/** @param {ReturnType<typeof createExecutableGraphProfile>} graphProfile */
function createGraphManifestSource(graphProfile) {
	return `${JSON.stringify(graphProfile, null, 2)}\n`;
}

/** @param {string} directoryPath */
async function syncDirectory(directoryPath) {
	const handle = await open(directoryPath, 'r');
	try {
		await handle.sync();
	} finally {
		await handle.close();
	}
}

/** @param {string} filePath */
async function syncFile(filePath) {
	const handle = await open(filePath, 'r');
	try {
		await handle.sync();
	} finally {
		await handle.close();
	}
}

/** @param {string} rootDir */
async function syncTree(rootDir) {
	const files = await listRegularFiles(rootDir);
	for (const relativePath of files) await syncFile(path.join(rootDir, relativePath));
	const directories = new Set([rootDir]);
	for (const relativePath of files) {
		let directory = path.dirname(path.join(rootDir, relativePath));
		while (directory.startsWith(`${rootDir}${path.sep}`)) {
			directories.add(directory);
			directory = path.dirname(directory);
		}
	}
	for (const directory of [...directories].sort((left, right) => right.length - left.length)) {
		await syncDirectory(directory);
	}
}

/** @param {string} filePath @param {string | Uint8Array} contents @param {number} [mode] */
async function writeDurableExclusiveFile(filePath, contents, mode = 0o600) {
	const handle = await open(filePath, 'wx', mode);
	try {
		await handle.writeFile(contents);
		await handle.sync();
	} finally {
		await handle.close();
	}
}

/** @param {string} candidate */
async function resolveBoundaryPath(candidate) {
	let cursor = path.resolve(candidate);
	const suffix = [];
	for (;;) {
		try {
			return path.join(await realpath(cursor), ...suffix);
		} catch (error) {
			const code = error && typeof error === 'object' && 'code' in error ? error.code : '';
			if (code !== 'ENOENT') throw error;
			const parent = path.dirname(cursor);
			if (parent === cursor) throw error;
			suffix.unshift(path.basename(cursor));
			cursor = parent;
		}
	}
}

/** @param {string} left @param {string} right */
function pathsOverlap(left, right) {
	return (
		left === right ||
		left.startsWith(`${right}${path.sep}`) ||
		right.startsWith(`${left}${path.sep}`)
	);
}

/** @param {string} targetDir */
export function getTinyGoSyncControlPaths(targetDir) {
	const resolved = path.resolve(targetDir);
	const parent = path.dirname(resolved);
	const base = path.basename(resolved);
	return {
		syncLockPath: path.join(parent, `.${base}.sync.lock`),
		transactionMarkerPath: path.join(parent, `.${base}.sync-transaction.json`)
	};
}

/** @param {string} lockPath */
async function acquireSyncLock(lockPath) {
	const token = randomUUID();
	let handle;
	try {
		handle = await open(lockPath, 'wx', 0o600);
	} catch (error) {
		const code = error && typeof error === 'object' && 'code' in error ? error.code : '';
		if (code === 'EEXIST') {
			throw new Error(
				`wasm-tinygo sync lock already exists; remove it only after verifying no sync is active: ${lockPath}`
			);
		}
		throw error;
	}
	try {
		await handle.writeFile(
			`${JSON.stringify({ format: SYNC_LOCK_FORMAT, pid: process.pid, token }, null, 2)}\n`,
			'utf8'
		);
		await handle.sync();
		await syncDirectory(path.dirname(lockPath));
		return { handle, lockPath, token, stats: await handle.stat() };
	} catch (error) {
		const owned = await handle.stat().catch(() => null);
		await handle.close().catch(() => undefined);
		const current = await lstat(lockPath).catch(() => null);
		if (owned && current && owned.dev === current.dev && owned.ino === current.ino) {
			await unlink(lockPath);
			await syncDirectory(path.dirname(lockPath));
		}
		throw error;
	}
}

/** @param {{handle: import('node:fs/promises').FileHandle; lockPath: string; token: string; stats: import('node:fs').Stats}} lock */
async function releaseSyncLock(lock) {
	try {
		const current = await lstat(lock.lockPath).catch(() => null);
		if (!current || current.dev !== lock.stats.dev || current.ino !== lock.stats.ino) {
			throw new Error('wasm-tinygo sync lock ownership changed during publication');
		}
		const parsed = JSON.parse(
			(await readRegularFileOnce(lock.lockPath, 'wasm-tinygo sync lock')).toString('utf8')
		);
		if (
			!isObject(parsed) ||
			parsed.format !== SYNC_LOCK_FORMAT ||
			parsed.pid !== process.pid ||
			parsed.token !== lock.token
		) {
			throw new Error('wasm-tinygo sync lock ownership changed during publication');
		}
		await unlink(lock.lockPath);
		await syncDirectory(path.dirname(lock.lockPath));
	} finally {
		await lock.handle.close();
	}
}

/** @param {string} target @param {string} transactionId @param {'staging'|'previous'} role */
function transactionSiblingPath(target, transactionId, role) {
	return path.join(path.dirname(target), `.${path.basename(target)}.${role}-${transactionId}`);
}

/** @param {Array<{target: string; kind: 'directory'|'file'}>} base @param {string} transactionId */
function createPublications(base, transactionId) {
	return base.map((publication) => ({
		...publication,
		staging: transactionSiblingPath(publication.target, transactionId, 'staging'),
		previous: transactionSiblingPath(publication.target, transactionId, 'previous'),
		hadTarget: false
	}));
}

/** @param {string} markerPath @param {Record<string, unknown>} marker */
async function writeTransactionMarker(markerPath, marker) {
	const temporary = `${markerPath}.next`;
	await writeDurableExclusiveFile(temporary, `${JSON.stringify(marker, null, 2)}\n`);
	await rename(temporary, markerPath);
	await syncDirectory(path.dirname(markerPath));
}

/** @param {string} candidate @param {'directory'|'file'} kind */
async function requirePublicationType(candidate, kind) {
	const stats = await lstat(candidate).catch(() => null);
	if (!stats) return null;
	if (kind === 'directory' ? !stats.isDirectory() : !stats.isFile()) {
		throw new Error(`wasm-tinygo transaction path has an unsafe type: ${candidate}`);
	}
	return stats;
}

/** @param {string} candidate @param {'directory'|'file'} kind */
async function removePublicationPath(candidate, kind) {
	if (!(await requirePublicationType(candidate, kind))) return;
	await rm(candidate, { recursive: kind === 'directory', force: false });
	await syncDirectory(path.dirname(candidate));
}

/** @param {string} markerPath @param {Array<{target: string; kind: 'directory'|'file'}>} base */
async function readTransactionMarker(markerPath, base) {
	let parsed;
	try {
		parsed = JSON.parse(
			(await readRegularFileOnce(markerPath, 'wasm-tinygo transaction marker')).toString(
				'utf8'
			)
		);
	} catch (error) {
		throw new Error(`wasm-tinygo transaction marker is invalid: ${markerPath}`, {
			cause: error
		});
	}
	const marker = expectObject(parsed, 'wasm-tinygo transaction marker');
	assertExactKeys(
		marker,
		['format', 'phase', 'publications', 'transactionId'],
		'wasm-tinygo transaction marker'
	);
	if (
		marker.format !== SYNC_TRANSACTION_FORMAT ||
		typeof marker.transactionId !== 'string' ||
		!UUID_PATTERN.test(marker.transactionId) ||
		!['preparing', 'prepared', 'committed'].includes(/** @type {string} */ (marker.phase)) ||
		!Array.isArray(marker.publications) ||
		marker.publications.length !== base.length
	) {
		throw new Error('wasm-tinygo transaction marker has invalid metadata');
	}
	const expected = createPublications(base, marker.transactionId);
	for (const [index, publication] of expected.entries()) {
		const raw = expectObject(marker.publications[index], 'wasm-tinygo transaction publication');
		assertExactKeys(
			raw,
			['hadTarget', 'kind', 'previous', 'staging', 'target'],
			'wasm-tinygo transaction publication'
		);
		if (
			raw.target !== publication.target ||
			raw.kind !== publication.kind ||
			raw.previous !== publication.previous ||
			raw.staging !== publication.staging ||
			typeof raw.hadTarget !== 'boolean'
		) {
			throw new Error('wasm-tinygo transaction marker does not match this publication');
		}
		publication.hadTarget = raw.hadTarget;
	}
	return { ...marker, publications: expected };
}

/** @param {string} markerPath @param {Array<{target: string; kind: 'directory'|'file'}>} base */
async function recoverTransaction(markerPath, base) {
	const temporary = `${markerPath}.next`;
	const temporaryStats = await lstat(temporary).catch(() => null);
	if (temporaryStats) {
		if (!temporaryStats.isFile()) {
			throw new Error(
				`wasm-tinygo transaction temporary path has an unsafe type: ${temporary}`
			);
		}
		await unlink(temporary);
		await syncDirectory(path.dirname(temporary));
	}
	if (!(await lstat(markerPath).catch(() => null))) return false;
	const marker = await readTransactionMarker(markerPath, base);
	if (marker.phase === 'committed') {
		for (const publication of marker.publications) {
			if (!(await requirePublicationType(publication.target, publication.kind))) {
				throw new Error(
					`wasm-tinygo committed publication is missing: ${publication.target}`
				);
			}
			await removePublicationPath(publication.previous, publication.kind);
			await removePublicationPath(publication.staging, publication.kind);
		}
	} else {
		for (const publication of [...marker.publications].reverse()) {
			const previous = await requirePublicationType(publication.previous, publication.kind);
			const target = await requirePublicationType(publication.target, publication.kind);
			const staging = await requirePublicationType(publication.staging, publication.kind);
			if (previous) {
				if (target) await removePublicationPath(publication.target, publication.kind);
				await rename(publication.previous, publication.target);
				await syncDirectory(path.dirname(publication.target));
			} else if (publication.hadTarget && !target) {
				throw new Error(
					`wasm-tinygo cannot recover missing prior publication: ${publication.target}`
				);
			} else if (!publication.hadTarget && target && !staging) {
				await removePublicationPath(publication.target, publication.kind);
			}
			await removePublicationPath(publication.staging, publication.kind);
		}
	}
	await unlink(markerPath);
	await syncDirectory(path.dirname(markerPath));
	return true;
}

/** @param {string} rootDir */
async function collectProtectedReceipts(rootDir) {
	const receipts = new Map();
	for (const relativePath of await listRegularFiles(rootDir)) {
		if (relativePath.endsWith('.js') || relativePath === TINYGO_EXECUTABLE_GRAPH_MANIFEST_PATH)
			continue;
		const bytes = await readRegularFileOnce(
			path.join(rootDir, relativePath),
			`wasm-tinygo protected asset ${relativePath}`
		);
		receipts.set(relativePath, `${bytes.byteLength}\0${sha256(bytes)}`);
	}
	return receipts;
}

/** @param {Map<string,string>} expected @param {Map<string,string>} actual */
function assertSameReceipts(expected, actual) {
	if (JSON.stringify([...expected]) !== JSON.stringify([...actual])) {
		throw new Error('wasm-tinygo staged publication changed a protected non-JavaScript asset');
	}
}

/** @param {string} stagingDir @param {Map<string,Buffer>} graphSnapshot @param {string} manifestSource */
async function overlayExecutableGraph(stagingDir, graphSnapshot, manifestSource) {
	for (const relativePath of await listRegularFiles(stagingDir)) {
		if (relativePath.endsWith('.js')) await unlink(path.join(stagingDir, relativePath));
	}
	for (const [relativePath, bytes] of graphSnapshot) {
		const outputPath = path.join(stagingDir, relativePath);
		await mkdir(path.dirname(outputPath), { recursive: true });
		await writeFile(outputPath, bytes, { flag: 'wx' });
	}
	await writeFile(
		path.join(stagingDir, TINYGO_EXECUTABLE_GRAPH_MANIFEST_PATH),
		manifestSource,
		'utf8'
	);
}

/**
 * @typedef {{
 * sourceDir?: string;
 * targetDir?: string;
 * versionModulePath?: string;
 * graphLockPath?: string;
 * syncLockPath?: string;
 * transactionMarkerPath?: string;
 * renamePath?: typeof rename;
 * beforeProtectedSnapshot?: () => void | Promise<void>;
 * beforeStagedProfileSnapshot?: () => void | Promise<void>;
 * }} SyncWasmTinyGoOptions
 */

/** @param {SyncWasmTinyGoOptions} [options] */
export async function syncWasmTinyGoDist(options = {}) {
	const targetDir = path.resolve(options.targetDir || DEFAULT_TARGET_DIR);
	const sourceDir = path.resolve(options.sourceDir || targetDir);
	const versionModulePath = path.resolve(
		options.versionModulePath ||
			(targetDir === DEFAULT_TARGET_DIR
				? DEFAULT_VERSION_MODULE_PATH
				: `${targetDir}.version.ts`)
	);
	const graphLockPath = path.resolve(options.graphLockPath || DEFAULT_GRAPH_LOCK_PATH);
	const defaults = getTinyGoSyncControlPaths(targetDir);
	const syncLockPath = path.resolve(options.syncLockPath || defaults.syncLockPath);
	const transactionMarkerPath = path.resolve(
		options.transactionMarkerPath || defaults.transactionMarkerPath
	);
	const transactionMarkerTemporaryPath = `${transactionMarkerPath}.next`;
	const renamePath = options.renamePath || rename;
	if (targetDir === path.parse(targetDir).root) {
		throw new Error('wasm-tinygo target must not be a filesystem root');
	}
	const boundaries = await Promise.all(
		[
			targetDir,
			sourceDir,
			versionModulePath,
			graphLockPath,
			syncLockPath,
			transactionMarkerPath,
			transactionMarkerTemporaryPath
		].map(resolveBoundaryPath)
	);
	const [
		targetBoundary,
		sourceBoundary,
		versionBoundary,
		graphLockBoundary,
		syncLockBoundary,
		markerBoundary,
		markerTemporaryBoundary
	] = boundaries;
	if (pathsOverlap(targetBoundary, versionBoundary)) {
		throw new Error('wasm-tinygo runtime target and generated module must not overlap');
	}
	if (
		sourceBoundary !== targetBoundary &&
		(pathsOverlap(sourceBoundary, targetBoundary) ||
			pathsOverlap(sourceBoundary, versionBoundary))
	) {
		throw new Error('wasm-tinygo explicit graph source must not overlap publication outputs');
	}
	const controls = [syncLockBoundary, markerBoundary, markerTemporaryBoundary];
	const inputs = [sourceBoundary, graphLockBoundary];
	const outputs = [targetBoundary, versionBoundary];
	for (let index = 0; index < controls.length; index += 1) {
		for (let other = index + 1; other < controls.length; other += 1) {
			if (pathsOverlap(controls[index], controls[other])) {
				throw new Error('wasm-tinygo sync control paths must not overlap');
			}
		}
		for (const boundary of [...inputs, ...outputs]) {
			if (pathsOverlap(controls[index], boundary)) {
				throw new Error('wasm-tinygo sync controls must not overlap inputs or outputs');
			}
		}
	}
	if (
		pathsOverlap(graphLockBoundary, targetBoundary) ||
		pathsOverlap(graphLockBoundary, versionBoundary)
	) {
		throw new Error('wasm-tinygo executable graph lock must not overlap publication outputs');
	}
	await Promise.all([
		mkdir(path.dirname(targetDir), { recursive: true }),
		mkdir(path.dirname(versionModulePath), { recursive: true }),
		mkdir(path.dirname(syncLockPath), { recursive: true })
	]);
	const basePublications = [
		{ target: targetDir, kind: /** @type {'directory'} */ ('directory') },
		{ target: versionModulePath, kind: /** @type {'file'} */ ('file') }
	];
	const syncLock = await acquireSyncLock(syncLockPath);
	let result;
	let operationError;
	try {
		await recoverTransaction(transactionMarkerPath, basePublications);
		if (!(await lstat(targetDir).catch(() => null))?.isDirectory()) {
			throw new Error(
				`wasm-tinygo published runtime directory is missing or unsafe: ${targetDir}`
			);
		}
		const lock = parseTinyGoExecutableGraphLock(
			await readRegularFileOnce(graphLockPath, 'wasm-tinygo executable graph lock')
		);
		const graphSnapshot = await readExecutableGraphSnapshot(sourceDir, lock);
		await options.beforeProtectedSnapshot?.();
		const protectedReceipts = await collectProtectedReceipts(targetDir);
		const graphProfile = createExecutableGraphProfile(lock);
		const graphManifestSource = createGraphManifestSource(graphProfile);
		const transactionId = randomUUID();
		const publications = createPublications(basePublications, transactionId);
		for (const publication of publications) {
			publication.hadTarget = Boolean(
				await requirePublicationType(publication.target, publication.kind)
			);
			if (await lstat(publication.staging).catch(() => null)) {
				throw new Error(`wasm-tinygo staging path already exists: ${publication.staging}`);
			}
			if (await lstat(publication.previous).catch(() => null)) {
				throw new Error(
					`wasm-tinygo previous path already exists: ${publication.previous}`
				);
			}
		}
		const marker = {
			format: SYNC_TRANSACTION_FORMAT,
			transactionId,
			phase: 'preparing',
			publications: publications.map(({ target, kind, staging, previous, hadTarget }) => ({
				target,
				kind,
				staging,
				previous,
				hadTarget
			}))
		};
		await writeTransactionMarker(transactionMarkerPath, marker);
		try {
			const runtimePublication = publications[0];
			const versionPublication = publications[1];
			await cp(targetDir, runtimePublication.staging, {
				recursive: true,
				errorOnExist: true,
				force: false,
				preserveTimestamps: true
			});
			await overlayExecutableGraph(
				runtimePublication.staging,
				graphSnapshot,
				graphManifestSource
			);
			assertSameReceipts(
				protectedReceipts,
				await collectProtectedReceipts(runtimePublication.staging)
			);
			await readExecutableGraphSnapshot(runtimePublication.staging, lock);
			await options.beforeStagedProfileSnapshot?.();
			const runtimeProfile = await createRuntimeProfile(runtimePublication.staging);
			const stagedBundleFingerprint = await computeLegacyBundleFingerprint(
				runtimePublication.staging
			);
			const versionModuleSource = createVersionModuleSource(
				graphProfile,
				runtimeProfile,
				stagedBundleFingerprint
			);
			await writeDurableExclusiveFile(versionPublication.staging, versionModuleSource, 0o644);
			await syncTree(runtimePublication.staging);
			marker.phase = 'prepared';
			await writeTransactionMarker(transactionMarkerPath, marker);
			for (const publication of publications) {
				if (publication.hadTarget) {
					await renamePath(publication.target, publication.previous);
					await syncDirectory(path.dirname(publication.target));
				}
				await renamePath(publication.staging, publication.target);
				await syncDirectory(path.dirname(publication.target));
			}
			marker.phase = 'committed';
			await writeTransactionMarker(transactionMarkerPath, marker);
			for (const publication of publications) {
				await removePublicationPath(publication.previous, publication.kind);
			}
			await unlink(transactionMarkerPath);
			await syncDirectory(path.dirname(transactionMarkerPath));
			result = {
				sourceDir,
				sourceMode: options.sourceDir ? 'explicit-graph-source' : 'published-static',
				targetDir,
				fingerprint: stagedBundleFingerprint,
				profile: runtimeProfile,
				executableGraphProfile: graphProfile,
				graphManifestPath: path.join(targetDir, TINYGO_EXECUTABLE_GRAPH_MANIFEST_PATH),
				versionModulePath
			};
		} catch (error) {
			try {
				await recoverTransaction(transactionMarkerPath, basePublications);
			} catch (recoveryError) {
				throw new AggregateError(
					[error, recoveryError],
					'wasm-tinygo publication and rollback both failed'
				);
			}
			throw error;
		}
	} catch (error) {
		operationError = error;
	}
	try {
		await releaseSyncLock(syncLock);
	} catch (releaseError) {
		if (operationError) {
			throw new AggregateError(
				[operationError, releaseError],
				'wasm-tinygo sync and lock release both failed'
			);
		}
		throw releaseError;
	}
	if (operationError) throw operationError;
	return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === THIS_FILE) {
	const [, , sourceDirArg, targetDirArg] = process.argv;
	const result = await syncWasmTinyGoDist({
		...(sourceDirArg ? { sourceDir: path.resolve(sourceDirArg) } : {}),
		...(targetDirArg ? { targetDir: path.resolve(targetDirArg) } : {})
	});
	console.log(
		result.sourceMode === 'published-static'
			? `Refreshed wasm-tinygo executable profile from ${result.targetDir}`
			: `Synced wasm-tinygo executable JavaScript from ${result.sourceDir} to ${result.targetDir}`
	);
}
