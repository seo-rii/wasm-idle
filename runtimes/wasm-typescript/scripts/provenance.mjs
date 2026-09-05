import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const WASM_TYPESCRIPT_PRODUCER_BUILD_FORMAT = 'wasm-typescript-producer-build-v1';
export const WASM_TYPESCRIPT_PRODUCER_RECEIPT_FILE = 'runtime-build.json';

const SOURCE_INPUT_FILES = Object.freeze(['package.json', 'tsconfig.json']);
const SOURCE_INPUT_DIRECTORIES = Object.freeze(['scripts', 'src']);
const TOOLCHAIN_PACKAGES = Object.freeze([
	'@swc/wasm-typescript',
	'buffer',
	'esbuild',
	'typescript'
]);

/** @param {Uint8Array} bytes */
function sha256(bytes) {
	return createHash('sha256').update(bytes).digest('hex');
}

/**
 * @param {string} directory
 * @param {string} relativeDirectory
 * @returns {Promise<string[]>}
 */
async function listInputFiles(directory, relativeDirectory) {
	const entries = await readdir(path.join(directory, relativeDirectory), {
		withFileTypes: true
	});
	/** @type {string[]} */
	const files = [];
	for (const entry of entries) {
		const relativePath = path.posix.join(relativeDirectory, entry.name);
		if (entry.isDirectory()) {
			files.push(...(await listInputFiles(directory, relativePath)));
		} else if (entry.isFile()) {
			files.push(relativePath);
		}
	}
	return files;
}

/** @param {string} producerDir */
export async function computeWasmTypeScriptSourceReceipt(producerDir) {
	const resolvedProducerDir = path.resolve(producerDir);
	const relativePaths = [...SOURCE_INPUT_FILES];
	for (const relativeDirectory of SOURCE_INPUT_DIRECTORIES) {
		relativePaths.push(...(await listInputFiles(resolvedProducerDir, relativeDirectory)));
	}
	relativePaths.sort((left, right) => left.localeCompare(right, 'en'));

	const hash = createHash('sha256');
	const files = [];
	for (const relativePath of relativePaths) {
		const bytes = await readFile(path.join(resolvedProducerDir, ...relativePath.split('/')));
		hash.update(relativePath);
		hash.update('\0');
		hash.update(bytes);
		hash.update('\n');
		files.push({
			path: relativePath,
			bytes: bytes.byteLength,
			sha256: sha256(bytes)
		});
	}
	return {
		format: 'wasm-typescript-source-inputs-v1',
		sha256: hash.digest('hex'),
		files
	};
}

/** @param {string} producerDir */
export async function readWasmTypeScriptToolchain(producerDir) {
	/** @type {Record<string, string>} */
	const toolchain = {};
	for (const packageName of TOOLCHAIN_PACKAGES) {
		const packagePath = path.join(
			path.resolve(producerDir),
			'node_modules',
			...packageName.split('/'),
			'package.json'
		);
		let packageMetadata;
		try {
			packageMetadata = JSON.parse(await readFile(packagePath, 'utf8'));
		} catch (error) {
			throw new Error(
				`wasm-typescript producer dependency metadata could not be read for ${packageName}`,
				{ cause: error }
			);
		}
		if (
			!packageMetadata ||
			typeof packageMetadata !== 'object' ||
			packageMetadata.name !== packageName ||
			typeof packageMetadata.version !== 'string' ||
			packageMetadata.version.length === 0
		) {
			throw new Error(
				`wasm-typescript producer dependency metadata is invalid for ${packageName}`
			);
		}
		toolchain[packageName] = packageMetadata.version;
	}
	return toolchain;
}

/**
 * @param {{ producerDir: string; sourceDir?: string }} options
 */
export async function createWasmTypeScriptProducerBuildReceipt({
	producerDir,
	sourceDir = path.join(producerDir, 'dist')
}) {
	const artifactPath = path.join(path.resolve(sourceDir), 'index.js');
	const artifactBytes = await readFile(artifactPath);
	return {
		format: WASM_TYPESCRIPT_PRODUCER_BUILD_FORMAT,
		source: await computeWasmTypeScriptSourceReceipt(producerDir),
		toolchain: await readWasmTypeScriptToolchain(producerDir),
		artifact: {
			path: 'index.js',
			bytes: artifactBytes.byteLength,
			sha256: sha256(artifactBytes)
		}
	};
}

/**
 * @param {{ producerDir: string; sourceDir?: string }} options
 */
export async function writeWasmTypeScriptProducerBuildReceipt(options) {
	const sourceDir = path.resolve(options.sourceDir || path.join(options.producerDir, 'dist'));
	const receipt = await createWasmTypeScriptProducerBuildReceipt({
		...options,
		sourceDir
	});
	await mkdir(sourceDir, { recursive: true });
	await writeFile(
		path.join(sourceDir, WASM_TYPESCRIPT_PRODUCER_RECEIPT_FILE),
		`${JSON.stringify(receipt, null, 2)}\n`,
		'utf8'
	);
	return receipt;
}

/**
 * @param {{ producerDir: string; sourceDir?: string }} options
 */
export async function verifyWasmTypeScriptProducerBuildReceipt({
	producerDir,
	sourceDir = path.join(producerDir, 'dist')
}) {
	const receiptPath = path.join(path.resolve(sourceDir), WASM_TYPESCRIPT_PRODUCER_RECEIPT_FILE);
	let actual;
	try {
		actual = JSON.parse(await readFile(receiptPath, 'utf8'));
	} catch (error) {
		throw new Error(
			`wasm-typescript producer build receipt could not be read at ${receiptPath}`,
			{ cause: error }
		);
	}
	if (
		!actual ||
		typeof actual !== 'object' ||
		actual.format !== WASM_TYPESCRIPT_PRODUCER_BUILD_FORMAT
	) {
		throw new Error('wasm-typescript producer build receipt has an unsupported format');
	}

	const expected = await createWasmTypeScriptProducerBuildReceipt({ producerDir, sourceDir });
	if (JSON.stringify(actual.source) !== JSON.stringify(expected.source)) {
		throw new Error(
			'wasm-typescript producer source receipt does not match the current inputs; rebuild the runtime before syncing'
		);
	}
	if (JSON.stringify(actual.toolchain) !== JSON.stringify(expected.toolchain)) {
		throw new Error(
			'wasm-typescript producer toolchain receipt does not match the installed dependencies; rebuild the runtime before syncing'
		);
	}
	if (JSON.stringify(actual.artifact) !== JSON.stringify(expected.artifact)) {
		throw new Error(
			'wasm-typescript producer artifact receipt does not match index.js; rebuild the runtime before syncing'
		);
	}
	return expected;
}
