import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGunzip, gunzipSync } from 'node:zlib';

const THIS_FILE = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(THIS_FILE), '..');
const DEFAULT_OUTPUT = path.join(REPO_ROOT, 'packages/core/src/runtime-asset-lock.generated.ts');
const RUNTIME_DIRS = new Set([
	'clang',
	'clangd',
	'pyodide',
	'teavm',
	'webr',
	'lsp',
	'shared',
	'jungol-robot',
	'robot-jungol'
]);
const INDEX_NAMES = ['compressed-runtime-assets.v1.json', 'layered-runtime-assets.v1.json'];

function isSafeRelativePath(value) {
	return (
		typeof value === 'string' &&
		value.length > 0 &&
		!/[\\\0%]/u.test(value) &&
		!value.startsWith('/') &&
		value.split('/').every((part) => part && part !== '.' && part !== '..')
	);
}

function isRuntimePath(relativePath) {
	const [root] = relativePath.split('/');
	return root.startsWith('wasm-') || RUNTIME_DIRS.has(root) || INDEX_NAMES.includes(relativePath);
}

function isExcluded(relativePath) {
	return (
		relativePath
			.split('/')
			.some(
				(part) => part.startsWith('.') || ['docs', 'reference', 'licenses'].includes(part)
			) ||
		/\.(?:map|md|mdx)$/iu.test(relativePath) ||
		/(?:^|\/)(?:LICENSE|NOTICE|COPYING)(?:\.[^/]*)?$/iu.test(relativePath)
	);
}

async function collectFiles(rootDir, directory = '') {
	const files = [];
	const entries = await readdir(path.join(rootDir, directory), { withFileTypes: true });
	for (const entry of entries) {
		const relativePath = directory ? `${directory}/${entry.name}` : entry.name;
		if ((!directory && !isRuntimePath(relativePath)) || isExcluded(relativePath)) continue;
		if (!isSafeRelativePath(relativePath))
			throw new Error(`Unsafe runtime asset path: ${relativePath}`);
		if (entry.isSymbolicLink())
			throw new Error(`Runtime asset must not be a symbolic link: ${relativePath}`);
		if (entry.isDirectory()) files.push(...(await collectFiles(rootDir, relativePath)));
		else if (entry.isFile()) files.push(relativePath);
		else throw new Error(`Runtime asset must be a regular file: ${relativePath}`);
	}
	return files.sort();
}

function mediaType(relativePath) {
	if (/\.(?:m?js|cjs)$/iu.test(relativePath)) return 'text/javascript';
	if (/\.json$/iu.test(relativePath)) return 'application/json';
	if (/\.wasm$/iu.test(relativePath)) return 'application/wasm';
	if (/\.(?:zip|whl)$/iu.test(relativePath)) return 'application/zip';
	return 'application/octet-stream';
}

function receipt(bytes) {
	return { sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.byteLength };
}

async function fileReceipt(filePath, gzip = false) {
	const hash = createHash('sha256');
	const input = createReadStream(filePath);
	const stream = gzip ? input.pipe(createGunzip()) : input;
	if (gzip) input.on('error', (error) => stream.destroy(error));
	let bytes = 0;
	for await (const chunk of stream) {
		bytes += chunk.byteLength;
		hash.update(chunk);
	}
	return { sha256: hash.digest('hex'), bytes };
}

async function optionalIndex(rootDir, name) {
	try {
		return JSON.parse(await readFile(path.join(rootDir, name), 'utf8'));
	} catch (error) {
		if (error?.code === 'ENOENT') return undefined;
		throw error;
	}
}

function insertLogical(assets, assetPath, value) {
	const existing = assets[assetPath];
	if (existing && (existing.sha256 !== value.sha256 || existing.bytes !== value.bytes)) {
		throw new Error(`Conflicting physical/logical runtime asset: ${assetPath}`);
	}
	assets[assetPath] = { ...existing, ...value };
}

