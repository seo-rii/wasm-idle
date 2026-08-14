import { createHash } from 'node:crypto';
import {
	lstat,
	mkdir,
	mkdtemp,
	readFile,
	readdir,
	rename,
	rm,
	stat,
	writeFile
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync, gunzipSync } from 'node:zlib';
import { build as viteBuild } from 'vite';

const THIS_FILE = fileURLToPath(import.meta.url);
const THIS_DIR = path.dirname(THIS_FILE);
const REPO_ROOT = path.resolve(THIS_DIR, '..');
const DEFAULT_TARGET_DIR = path.resolve(REPO_ROOT, 'static', 'wasm-haskell');
const DEFAULT_GENERATED_MODULE_PATH = path.resolve(
	REPO_ROOT,
	'packages',
	'core',
	'src',
	'haskell-runtime.generated.ts'
);
const DEFAULT_VERSION_MODULE_PATH = path.resolve(
	REPO_ROOT,
	'src',
	'lib',
	'playground',
	'wasmHaskellVersion.ts'
);
const DEFAULT_COMPRESSED_MANIFEST_PATH = path.resolve(
	REPO_ROOT,
	'static',
	'compressed-runtime-assets.v1.json'
);
const DEFAULT_LOCK_FILE_PATH = path.resolve(THIS_DIR, 'wasm-haskell-assets.lock.json');
const DEFAULT_NODE_MODULES_DIR = path.resolve(REPO_ROOT, 'node_modules');
const DEFAULT_PNPM_LOCK_PATH = path.resolve(REPO_ROOT, 'pnpm-lock.yaml');

export const HASKELL_MANIFEST_FORMAT = 'wasm-haskell-runtime-manifest-v2';
export const HASKELL_FINGERPRINT_DOMAIN = 'wasm-idle:haskell-runtime-manifest:v2';
const RUNTIME = 'ghc-in-browser';
const MANIFEST_FILE = 'runtime-manifest.v2.json';
const LEGACY_MANIFEST_FILE = 'runtime-manifest.v1.json';
const BUILD_METADATA_FILE = 'runtime-build.json';
const SOURCE_ASSET_PATHS = Object.freeze([
	'dyld.mjs',
	'post-link.mjs',
	'prelude.mjs',
	'rootfs.tar.zst',
	'bsdtar.wasm'
]);
const LOGICAL_ASSET_PATHS = Object.freeze(['dyld.mjs', 'rootfs.tar.zst', 'bsdtar.wasm']);
const PACKAGE_NAMES = Object.freeze(['@bjorn3/browser_wasi_shim', 'vite']);
const SHIM_MODULE_PATHS = Object.freeze([
	'debug.js',
	'fd.js',
	'fs_mem.js',
	'fs_opfs.js',
	'index.js',
	'strace.js',
	'wasi.js',
	'wasi_defs.js'
]);
const MAX_SOURCE_BYTES = 64 * 1024 * 1024;
const MAX_METADATA_BYTES = 2 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 120_000;

const TOP_LEVEL_LOCK_KEYS = Object.freeze(
	[
		'legalFiles',
		'licenseExpression',
		'outputs',
		'packages',
		'producer',
		'profileId',
		'provenanceLevel',
		'schemaVersion',
		'transformations',
		'upstream'
	].sort()
);
const RECEIPT_KEYS = Object.freeze(['bytes', 'mediaType', 'path', 'sha256', 'url'].sort());
const OUTPUT_KEYS = Object.freeze(['bytes', 'mediaType', 'path', 'sha256'].sort());
const PACKAGE_KEYS = Object.freeze(
	[
		'bytes',
		'files',
		'integrity',
		'license',
		'name',
		'repository',
		'requestedRange',
		'revision',
		'tarballUrl',
		'treeSha256',
		'version'
	].sort()
);
const LEGAL_KEYS = Object.freeze(
	['bytes', 'mediaType', 'sha256', 'sourcePath', 'spdx', 'targetPath'].sort()
);

/** @typedef {{ bytes: number; sha256: string }} Receipt */
/** @typedef {{ path: string; mediaType: string; size: number; sha256: string }} LogicalAsset */
/** @typedef {{ path: string; logicalPath: string; encoding: 'identity' | 'gzip'; size: number; sha256: string }} StorageAsset */
/** @typedef {{ target: string; temporary: string; previous: string; hadTarget: boolean; backedUp: boolean; published: boolean }} Publication */
/**
 * @typedef {object} SyncWasmHaskellOptions
 * @property {string} [sourceDir]
 * @property {string} [targetDir]
 * @property {string} [generatedModulePath]
 * @property {string} [versionModulePath]
 * @property {string} [compressedManifestPath]
 * @property {string} [lockFilePath]
 * @property {string} [nodeModulesDir]
 * @property {string} [pnpmLockPath]
 * @property {typeof fetch} [fetch]
 * @property {(sourcePath: string, targetPath: string) => Promise<void>} [renamePath]
 */

/** @param {Uint8Array | string} bytes */
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

/** @param {unknown} value */
const isObject = (value) => !!value && typeof value === 'object' && !Array.isArray(value);

/** @param {unknown} value @param {readonly string[]} keys */
const hasExactKeys = (value, keys) =>
	isObject(value) && JSON.stringify(Object.keys(value).sort()) === JSON.stringify(keys);

/** @param {unknown} value @returns {string} */
export function canonicalHaskellRuntimeJson(value) {
	if (Array.isArray(value)) return `[${value.map(canonicalHaskellRuntimeJson).join(',')}]`;
	if (isObject(value)) {
		return `{${Object.keys(value)
			.sort()
			.map((key) => `${JSON.stringify(key)}:${canonicalHaskellRuntimeJson(value[key])}`)
			.join(',')}}`;
	}
	const primitive = JSON.stringify(value);
	if (primitive === undefined) throw new Error('Haskell runtime metadata is not canonical JSON');
	return primitive;
}

/** @param {unknown} value @param {string} label @param {number} maximum */
function validateByteSize(value, label, maximum = MAX_SOURCE_BYTES) {
	if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) {
		throw new Error(`${label} has an invalid byte size`);
	}
	return value;
}

/** @param {unknown} value @param {string} label */
function validateSha256(value, label) {
	if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value)) {
		throw new Error(`${label} has an invalid SHA-256 receipt`);
	}
	return value;
}

/** @param {unknown} value @param {string} label */
function validateRelativePath(value, label) {
	if (
		typeof value !== 'string' ||
		!value ||
		value.includes('\\') ||
		value.startsWith('/') ||
		value.split('/').some((part) => !part || part === '.' || part === '..')
	) {
		throw new Error(`${label} has an unsafe path`);
	}
	return value;
}

/** @param {string} filePath @param {string} label @param {number} maximum */
async function readStableRegularFile(filePath, label, maximum = MAX_SOURCE_BYTES) {
	const before = await lstat(filePath).catch(() => null);
	if (!before?.isFile() || before.isSymbolicLink()) {
		throw new Error(`${label} must be a regular file: ${filePath}`);
	}
	validateByteSize(before.size, label, maximum);
	const bytes = await readFile(filePath);
	const after = await lstat(filePath).catch(() => null);
	if (
		!after?.isFile() ||
		after.isSymbolicLink() ||
		before.dev !== after.dev ||
		before.ino !== after.ino ||
		before.size !== after.size ||
		before.mtimeMs !== after.mtimeMs ||
		bytes.byteLength !== before.size
	) {
		throw new Error(`${label} changed while it was being read`);
	}
	return bytes;
}

