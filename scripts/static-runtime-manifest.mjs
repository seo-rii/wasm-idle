import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';

export const STATIC_RUNTIME_MANIFEST_FILE = 'runtime-manifest.v1.json';

/**
 * @typedef {object} StaticRuntimeManifestFile
 * @property {string} path
 * @property {number} bytes
 * @property {string} sha256
 */

/**
 * @typedef {object} StaticRuntimeManifest
 * @property {number} formatVersion
 * @property {string} runtimeModule
 * @property {Record<string, string>} packages
 * @property {StaticRuntimeManifestFile[]} files
 */

/** @param {unknown} value */
function isRecord(value) {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** @param {string} relativePath */
function validateRelativePath(relativePath) {
	if (
		!relativePath ||
		relativePath.includes('\\') ||
		path.posix.isAbsolute(relativePath) ||
		path.posix.normalize(relativePath) !== relativePath ||
		relativePath === '..' ||
		relativePath.startsWith('../')
	) {
		throw new Error(`invalid static runtime asset path: ${relativePath}`);
	}
}

/** @param {string} filePath */
async function readOptionalFile(filePath) {
	try {
		return await readFile(filePath);
	} catch (error) {
		if (/** @type {NodeJS.ErrnoException} */ (error).code === 'ENOENT') return null;
		throw error;
	}
}

/**
 * Reads one logical asset, transparently expanding its checked-in gzip representation.
 *
 * @param {string} rootDir
 * @param {string} relativePath
 * @param {{ allowCompressed?: boolean }} [options]
 */
export async function readStaticRuntimeAsset(
	rootDir,
	relativePath,
	{ allowCompressed = false } = {}
) {
	validateRelativePath(relativePath);
	const assetPath = path.join(rootDir, ...relativePath.split('/'));
	const [rawBytes, compressedBytes] = await Promise.all([
		readOptionalFile(assetPath),
		allowCompressed ? readOptionalFile(`${assetPath}.gz`) : Promise.resolve(null)
	]);
	if (rawBytes && compressedBytes) {
		throw new Error(`static runtime asset has both raw and gzip files: ${relativePath}`);
	}
	if (rawBytes) return rawBytes;
	if (compressedBytes) {
		try {
			return gunzipSync(compressedBytes);
		} catch (error) {
			throw new Error(`invalid gzip static runtime asset: ${relativePath}`, { cause: error });
		}
	}
	throw new Error(`static runtime asset is missing: ${relativePath}`);
}

/**
 * @param {string} rootDir
 * @param {{
 *   allowCompressed?: boolean;
 *   expectedPackages?: Record<string, string>;
 *   expectedRuntimeModule?: string;
 * }} [options]
 * @returns {Promise<StaticRuntimeManifest>}
 */
export async function validateStaticRuntimeManifest(
	rootDir,
	{ allowCompressed = false, expectedPackages, expectedRuntimeModule } = {}
) {
	const manifestPath = path.join(rootDir, STATIC_RUNTIME_MANIFEST_FILE);
	let parsed;
	try {
		parsed = JSON.parse(await readFile(manifestPath, 'utf8'));
	} catch (error) {
		throw new Error(`invalid static runtime manifest at ${manifestPath}`, { cause: error });
	}
	if (!isRecord(parsed))
		throw new Error(`static runtime manifest must be an object: ${manifestPath}`);
	const manifest = /** @type {Record<string, unknown>} */ (parsed);
	if (manifest.formatVersion !== 1) {
		throw new Error(`unsupported static runtime manifest version in ${manifestPath}`);
	}
	if (typeof manifest.runtimeModule !== 'string') {
		throw new Error(`static runtime manifest has no runtimeModule: ${manifestPath}`);
	}
	validateRelativePath(manifest.runtimeModule);
	if (expectedRuntimeModule && manifest.runtimeModule !== expectedRuntimeModule) {
		throw new Error(
			`static runtime entry mismatch: expected ${expectedRuntimeModule}, received ${manifest.runtimeModule}`
		);
	}
	if (!isRecord(manifest.packages)) {
		throw new Error(`static runtime manifest has invalid packages: ${manifestPath}`);
	}
	const packages = /** @type {Record<string, unknown>} */ (manifest.packages);
	for (const [packageName, version] of Object.entries(packages)) {
		if (!packageName || typeof version !== 'string' || !version) {
			throw new Error(
				`static runtime manifest has invalid package metadata: ${manifestPath}`
			);
		}
	}
	if (expectedPackages) {
		const actualEntries = Object.entries(packages).sort(([left], [right]) =>
			left.localeCompare(right)
		);
		const expectedEntries = Object.entries(expectedPackages).sort(([left], [right]) =>
			left.localeCompare(right)
		);
		if (JSON.stringify(actualEntries) !== JSON.stringify(expectedEntries)) {
			throw new Error(
				`static runtime package metadata mismatch: expected ${JSON.stringify(expectedPackages)}, received ${JSON.stringify(manifest.packages)}`
			);
		}
	}
	if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
		throw new Error(`static runtime manifest has no files: ${manifestPath}`);
	}

	const seenPaths = new Set();
	/** @type {StaticRuntimeManifestFile[]} */
	const files = [];
	for (const value of manifest.files) {
		if (!isRecord(value)) throw new Error(`static runtime manifest has an invalid file entry`);
		const file = /** @type {Record<string, unknown>} */ (value);
		if (typeof file.path !== 'string') {
			throw new Error(`static runtime manifest file has no path`);
		}
		validateRelativePath(file.path);
		if (seenPaths.has(file.path)) {
			throw new Error(`duplicate static runtime asset path: ${file.path}`);
		}
		seenPaths.add(file.path);
		if (!Number.isSafeInteger(file.bytes) || /** @type {number} */ (file.bytes) < 0) {
			throw new Error(`static runtime asset has invalid byte size: ${file.path}`);
		}
		if (typeof file.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(file.sha256)) {
			throw new Error(`static runtime asset has invalid SHA-256: ${file.path}`);
		}
		const bytes = await readStaticRuntimeAsset(rootDir, file.path, { allowCompressed });
		if (bytes.byteLength !== file.bytes) {
			throw new Error(
				`static runtime asset size mismatch for ${file.path}: expected ${file.bytes}, received ${bytes.byteLength}`
			);
		}
		const sha256 = createHash('sha256').update(bytes).digest('hex');
		if (sha256 !== file.sha256) {
			throw new Error(
				`static runtime asset SHA-256 mismatch for ${file.path}: expected ${file.sha256}, received ${sha256}`
			);
		}
		files.push(
			/** @type {StaticRuntimeManifestFile} */ ({
				path: file.path,
				bytes: file.bytes,
				sha256: file.sha256
			})
		);
	}
	if (!seenPaths.has(manifest.runtimeModule)) {
		throw new Error(
			`static runtime entry is not listed in the manifest: ${manifest.runtimeModule}`
		);
	}

	return {
		formatVersion: 1,
		runtimeModule: manifest.runtimeModule,
		packages: /** @type {Record<string, string>} */ (packages),
		files
	};
}