/** Generate receipts without modifying any runtime source or delivery asset. */
export async function createRuntimeAssetLock({
	rootDir = path.join(REPO_ROOT, 'static'),
	packageFile = path.join(REPO_ROOT, 'package.json')
} = {}) {
	const { version } = JSON.parse(await readFile(packageFile, 'utf8'));
	if (typeof version !== 'string' || !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/u.test(version)) {
		throw new Error('Runtime asset lock requires a valid package version');
	}
	const assets = Object.create(null);
	for (const relativePath of await collectFiles(rootDir)) {
		const filePath = path.join(rootDir, relativePath);
		const entry = await fileReceipt(filePath);
		if (/\.(?:gz|tgz)(?:\.bin)?$/iu.test(relativePath)) {
			const decoded = await fileReceipt(filePath, true);
			Object.assign(entry, {
				encoding: 'gzip',
				mediaType: mediaType(relativePath.replace(/\.gz(?:\.bin)?$/iu, '')),
				uncompressedSha256: decoded.sha256,
				uncompressedBytes: decoded.bytes
			});
		} else entry.mediaType = mediaType(relativePath);
		assets[relativePath] = entry;
	}

	const compressed = await optionalIndex(rootDir, INDEX_NAMES[0]);
	if (compressed) {
		if (!Array.isArray(compressed.assets))
			throw new Error('Invalid compressed runtime asset index');
		const seen = new Set();
		for (const assetPath of compressed.assets) {
			// Build output also lists Vite application files, which belong to that app's release.
			if (typeof assetPath === 'string' && assetPath.startsWith('_app/')) continue;
			if (
				!isSafeRelativePath(assetPath) ||
				!isRuntimePath(assetPath) ||
				seen.has(assetPath)
			) {
				throw new Error(`Invalid or duplicate compressed runtime asset: ${assetPath}`);
			}
			seen.add(assetPath);
			const deliveryPath = `${assetPath}.gz`;
			const physical = assets[deliveryPath];
			if (
				!physical ||
				physical.encoding !== 'gzip' ||
				compressed.sizes?.[assetPath] !== physical.uncompressedBytes
			) {
				throw new Error(`Missing or stale compressed runtime asset: ${assetPath}`);
			}
			insertLogical(assets, assetPath, {
				sha256: physical.uncompressedSha256,
				bytes: physical.uncompressedBytes,
				mediaType: mediaType(assetPath),
				deliveryPath
			});
		}
	}

	const layered = await optionalIndex(rootDir, INDEX_NAMES[1]);
	if (layered) {
		if (layered.schemaVersion !== 1 || !layered.assets || !layered.layers)
			throw new Error('Invalid layered runtime asset index');
		const byLayer = new Map();
		for (const [assetPath, item] of Object.entries(layered.assets)) {
			if (
				!isSafeRelativePath(assetPath) ||
				!isRuntimePath(assetPath) ||
				!isSafeRelativePath(item?.layer)
			) {
				throw new Error(`Invalid layered runtime asset: ${assetPath}`);
			}
			const group = byLayer.get(item.layer) ?? [];
			group.push([assetPath, item]);
			byLayer.set(item.layer, group);
		}
		for (const [layerPath, entries] of byLayer) {
			const physical = assets[layerPath];
			const descriptor = layered.layers[layerPath];
			if (!physical || physical.encoding !== 'gzip' || !descriptor)
				throw new Error(`Missing runtime layer: ${layerPath}`);
			if (
				typeof descriptor !== 'object' ||
				descriptor.sha256 !== physical.sha256 ||
				descriptor.compressedLength !== physical.bytes ||
				descriptor.length !== physical.uncompressedBytes
			) {
				throw new Error(`Stale runtime layer receipt: ${layerPath}`);
			}
			const decoded = gunzipSync(await readFile(path.join(rootDir, layerPath)));
			for (const [assetPath, item] of entries) {
				if (
					!Number.isSafeInteger(item.offset) ||
					!Number.isSafeInteger(item.length) ||
					item.offset < 0 ||
					item.length < 0 ||
					item.offset + item.length > decoded.byteLength
				) {
					throw new Error(`Invalid runtime layer range: ${assetPath}`);
				}
				insertLogical(assets, assetPath, {
					...receipt(decoded.subarray(item.offset, item.offset + item.length)),
					mediaType: mediaType(assetPath),
					layer: { path: layerPath, offset: item.offset, bytes: item.length }
				});
			}
		}
	}
	return {
		schemaVersion: 1,
		version,
		assets: Object.fromEntries(
			Object.entries(assets).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
		)
	};
}

export function renderRuntimeAssetLock(manifest) {
	return (
		`// Generated by scripts/generate-runtime-asset-lock.mjs. Do not edit by hand.\n` +
		`import type { RuntimeAssetLockManifest } from './runtime-asset-lock.js';\n\n` +
		`export const WASM_IDLE_ASSET_VERSION: string = '${manifest.version}';\n` +
		`export const RUNTIME_ASSET_LOCK_VERSION: string = WASM_IDLE_ASSET_VERSION;\n\n` +
		`// prettier-ignore\nexport const RUNTIME_ASSET_LOCK: RuntimeAssetLockManifest = {\n` +
		`\tschemaVersion: 1,\n\tversion: WASM_IDLE_ASSET_VERSION,\n\tassets: {\n` +
		Object.entries(manifest.assets)
			.map(([key, value]) => `\t\t${JSON.stringify(key)}: ${JSON.stringify(value)}`)
			.join(',\n') +
		`\n\t}\n};\n\n` +
		`for (const entry of Object.values(RUNTIME_ASSET_LOCK.assets)) {\n` +
		`\tif (entry.layer) Object.freeze(entry.layer);\n\tObject.freeze(entry);\n}\n` +
		`Object.freeze(RUNTIME_ASSET_LOCK.assets);\nObject.freeze(RUNTIME_ASSET_LOCK);\n`
	);
}

export async function generateRuntimeAssetLock(options = {}) {
	const manifest = await createRuntimeAssetLock(options);
	const output = options.output ?? DEFAULT_OUTPUT;
	const source = renderRuntimeAssetLock(manifest);
	if (options.check) {
		if ((await readFile(output, 'utf8')) !== source)
			throw new Error('Runtime asset lock is stale; regenerate it before release');
	} else {
		await mkdir(path.dirname(output), { recursive: true });
		await writeFile(output, source);
	}
	return manifest;
}

if (process.argv[1] && path.resolve(process.argv[1]) === THIS_FILE) {
	const args = process.argv.slice(2);
	const check = args.includes('--check');
	const rootArg = args.find((arg) => arg !== '--check');
	if (args.some((arg) => arg.startsWith('--') && arg !== '--check'))
		throw new Error(
			'Usage: generate-runtime-asset-lock.mjs [static|build|asset-root] [--check]'
		);
	const manifest = await generateRuntimeAssetLock({
		rootDir: rootArg ? path.resolve(REPO_ROOT, rootArg) : undefined,
		check
	});
	console.log(
		`${check ? 'Verified' : 'Generated'} runtime asset lock ${manifest.version}: ${Object.keys(manifest.assets).length} receipts`
	);
}