/**
 * @param {string} rootDir
 * @param {string} [relativeDir]
 * @param {boolean} [ignoreInstallArtifacts]
 * @returns {Promise<string[]>}
 */
async function listRegularFiles(rootDir, relativeDir = '', ignoreInstallArtifacts = false) {
	const entries = await readdir(path.join(rootDir, relativeDir), { withFileTypes: true });
	/** @type {string[]} */
	const files = [];
	for (const entry of entries) {
		const relativePath = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
		if (entry.isDirectory()) {
			if (ignoreInstallArtifacts && relativePath === 'node_modules') continue;
			files.push(...(await listRegularFiles(rootDir, relativePath, ignoreInstallArtifacts)));
		} else if (entry.isFile()) {
			files.push(relativePath);
		} else {
			throw new Error(`Haskell producer input contains a non-regular entry: ${relativePath}`);
		}
	}
	return files.sort();
}

/** @param {string} packageDir */
export async function haskellPackageTreeReceipt(packageDir) {
	const files = await listRegularFiles(packageDir, '', true);
	let bytes = 0;
	const entries = [];
	for (const relativePath of files) {
		const contents = await readFile(path.join(packageDir, relativePath));
		bytes += contents.byteLength;
		entries.push({ path: relativePath, bytes: contents.byteLength, sha256: sha256(contents) });
	}
	return { files: files.length, bytes, treeSha256: sha256(JSON.stringify(entries)) };
}

/** @param {string} lockText @param {string} name @param {string} version */
function pnpmPackageIntegrity(lockText, name, version) {
	const lines = lockText.split(/\r?\n/u);
	const key = `${name}@${version}`;
	const headers = new Set([`  '${key}':`, `  ${key}:`]);
	const start = lines.findIndex((line) => headers.has(line));
	if (start === -1) throw new Error(`pnpm lock is missing ${key}`);
	let end = lines.length;
	for (let index = start + 1; index < lines.length; index += 1) {
		if (/^ {2}(?:'[^']+'|[^ ].*):$/u.test(lines[index])) {
			end = index;
			break;
		}
	}
	const resolution = lines
		.slice(start + 1, end)
		.find((line) => line.startsWith('    resolution: {integrity: '));
	const match = resolution?.match(/^ {4}resolution: \{integrity: ([^},]+)\}$/u);
	if (!match) throw new Error(`pnpm lock is missing the integrity receipt for ${key}`);
	return match[1];
}

/** @param {ReadonlyArray<readonly [string, string]>} entries */
export function assertNonOverlappingHaskellPaths(entries) {
	for (let leftIndex = 0; leftIndex < entries.length; leftIndex += 1) {
		const [leftLabel, leftPath] = entries[leftIndex];
		for (let rightIndex = leftIndex + 1; rightIndex < entries.length; rightIndex += 1) {
			const [rightLabel, rightPath] = entries[rightIndex];
			const leftToRight = path.relative(leftPath, rightPath);
			const rightToLeft = path.relative(rightPath, leftPath);
			const leftContainsRight =
				leftToRight === '' ||
				(!leftToRight.startsWith(`..${path.sep}`) &&
					leftToRight !== '..' &&
					!path.isAbsolute(leftToRight));
			const rightContainsLeft =
				rightToLeft === '' ||
				(!rightToLeft.startsWith(`..${path.sep}`) &&
					rightToLeft !== '..' &&
					!path.isAbsolute(rightToLeft));
			if (leftContainsRight || rightContainsLeft) {
				throw new Error(
					`wasm-haskell paths overlap: ${leftLabel} (${leftPath}) and ${rightLabel} (${rightPath})`
				);
			}
		}
	}
}

/**
 * @param {Response} response
 * @param {number} expectedBytes
 * @param {string} label
 * @param {AbortSignal} signal
 */
export async function readPinnedHaskellResponse(response, expectedBytes, label, signal) {
	validateByteSize(expectedBytes, label);
	const contentLength = response.headers.get('content-length');
	const contentEncoding = response.headers.get('content-encoding');
	const declaredBytes = contentLength === null ? null : Number(contentLength);
	if (
		contentLength !== null &&
		(!/^\d+$/u.test(contentLength) ||
			!Number.isSafeInteger(declaredBytes) ||
			declaredBytes <= 0 ||
			declaredBytes > MAX_SOURCE_BYTES ||
			(!contentEncoding && declaredBytes !== expectedBytes))
	) {
		await response.body?.cancel().catch(() => undefined);
		throw new Error(`${label} has an invalid Content-Length`);
	}
	if (!response.body) throw new Error(`${label} did not provide a response body`);
	const reader = response.body.getReader();
	const bytes = Buffer.allocUnsafe(expectedBytes);
	let offset = 0;
	try {
		while (true) {
			if (signal.aborted) throw signal.reason;
			const { done, value } = await reader.read();
			if (signal.aborted) throw signal.reason;
			if (done) break;
			if (!value || value.byteLength === 0) continue;
			if (offset + value.byteLength > expectedBytes) {
				throw new Error(`${label} exceeded its locked byte size`);
			}
			bytes.set(value, offset);
			offset += value.byteLength;
		}
	} catch (error) {
		await reader.cancel(error).catch(() => undefined);
		throw error;
	} finally {
		reader.releaseLock();
	}
	if (offset !== expectedBytes) {
		throw new Error(`${label} did not match its locked byte size`);
	}
	return bytes;
}

/** @param {string} source @param {number} bsdtarBytes */
export function updateHaskellCompressedAssetManifest(source, bsdtarBytes) {
	validateByteSize(bsdtarBytes, 'wasm-haskell compressed asset logical size');
	let manifest;
	try {
		manifest = JSON.parse(source);
	} catch (error) {
		throw new Error('compressed runtime asset manifest is not valid JSON', { cause: error });
	}
	if (
		!isObject(manifest) ||
		!Array.isArray(manifest.assets) ||
		!isObject(manifest.sizes) ||
		manifest.assets.filter((asset) => asset === 'wasm-haskell/bsdtar.wasm').length !== 1 ||
		!Object.prototype.hasOwnProperty.call(manifest.sizes, 'wasm-haskell/bsdtar.wasm')
	) {
		throw new Error('compressed runtime asset manifest is missing the Haskell bsdtar contract');
	}
	manifest.sizes['wasm-haskell/bsdtar.wasm'] = bsdtarBytes;
	return `${JSON.stringify(manifest, null, 2)}\n`;
}

/** @param {unknown} candidate @param {string} label */
function validateSourceDescriptor(candidate, label) {
	if (
		!hasExactKeys(candidate, RECEIPT_KEYS) ||
		typeof candidate.path !== 'string' ||
		typeof candidate.url !== 'string' ||
		!candidate.url.startsWith('https://') ||
		typeof candidate.mediaType !== 'string'
	) {
		throw new Error(`${label} has invalid source metadata`);
	}
	return Object.freeze({
		path: validateRelativePath(candidate.path, label),
		url: candidate.url,
		mediaType: candidate.mediaType,
		bytes: validateByteSize(candidate.bytes, label),
		sha256: validateSha256(candidate.sha256, label)
	});
}

/** @param {unknown} candidate @param {string} label */
function validateOutputDescriptor(candidate, label) {
	if (
		!hasExactKeys(candidate, OUTPUT_KEYS) ||
		typeof candidate.path !== 'string' ||
		typeof candidate.mediaType !== 'string'
	) {
		throw new Error(`${label} has invalid output metadata`);
	}
	return Object.freeze({
		path: validateRelativePath(candidate.path, label),
		mediaType: candidate.mediaType,
		bytes: validateByteSize(candidate.bytes, label),
		sha256: validateSha256(candidate.sha256, label)
	});
}

/** @param {string} source */
export function patchHaskellDyldSource(source) {
	const replacements = [
		[
			'await import("https://esm.sh/gh/haskell-wasm/browser_wasi_shim")',
			'await import("./browser_wasi_shim/index.js")',
			1
		],
		[
			'new wasi.PreopenDirectory("/", [["tmp", new wasi.Directory([])]])',
			'new wasi.PreopenDirectory("/", new Map([["tmp", new wasi.Directory(new Map())]]))',
			2
		],
		[
			`  // Continuations to output a single line to stdout/stderr
  stdout;
  stderr;`,
			`  // Continuations to output a single line to stdout/stderr
  stdout;
  stderr;
  // Optional fd0 implementation supplied by the browser worker.
  stdin;`,
			1
		],
		[
			'  constructor({ rootfs, stdout, stderr }) {\n    this.rootfs =',
			'  constructor({ rootfs, stdout, stderr, stdin }) {\n    this.stdin = stdin;\n    this.rootfs =',
			1
		],
		[
			`          new wasi.OpenFile(
            new wasi.File(new Uint8Array(), { readonly: true })
          ),`,
			`          this.#rpc instanceof DyLDBrowserHost && this.#rpc.stdin
            ? this.#rpc.stdin
            : new wasi.OpenFile(
                new wasi.File(new Uint8Array(), { readonly: true })
              ),`,
			1
		]
	];
	let patched = source;
	for (const [needle, replacement, expectedCount] of replacements) {
		if (patched.split(needle).length - 1 !== expectedCount) {
			throw new Error(
				`wasm-haskell dyld patch anchor must occur exactly ${expectedCount} time(s)`
			);
		}
		patched = patched.replaceAll(needle, replacement);
	}
	return patched;
}

/**
 * @param {{ sourceDir: string; shimPackageDir: string; outDir: string; repoRoot?: string }} options
 */
export async function buildHaskellModuleBundle(options) {
	const sourceDir = path.resolve(options.sourceDir);
	const shimPackageDir = path.resolve(options.shimPackageDir);
	const outDir = path.resolve(options.outDir);
	const buildDir = await mkdtemp(path.join(os.tmpdir(), 'wasm-idle-haskell-bundle-'));
	try {
		await mkdir(path.join(buildDir, 'browser_wasi_shim'), { recursive: true });
		const dyld = patchHaskellDyldSource(
			(
				await readStableRegularFile(path.join(sourceDir, 'dyld.mjs'), 'Haskell dyld source')
			).toString('utf8')
		);
		await writeFile(path.join(buildDir, 'dyld.mjs'), dyld, 'utf8');
		for (const fileName of ['prelude.mjs', 'post-link.mjs']) {
			await writeFile(
				path.join(buildDir, fileName),
				await readStableRegularFile(path.join(sourceDir, fileName), `Haskell ${fileName}`)
			);
		}
		for (const fileName of SHIM_MODULE_PATHS) {
			await writeFile(
				path.join(buildDir, 'browser_wasi_shim', fileName),
				await readStableRegularFile(
					path.join(shimPackageDir, 'dist', fileName),
					`browser_wasi_shim ${fileName}`,
					MAX_METADATA_BYTES
				)
			);
		}
		await rm(outDir, { recursive: true, force: true });
		const result = await viteBuild({
			root: options.repoRoot || REPO_ROOT,
			configFile: false,
			publicDir: false,
			logLevel: 'warn',
			base: './',
			define: {
				'import.meta.filename': JSON.stringify('dyld.mjs')
			},
			build: {
				target: 'es2022',
				outDir,
				emptyOutDir: true,
				modulePreload: false,
				minify: false,
				rollupOptions: {
					preserveEntrySignatures: 'strict',
					input: path.join(buildDir, 'dyld.mjs'),
					external: (id) => id.startsWith('node:'),
					output: {
						format: 'es',
						entryFileNames: 'dyld.mjs',
						codeSplitting: false
					}
				}
			}
		});
		const outputs = (Array.isArray(result) ? result : [result]).flatMap(
			(candidate) => candidate.output
		);
		if (
			outputs.length !== 1 ||
			outputs[0]?.type !== 'chunk' ||
			outputs[0].fileName !== 'dyld.mjs'
		) {
			throw new Error('wasm-haskell bundle must contain exactly one dyld.mjs chunk');
		}
		const chunk = outputs[0];
		const expectedExports = ['DyLDBrowserHost', 'DyLDHost', 'DyLDRPC', 'main'];
		if (JSON.stringify([...chunk.exports].sort()) !== JSON.stringify(expectedExports)) {
			throw new Error(
				`wasm-haskell bundle export graph is not exact: ${JSON.stringify(chunk.exports)}`
			);
		}
		const unexpectedImports = [...chunk.imports, ...chunk.dynamicImports].filter(
			(specifier) => !specifier.startsWith('node:') && specifier !== chunk.fileName
		);
		if (unexpectedImports.length > 0 || (chunk.referencedFiles || []).length > 0) {
			throw new Error(
				`wasm-haskell bundle retained an unexpected import: ${JSON.stringify({ imports: chunk.imports, dynamicImports: chunk.dynamicImports, referencedFiles: chunk.referencedFiles || [] })}`
			);
		}
		const expectedInputs = [
			path.join(buildDir, 'dyld.mjs'),
			path.join(buildDir, 'post-link.mjs'),
			path.join(buildDir, 'prelude.mjs'),
			...SHIM_MODULE_PATHS.map((fileName) =>
				path.join(buildDir, 'browser_wasi_shim', fileName)
			)
		].sort();
		const actualInputs = Object.keys(chunk.modules)
			.filter((modulePath) => !modulePath.startsWith('\0'))
			.map((modulePath) => path.resolve(modulePath))
			.sort();
		if (JSON.stringify(actualInputs) !== JSON.stringify(expectedInputs)) {
			throw new Error(
				`wasm-haskell bundle input graph differs from the exact eleven-file contract: ${JSON.stringify({ expectedInputs, actualInputs })}`
			);
		}
		const unnormalizedBundleBytes = await readStableRegularFile(
			path.join(outDir, 'dyld.mjs'),
			'wasm-haskell bundled dyld output',
			MAX_METADATA_BYTES
		);
		const expectedRegionPaths = [
			'\\0rolldown/runtime.js',
			'\\0vite/preload-helper.js',
			'dyld.mjs',
			'post-link.mjs',
			'prelude.mjs',
			...SHIM_MODULE_PATHS.map((fileName) => `browser_wasi_shim/${fileName}`)
		].sort();
		const normalizedRegionPaths = [];
		const normalizedLines = unnormalizedBundleBytes
			.toString('utf8')
			.split('\n')
			.map((line) => {
				if (!line.startsWith('//#region ')) return line;
				const modulePath = expectedRegionPaths.find(
					(candidate) =>
						line === `//#region ${candidate}` || line.endsWith(`/${candidate}`)
				);
				if (!modulePath) {
					throw new Error(`wasm-haskell bundle contains an unexpected region: ${line}`);
				}
				normalizedRegionPaths.push(modulePath);
				return `//#region ${modulePath}`;
			});
		if (JSON.stringify(normalizedRegionPaths.sort()) !== JSON.stringify(expectedRegionPaths)) {
			throw new Error('wasm-haskell bundle region graph is not exact');
		}
		const bundledBytes = Buffer.from(normalizedLines.join('\n'));
		await writeFile(path.join(outDir, 'dyld.mjs'), bundledBytes);
		const bundledSource = bundledBytes.toString('utf8');
		const expectedNodeImports = [
			'node:fs/promises',
			'node:module',
			'node:path',
			'node:timers',
			'node:util'
		];
		const actualNodeImports = [
			...new Set(
				[...bundledSource.matchAll(/\bimport\s*\(\s*["'](node:[^"']+)["']\s*\)/gu)].map(
					(match) => match[1]
				)
			)
		].sort();
		if (
			JSON.stringify(actualNodeImports) !== JSON.stringify(expectedNodeImports) ||
			bundledSource.includes('https://esm.sh/gh/haskell-wasm/browser_wasi_shim') ||
			bundledSource.includes('./browser_wasi_shim/') ||
			bundledSource.includes('./prelude.mjs') ||
			bundledSource.includes('./post-link.mjs')
		) {
			throw new Error('wasm-haskell bundle retained a network or relative module edge');
		}
		return bundledBytes;
	} finally {
		await rm(buildDir, { recursive: true, force: true });
	}
}

/** @param {string} targetDir */
export async function validateHaskellRuntimePublication(targetDir) {
	const expectedFiles = [
		'THIRD_PARTY_NOTICES.md',
		'bsdtar.wasm.gz',
		'dyld.mjs',
		'licenses/browser-wasi-shim/LICENSE-APACHE',
		'licenses/browser-wasi-shim/LICENSE-MIT',
		'licenses/bsdtar-wasm/LICENSE',
		'rootfs.tar.zst',
		BUILD_METADATA_FILE,
		LEGACY_MANIFEST_FILE,
		MANIFEST_FILE
	].sort();
	const installedFiles = await listRegularFiles(targetDir);
	if (JSON.stringify(installedFiles) !== JSON.stringify(expectedFiles)) {
		throw new Error('wasm-haskell installed file graph is not exact');
	}
	const manifest = JSON.parse(await readFile(path.join(targetDir, MANIFEST_FILE), 'utf8'));
	if (
		!isObject(manifest) ||
		!hasExactKeys(
			manifest,
			[
				'assets',
				'fingerprint',
				'format',
				'legalFiles',
				'licenseExpression',
				'metadata',
				'packages',
				'producer',
				'profileId',
				'provenanceLevel',
				'runtime',
				'storage',
				'transformations',
				'upstream'
			].sort()
		) ||
		manifest.format !== HASKELL_MANIFEST_FORMAT ||
		manifest.runtime !== RUNTIME ||
		!/^([a-f0-9]{64})$/u.test(manifest.fingerprint) ||
		!Array.isArray(manifest.assets) ||
		manifest.assets.length !== LOGICAL_ASSET_PATHS.length ||
		!Array.isArray(manifest.storage) ||
		manifest.storage.length !== LOGICAL_ASSET_PATHS.length ||
		!Array.isArray(manifest.legalFiles) ||
		manifest.legalFiles.length !== 4 ||
		!isObject(manifest.metadata)
	) {
		throw new Error('wasm-haskell installed manifest is invalid');
	}
	const { fingerprint, ...manifestBody } = manifest;
	if (
		sha256(`${HASKELL_FINGERPRINT_DOMAIN}\n${canonicalHaskellRuntimeJson(manifestBody)}`) !==
		fingerprint
	) {
		throw new Error('wasm-haskell installed manifest fingerprint is invalid');
	}
	const expectedAssetPaths = [...LOGICAL_ASSET_PATHS].sort();
	if (
		manifest.assets.some(
			(asset) =>
				!hasExactKeys(asset, ['mediaType', 'path', 'sha256', 'size']) ||
				typeof asset.mediaType !== 'string' ||
				validateRelativePath(asset.path, 'wasm-haskell logical asset') !== asset.path ||
				validateByteSize(asset.size, `wasm-haskell logical asset ${asset.path}`) !==
					asset.size ||
				validateSha256(asset.sha256, `wasm-haskell logical asset ${asset.path}`) !==
					asset.sha256
		) ||
		JSON.stringify(manifest.assets.map((asset) => asset.path).sort()) !==
			JSON.stringify(expectedAssetPaths)
	) {
		throw new Error('wasm-haskell installed logical asset graph is invalid');
	}
	const assets = new Map(manifest.assets.map((asset) => [asset.path, asset]));
	const expectedStoragePaths = ['bsdtar.wasm.gz', 'dyld.mjs', 'rootfs.tar.zst'];
	if (
		manifest.storage.some(
			(storage) =>
				!hasExactKeys(storage, ['encoding', 'logicalPath', 'path', 'sha256', 'size']) ||
				!['gzip', 'identity'].includes(storage.encoding) ||
				validateRelativePath(storage.path, 'wasm-haskell storage asset') !== storage.path ||
				!assets.has(storage.logicalPath) ||
				validateByteSize(storage.size, `wasm-haskell storage asset ${storage.path}`) !==
					storage.size ||
				validateSha256(storage.sha256, `wasm-haskell storage asset ${storage.path}`) !==
					storage.sha256 ||
				(storage.logicalPath === 'bsdtar.wasm') !== (storage.encoding === 'gzip')
		) ||
		JSON.stringify(manifest.storage.map((storage) => storage.path).sort()) !==
			JSON.stringify(expectedStoragePaths)
	) {
		throw new Error('wasm-haskell installed storage graph is invalid');
	}
	for (const storage of manifest.storage) {
		const stored = await readStableRegularFile(
			path.join(targetDir, storage.path),
			`wasm-haskell storage ${storage.path}`
		);
		if (stored.byteLength !== storage.size || sha256(stored) !== storage.sha256) {
			throw new Error(`wasm-haskell storage receipt mismatch for ${storage.path}`);
		}
		const logical = storage.encoding === 'gzip' ? gunzipSync(stored) : stored;
		const asset = assets.get(storage.logicalPath);
		if (!asset || logical.byteLength !== asset.size || sha256(logical) !== asset.sha256) {
			throw new Error(`wasm-haskell logical receipt mismatch for ${storage.logicalPath}`);
		}
	}
	if (
		!hasExactKeys(manifest.metadata, ['mediaType', 'path', 'sha256', 'size']) ||
		manifest.metadata.path !== BUILD_METADATA_FILE ||
		manifest.metadata.mediaType !== 'application/json'
	) {
		throw new Error('wasm-haskell build metadata receipt is invalid');
	}
	const buildMetadataBytes = await readStableRegularFile(
		path.join(targetDir, BUILD_METADATA_FILE),
		'wasm-haskell build metadata',
		MAX_METADATA_BYTES
	);
	if (
		buildMetadataBytes.byteLength !== manifest.metadata.size ||
		sha256(buildMetadataBytes) !== manifest.metadata.sha256
	) {
		throw new Error('wasm-haskell build metadata receipt mismatch');
	}
	const buildMetadata = JSON.parse(buildMetadataBytes.toString('utf8'));
	if (
		!isObject(buildMetadata) ||
		buildMetadata.format !== 'wasm-haskell-runtime-build-v2' ||
		buildMetadata.runtime !== RUNTIME ||
		buildMetadata.profileId !== manifest.profileId ||
		canonicalHaskellRuntimeJson(buildMetadata.derivedOutputs) !==
			canonicalHaskellRuntimeJson(manifest.assets)
	) {
		throw new Error('wasm-haskell build metadata does not match its manifest');
	}
	const expectedLegalPaths = [
		'THIRD_PARTY_NOTICES.md',
		'licenses/browser-wasi-shim/LICENSE-APACHE',
		'licenses/browser-wasi-shim/LICENSE-MIT',
		'licenses/bsdtar-wasm/LICENSE'
	].sort();
	if (
		JSON.stringify(manifest.legalFiles.map((legal) => legal.targetPath).sort()) !==
		JSON.stringify(expectedLegalPaths)
	) {
		throw new Error('wasm-haskell installed legal graph is invalid');
	}
	for (const legal of manifest.legalFiles) {
		if (
			!hasExactKeys(legal, LEGAL_KEYS) ||
			validateRelativePath(legal.targetPath, 'wasm-haskell legal target') !== legal.targetPath
		) {
			throw new Error('wasm-haskell installed legal receipt is invalid');
		}
		const legalBytes = await readStableRegularFile(
			path.join(targetDir, legal.targetPath),
			`wasm-haskell legal file ${legal.targetPath}`,
			MAX_METADATA_BYTES
		);
		if (legalBytes.byteLength !== legal.bytes || sha256(legalBytes) !== legal.sha256) {
			throw new Error(`wasm-haskell legal receipt mismatch for ${legal.targetPath}`);
		}
	}
	const legacyManifest = JSON.parse(
		await readFile(path.join(targetDir, LEGACY_MANIFEST_FILE), 'utf8')
	);
	if (
		!isObject(legacyManifest) ||
		!hasExactKeys(
			legacyManifest,
			['files', 'formatVersion', 'packages', 'runtimeModule'].sort()
		) ||
		legacyManifest.formatVersion !== 1 ||
		legacyManifest.runtimeModule !== 'dyld.mjs' ||
		canonicalHaskellRuntimeJson(legacyManifest.packages) !==
			canonicalHaskellRuntimeJson({ '@bjorn3/browser_wasi_shim': '0.4.2' }) ||
		canonicalHaskellRuntimeJson(legacyManifest.files) !==
			canonicalHaskellRuntimeJson(
				manifest.assets.map((asset) => ({
					path: asset.path,
					bytes: asset.size,
					sha256: asset.sha256
				}))
			)
	) {
		throw new Error('wasm-haskell legacy manifest does not match the v2 manifest');
	}
	return manifest;
}

/** @param {SyncWasmHaskellOptions} [options] */
export async function syncWasmHaskellAssets(options = {}) {
	const targetDir = path.resolve(options.targetDir || DEFAULT_TARGET_DIR);
	const generatedModulePath = path.resolve(
		options.generatedModulePath ||
			(targetDir === DEFAULT_TARGET_DIR
				? DEFAULT_GENERATED_MODULE_PATH
				: `${targetDir}.haskell-runtime.generated.ts`)
	);
	const versionModulePath = path.resolve(
		options.versionModulePath ||
			(targetDir === DEFAULT_TARGET_DIR
				? DEFAULT_VERSION_MODULE_PATH
				: `${targetDir}.wasmHaskellVersion.ts`)
	);
	const compressedManifestPath = path.resolve(
		options.compressedManifestPath ||
			(targetDir === DEFAULT_TARGET_DIR
				? DEFAULT_COMPRESSED_MANIFEST_PATH
				: `${targetDir}.compressed-runtime-assets.v1.json`)
	);
	const lockFilePath = path.resolve(options.lockFilePath || DEFAULT_LOCK_FILE_PATH);
	const nodeModulesDir = path.resolve(options.nodeModulesDir || DEFAULT_NODE_MODULES_DIR);
	const pnpmLockPath = path.resolve(options.pnpmLockPath || DEFAULT_PNPM_LOCK_PATH);
	const sourceDir = options.sourceDir ? path.resolve(options.sourceDir) : undefined;
	const fetchImpl = options.fetch || globalThis.fetch?.bind(globalThis);
	const renamePath = options.renamePath || rename;
	assertNonOverlappingHaskellPaths([
		['runtime target', targetDir],
		['generated receipt module', generatedModulePath],
		['version module', versionModulePath],
		['compressed asset manifest', compressedManifestPath],
		['input lock', lockFilePath],
		['pnpm lock', pnpmLockPath],
		['node_modules', nodeModulesDir],
		...(sourceDir ? [['local source', sourceDir]] : [])
	]);

	const lockBytes = await readStableRegularFile(lockFilePath, 'wasm-haskell input lock');
	const compressedManifestInputBytes = await readStableRegularFile(
		compressedManifestPath,
		'compressed runtime asset manifest',
		MAX_METADATA_BYTES
	);
	let lock;
	try {
		lock = JSON.parse(lockBytes.toString('utf8'));
	} catch (error) {
		throw new Error('wasm-haskell input lock is not valid JSON', { cause: error });
	}
	if (
		!hasExactKeys(lock, TOP_LEVEL_LOCK_KEYS) ||
		lock.schemaVersion !== 1 ||
		typeof lock.profileId !== 'string' ||
		!/^ghc-in-browser-[0-9A-Za-z._-]+$/u.test(lock.profileId) ||
		lock.provenanceLevel !== 'commit-and-receipt-pinned-unattested-binaries' ||
		lock.licenseExpression !== 'NOASSERTION AND BSD-2-Clause AND (MIT OR Apache-2.0)' ||
		!isObject(lock.upstream) ||
		!Array.isArray(lock.packages) ||
		lock.packages.length !== PACKAGE_NAMES.length ||
		!isObject(lock.producer) ||
		!Array.isArray(lock.transformations) ||
		!Array.isArray(lock.legalFiles) ||
		!Array.isArray(lock.outputs)
	) {
		throw new Error('wasm-haskell input lock has invalid or expanded top-level metadata');
	}
	if (
		!hasExactKeys(lock.upstream, ['bsdtar', 'ghcInBrowser']) ||
		!hasExactKeys(
			lock.upstream.ghcInBrowser,
			[
				'artifactCommit',
				'assets',
				'evidence',
				'repository',
				'revision',
				'verifiedBuildInput'
			].sort()
		) ||
		!hasExactKeys(
			lock.upstream.bsdtar,
			[
				'artifactApiUrl',
				'asset',
				'downloadUrl',
				'evidence',
				'repository',
				'revision',
				'verifiedBuildInput',
				'workflowRun'
			].sort()
		) ||
		!Array.isArray(lock.upstream.ghcInBrowser.assets) ||
		lock.upstream.ghcInBrowser.assets.length !== 4 ||
		lock.upstream.ghcInBrowser.verifiedBuildInput !== false ||
		lock.upstream.bsdtar.verifiedBuildInput !== false
	) {
		throw new Error('wasm-haskell input lock has invalid upstream provenance');
	}
	const sourceDescriptors = [
		...lock.upstream.ghcInBrowser.assets.map((candidate, index) =>
			validateSourceDescriptor(candidate, `wasm-haskell GHC source ${index}`)
		),
		validateSourceDescriptor(lock.upstream.bsdtar.asset, 'wasm-haskell bsdtar source')
	];
	if (
		JSON.stringify(sourceDescriptors.map(({ path: assetPath }) => assetPath).sort()) !==
		JSON.stringify([...SOURCE_ASSET_PATHS].sort())
	) {
		throw new Error('wasm-haskell input lock must describe exactly five source assets');
	}
	const packages = new Map();
	for (const candidate of lock.packages) {
		if (
			!hasExactKeys(candidate, PACKAGE_KEYS) ||
			typeof candidate.name !== 'string' ||
			packages.has(candidate.name) ||
			typeof candidate.version !== 'string' ||
			typeof candidate.requestedRange !== 'string' ||
			typeof candidate.tarballUrl !== 'string' ||
			!candidate.tarballUrl.startsWith('https://registry.npmjs.org/') ||
			typeof candidate.integrity !== 'string' ||
			!/^sha512-[A-Za-z0-9+/]+={0,2}$/u.test(candidate.integrity) ||
			typeof candidate.license !== 'string' ||
			typeof candidate.repository !== 'string' ||
			typeof candidate.revision !== 'string'
		) {
			throw new Error('wasm-haskell input lock has an invalid package descriptor');
		}
		validateByteSize(candidate.bytes, `${candidate.name} package tree`, 8 * 1024 * 1024);
		validateByteSize(candidate.files, `${candidate.name} package file count`, 10_000);
		validateSha256(candidate.treeSha256, `${candidate.name} package tree`);
		packages.set(candidate.name, candidate);
	}
	if (PACKAGE_NAMES.some((name) => !packages.has(name))) {
		throw new Error('wasm-haskell input lock is missing a producer package');
	}
	if (
		!hasExactKeys(lock.producer, ['script']) ||
		!hasExactKeys(lock.producer.script, ['bytes', 'path', 'sha256']) ||
		lock.producer.script.path !== 'scripts/sync-wasm-haskell.mjs'
	) {
		throw new Error('wasm-haskell producer receipt is invalid');
	}
	validateByteSize(lock.producer.script.bytes, 'wasm-haskell producer', MAX_METADATA_BYTES);
	validateSha256(lock.producer.script.sha256, 'wasm-haskell producer');
	const producerBytes = await readStableRegularFile(THIS_FILE, 'wasm-haskell producer');
	if (
		producerBytes.byteLength !== lock.producer.script.bytes ||
		sha256(producerBytes) !== lock.producer.script.sha256
	) {
		throw new Error('wasm-haskell producer does not match its locked receipt');
	}
	const pnpmLockText = (
		await readStableRegularFile(pnpmLockPath, 'pnpm lock', 16 * 1024 * 1024)
	).toString('utf8');
	for (const packageName of PACKAGE_NAMES) {
		const descriptor = packages.get(packageName);
		const packageDir = path.join(nodeModulesDir, ...packageName.split('/'));
		const packageJson = JSON.parse(
			(
				await readStableRegularFile(
					path.join(packageDir, 'package.json'),
					`${packageName} package metadata`,
					MAX_METADATA_BYTES
				)
			).toString('utf8')
		);
		if (packageJson.name !== packageName || packageJson.version !== descriptor.version) {
			throw new Error(`wasm-haskell producer package identity mismatch for ${packageName}`);
		}
		const tree = await haskellPackageTreeReceipt(packageDir);
		if (
			tree.files !== descriptor.files ||
			tree.bytes !== descriptor.bytes ||
			tree.treeSha256 !== descriptor.treeSha256 ||
			pnpmPackageIntegrity(pnpmLockText, packageName, descriptor.version) !==
				descriptor.integrity
		) {
			throw new Error(`wasm-haskell producer package receipt mismatch for ${packageName}`);
		}
	}
	const legalFiles = [];
	for (const candidate of lock.legalFiles) {
		if (
			!hasExactKeys(candidate, LEGAL_KEYS) ||
			typeof candidate.sourcePath !== 'string' ||
			typeof candidate.targetPath !== 'string' ||
			typeof candidate.mediaType !== 'string' ||
			typeof candidate.spdx !== 'string'
		) {
			throw new Error('wasm-haskell legal receipt is invalid');
		}
		const sourcePath = validateRelativePath(candidate.sourcePath, 'wasm-haskell legal source');
		const targetPath = validateRelativePath(candidate.targetPath, 'wasm-haskell legal target');
		const bytes = await readStableRegularFile(
			path.join(REPO_ROOT, sourcePath),
			`wasm-haskell legal source ${sourcePath}`,
			MAX_METADATA_BYTES
		);
		if (
			bytes.byteLength !==
				validateByteSize(candidate.bytes, sourcePath, MAX_METADATA_BYTES) ||
			sha256(bytes) !== validateSha256(candidate.sha256, sourcePath)
		) {
			throw new Error(`wasm-haskell legal receipt mismatch for ${sourcePath}`);
		}
		legalFiles.push({ ...candidate, sourcePath, targetPath, data: bytes });
	}
	const expectedLegalTargets = [
		'THIRD_PARTY_NOTICES.md',
		'licenses/browser-wasi-shim/LICENSE-APACHE',
		'licenses/browser-wasi-shim/LICENSE-MIT',
		'licenses/bsdtar-wasm/LICENSE'
	].sort();
	if (
		JSON.stringify(legalFiles.map(({ targetPath }) => targetPath).sort()) !==
		JSON.stringify(expectedLegalTargets)
	) {
		throw new Error('wasm-haskell legal file graph is not exact');
	}
	const expectedOutputs = lock.outputs.map((candidate, index) =>
		validateOutputDescriptor(candidate, `wasm-haskell output ${index}`)
	);
	if (
		JSON.stringify(expectedOutputs.map(({ path: assetPath }) => assetPath).sort()) !==
		JSON.stringify([...LOGICAL_ASSET_PATHS].sort())
	) {
		throw new Error('wasm-haskell output graph is not exact');
	}

	/** @type {Map<string, Buffer>} */
	const sourceBytes = new Map();
	if (sourceDir) {
		const sourceFiles = await listRegularFiles(sourceDir);
		if (JSON.stringify(sourceFiles) !== JSON.stringify([...SOURCE_ASSET_PATHS].sort())) {
			throw new Error('wasm-haskell local source graph must contain exactly five assets');
		}
		for (const descriptor of sourceDescriptors) {
			sourceBytes.set(
				descriptor.path,
				await readStableRegularFile(
					path.join(sourceDir, descriptor.path),
					`wasm-haskell source ${descriptor.path}`
				)
			);
		}
	} else {
		if (!fetchImpl) throw new Error('fetch is required to download pinned wasm-haskell assets');
		const controller = new AbortController();
		const timer = setTimeout(
			() => controller.abort(new Error('wasm-haskell source download timed out')),
			DOWNLOAD_TIMEOUT_MS
		);
		try {
			const downloaded = await Promise.all(
				sourceDescriptors.map(async (descriptor) => {
					const response = await fetchImpl(descriptor.url, {
						cache: 'no-store',
						credentials: 'omit',
						redirect: 'error',
						referrerPolicy: 'no-referrer',
						signal: controller.signal
					});
					if (!response.ok || (response.url && response.url !== descriptor.url)) {
						await response.body?.cancel().catch(() => undefined);
						throw new Error(
							`failed to download pinned wasm-haskell asset ${descriptor.path}`
						);
					}
					const bytes = await readPinnedHaskellResponse(
						response,
						descriptor.bytes,
						`wasm-haskell source ${descriptor.path}`,
						controller.signal
					);
					if (sha256(bytes) !== descriptor.sha256) {
						throw new Error(
							`wasm-haskell source receipt mismatch for ${descriptor.path}`
						);
					}
					return [descriptor.path, bytes];
				})
			);
			for (const [assetPath, bytes] of downloaded) sourceBytes.set(assetPath, bytes);
		} catch (error) {
			controller.abort(error);
			throw error;
		} finally {
			clearTimeout(timer);
		}
	}
	for (const descriptor of sourceDescriptors) {
		const bytes = sourceBytes.get(descriptor.path);
		if (
			!bytes ||
			bytes.byteLength !== descriptor.bytes ||
			sha256(bytes) !== descriptor.sha256
		) {
			throw new Error(`wasm-haskell source receipt mismatch for ${descriptor.path}`);
		}
	}
	const bsdtarBytes = sourceBytes.get('bsdtar.wasm');
	if (
		!bsdtarBytes ||
		bsdtarBytes.byteLength < 8 ||
		!bsdtarBytes.subarray(0, 4).equals(Buffer.from([0, 97, 115, 109]))
	) {
		throw new Error('wasm-haskell bsdtar source is not a valid Wasm binary');
	}
	const rootfsBytes = sourceBytes.get('rootfs.tar.zst');
	if (
		!rootfsBytes ||
		rootfsBytes.byteLength < 4 ||
		!rootfsBytes.subarray(0, 4).equals(Buffer.from([0x28, 0xb5, 0x2f, 0xfd]))
	) {
		throw new Error('wasm-haskell rootfs source is not a valid zstd archive');
	}

	const workDir = await mkdtemp(path.join(os.tmpdir(), 'wasm-idle-haskell-sync-'));
	const bundleSourceDir = path.join(workDir, 'source');
	const bundleOutputDir = path.join(workDir, 'bundle');
	const stagedTarget = path.join(workDir, 'runtime');
	try {
		await mkdir(bundleSourceDir, { recursive: true });
		for (const fileName of ['dyld.mjs', 'prelude.mjs', 'post-link.mjs']) {
			await writeFile(path.join(bundleSourceDir, fileName), sourceBytes.get(fileName));
		}
		const dyldBytes = await buildHaskellModuleBundle({
			sourceDir: bundleSourceDir,
			shimPackageDir: path.join(nodeModulesDir, '@bjorn3', 'browser_wasi_shim'),
			outDir: bundleOutputDir,
			repoRoot: REPO_ROOT
		});
		const logicalBytes = new Map([
			['dyld.mjs', Buffer.from(dyldBytes)],
			['rootfs.tar.zst', rootfsBytes],
			['bsdtar.wasm', bsdtarBytes]
		]);
		const assets = LOGICAL_ASSET_PATHS.map((assetPath) => {
			const bytes = logicalBytes.get(assetPath);
			return {
				path: assetPath,
				mediaType:
					assetPath === 'dyld.mjs'
						? 'text/javascript'
						: assetPath === 'bsdtar.wasm'
							? 'application/wasm'
							: 'application/zstd',
				size: bytes.byteLength,
				sha256: sha256(bytes)
			};
		});
		for (const expected of expectedOutputs) {
			const actual = assets.find((asset) => asset.path === expected.path);
			if (
				!actual ||
				actual.mediaType !== expected.mediaType ||
				actual.size !== expected.bytes ||
				actual.sha256 !== expected.sha256
			) {
				throw new Error(
					`wasm-haskell derived output receipt mismatch for ${expected.path}: ${JSON.stringify({ expected, actual })}`
				);
			}
		}
		const storage = LOGICAL_ASSET_PATHS.map((logicalPath) => {
			const logical = logicalBytes.get(logicalPath);
			const encoding = logicalPath === 'bsdtar.wasm' ? 'gzip' : 'identity';
			const stored = encoding === 'gzip' ? gzipSync(logical, { level: 9 }) : logical;
			return {
				path: encoding === 'gzip' ? `${logicalPath}.gz` : logicalPath,
				logicalPath,
				encoding,
				size: stored.byteLength,
				sha256: sha256(stored),
				bytes: stored
			};
		});
		const legalMetadata = legalFiles.map(({ data: _data, ...candidate }) => ({ ...candidate }));
		const buildMetadata = {
			format: 'wasm-haskell-runtime-build-v2',
			runtime: RUNTIME,
			profileId: lock.profileId,
			provenanceLevel: lock.provenanceLevel,
			licenseExpression: lock.licenseExpression,
			upstream: lock.upstream,
			packages: lock.packages,
			producer: lock.producer,
			packageTreeReceiptFormat: 'sha256-json-sorted-package-files-excluding-node-modules-v2',
			transformations: lock.transformations,
			legalFiles: legalMetadata,
			inputLock: {
				path: path.relative(REPO_ROOT, lockFilePath).split(path.sep).join('/'),
				bytes: lockBytes.byteLength,
				sha256: sha256(lockBytes)
			},
			sourceAssets: sourceDescriptors.map(({ url: _url, ...descriptor }) => descriptor),
			derivedOutputs: assets
		};
		const buildMetadataBytes = Buffer.from(`${JSON.stringify(buildMetadata, null, 2)}\n`);
		const manifestBody = {
			format: HASKELL_MANIFEST_FORMAT,
			runtime: RUNTIME,
			profileId: lock.profileId,
			provenanceLevel: lock.provenanceLevel,
			licenseExpression: lock.licenseExpression,
			upstream: lock.upstream,
			packages: lock.packages,
			producer: lock.producer,
			transformations: lock.transformations,
			legalFiles: legalMetadata,
			metadata: {
				path: BUILD_METADATA_FILE,
				mediaType: 'application/json',
				size: buildMetadataBytes.byteLength,
				sha256: sha256(buildMetadataBytes)
			},
			assets,
			storage: storage.map(({ bytes: _bytes, ...candidate }) => candidate)
		};
		const fingerprint = sha256(
			`${HASKELL_FINGERPRINT_DOMAIN}\n${canonicalHaskellRuntimeJson(manifestBody)}`
		);
		const manifest = { ...manifestBody, fingerprint };
		const legacyManifest = {
			formatVersion: 1,
			runtimeModule: 'dyld.mjs',
			packages: { '@bjorn3/browser_wasi_shim': '0.4.2' },
			files: assets.map((asset) => ({
				path: asset.path,
				bytes: asset.size,
				sha256: asset.sha256
			}))
		};
		const generatedReceiptEntries = assets
			.map(
				(asset) =>
					`\t'${asset.path}': Object.freeze({\n\t\tbytes: ${asset.size},\n\t\tsha256: '${asset.sha256}'\n\t})`
			)
			.join(',\n');
		const generatedModule = `// Generated by scripts/sync-wasm-haskell.mjs. Do not edit.\nexport const HASKELL_RUNTIME_GENERATED_ASSET_VERSION =\n\t'${fingerprint}' as const;\nexport const HASKELL_RUNTIME_GENERATED_ASSET_RECEIPTS = Object.freeze({\n${generatedReceiptEntries}\n});\n`;
		const versionModule = `export const WASM_HASKELL_ASSET_VERSION =\n\t'${fingerprint}';\n`;
		const compressedManifest = updateHaskellCompressedAssetManifest(
			compressedManifestInputBytes.toString('utf8'),
			logicalBytes.get('bsdtar.wasm').byteLength
		);

		await mkdir(stagedTarget, { recursive: true });
		for (const stored of storage) {
			await writeFile(path.join(stagedTarget, stored.path), stored.bytes);
		}
		for (const legal of legalFiles) {
			await mkdir(path.dirname(path.join(stagedTarget, legal.targetPath)), {
				recursive: true
			});
			await writeFile(path.join(stagedTarget, legal.targetPath), legal.data);
		}
		await writeFile(path.join(stagedTarget, BUILD_METADATA_FILE), buildMetadataBytes);
		await writeFile(
			path.join(stagedTarget, LEGACY_MANIFEST_FILE),
			`${JSON.stringify(legacyManifest, null, 2)}\n`
		);
		await writeFile(
			path.join(stagedTarget, MANIFEST_FILE),
			`${JSON.stringify(manifest, null, 2)}\n`
		);
		await validateHaskellRuntimePublication(stagedTarget);

		await mkdir(path.dirname(targetDir), { recursive: true });
		await mkdir(path.dirname(generatedModulePath), { recursive: true });
		await mkdir(path.dirname(versionModulePath), { recursive: true });
		await mkdir(path.dirname(compressedManifestPath), { recursive: true });
		const [currentProducerBytes, currentLockBytes, currentCompressedManifestBytes] =
			await Promise.all([
				readStableRegularFile(THIS_FILE, 'wasm-haskell producer'),
				readStableRegularFile(lockFilePath, 'wasm-haskell input lock'),
				readStableRegularFile(
					compressedManifestPath,
					'compressed runtime asset manifest',
					MAX_METADATA_BYTES
				)
			]);
		if (
			!currentProducerBytes.equals(producerBytes) ||
			!currentLockBytes.equals(lockBytes) ||
			!currentCompressedManifestBytes.equals(compressedManifestInputBytes)
		) {
			throw new Error('wasm-haskell producer inputs changed before publication');
		}
		const generatedTemporary = `${generatedModulePath}.tmp-${process.pid}-${Date.now()}`;
		const versionTemporary = `${versionModulePath}.tmp-${process.pid}-${Date.now()}`;
		const compressedManifestTemporary = `${compressedManifestPath}.tmp-${process.pid}-${Date.now()}`;
		await writeFile(generatedTemporary, generatedModule, 'utf8');
		await writeFile(versionTemporary, versionModule, 'utf8');
		await writeFile(compressedManifestTemporary, compressedManifest, 'utf8');
		/** @type {Publication[]} */
		const publications = [
			{
				target: targetDir,
				temporary: stagedTarget,
				previous: `${targetDir}.previous-${process.pid}-${Date.now()}`,
				hadTarget: !!(await stat(targetDir).catch(() => null)),
				backedUp: false,
				published: false
			},
			{
				target: generatedModulePath,
				temporary: generatedTemporary,
				previous: `${generatedModulePath}.previous-${process.pid}-${Date.now()}`,
				hadTarget: !!(await stat(generatedModulePath).catch(() => null)),
				backedUp: false,
				published: false
			},
			{
				target: versionModulePath,
				temporary: versionTemporary,
				previous: `${versionModulePath}.previous-${process.pid}-${Date.now()}`,
				hadTarget: !!(await stat(versionModulePath).catch(() => null)),
				backedUp: false,
				published: false
			},
			{
				target: compressedManifestPath,
				temporary: compressedManifestTemporary,
				previous: `${compressedManifestPath}.previous-${process.pid}-${Date.now()}`,
				hadTarget: !!(await stat(compressedManifestPath).catch(() => null)),
				backedUp: false,
				published: false
			}
		];
		try {
			for (const publication of publications) {
				await rm(publication.previous, { recursive: true, force: true });
				if (publication.hadTarget) {
					await renamePath(publication.target, publication.previous);
					publication.backedUp = true;
				}
				await renamePath(publication.temporary, publication.target);
				publication.published = true;
			}
		} catch (error) {
			for (const publication of [...publications].reverse()) {
				if (publication.published) {
					await rm(publication.target, { recursive: true, force: true });
				}
				if (publication.backedUp) {
					await rename(publication.previous, publication.target);
				}
			}
			throw error;
		} finally {
			for (const publication of publications) {
				await rm(publication.previous, { recursive: true, force: true });
				await rm(publication.temporary, { recursive: true, force: true });
			}
		}
		return {
			sourceDir: sourceDir || null,
			targetDir,
			generatedModulePath,
			versionModulePath,
			compressedManifestPath,
			fingerprint
		};
	} finally {
		await rm(workDir, { recursive: true, force: true });
	}
}

if (process.argv[1] && path.resolve(process.argv[1]) === THIS_FILE) {
	const [, , sourceDirArg, targetDirArg] = process.argv;
	const result = await syncWasmHaskellAssets({
		sourceDir: sourceDirArg || undefined,
		targetDir: targetDirArg || DEFAULT_TARGET_DIR
	});
	console.log(`Synced pinned wasm-haskell assets to ${result.targetDir}`);
}
