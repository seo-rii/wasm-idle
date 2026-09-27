import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

import { verifyWasmTypeScriptProducerBuildReceipt } from '../runtimes/wasm-typescript/scripts/provenance.mjs';

const THIS_FILE = fileURLToPath(import.meta.url);
const THIS_DIR = path.dirname(THIS_FILE);
const REPO_ROOT = path.resolve(THIS_DIR, '..');
const DEFAULT_SOURCE_DIR = path.resolve(REPO_ROOT, 'runtimes', 'wasm-typescript', 'dist');
const DEFAULT_TARGET_DIR = path.resolve(REPO_ROOT, 'static', 'wasm-typescript');
const DEFAULT_VERSION_MODULE_PATH = path.resolve(
	REPO_ROOT,
	'src',
	'lib',
	'playground',
	'wasmTypeScriptVersion.ts'
);
const ENTRY_MODULE = 'index.js';
const JAVASCRIPT_MODULE = 'javascript.js';
const RUNTIME_BUILD_RECEIPT = 'runtime-build.json';

/** @typedef {{ readonly bytes: number; readonly sha256: string }} TypeScriptModuleReceipt */

/** @param {string} sourcePath */
function shouldSkipCopy(sourcePath) {
	return (
		path.basename(sourcePath) === RUNTIME_BUILD_RECEIPT ||
		sourcePath.endsWith('.d.ts') ||
		sourcePath.endsWith('.tsbuildinfo')
	);
}

/** @param {string} sourceDir @param {string} targetDir @returns {Promise<void>} */
async function copyDirectory(sourceDir, targetDir) {
	const entries = await readdir(sourceDir, { withFileTypes: true });
	for (const entry of entries) {
		const sourcePath = path.join(sourceDir, entry.name);
		if (shouldSkipCopy(sourcePath)) continue;
		const targetPath = path.join(targetDir, entry.name);
		if (entry.isDirectory()) {
			await mkdir(targetPath, { recursive: true });
			await copyDirectory(sourcePath, targetPath);
			continue;
		}
		await cp(sourcePath, targetPath);
	}
}

/** @param {string} rootDir @returns {Promise<string[]>} */
async function listFiles(rootDir) {
	const entries = await readdir(rootDir, { withFileTypes: true });
	/** @type {string[]} */
	const files = [];
	for (const entry of entries) {
		const entryPath = path.join(rootDir, entry.name);
		if (shouldSkipCopy(entryPath)) continue;
		if (entry.isDirectory()) {
			files.push(...(await listFiles(entryPath)));
			continue;
		}
		if (entry.isFile()) files.push(entryPath);
	}
	return files.sort();
}

/** @param {string} sourceDir @returns {Promise<string>} */
async function computeBundleFingerprint(sourceDir) {
	const hash = createHash('sha256');
	for (const filePath of await listFiles(sourceDir)) {
		hash.update(path.relative(sourceDir, filePath));
		hash.update('\0');
		hash.update(await readFile(filePath));
		hash.update('\n');
	}
	return hash.digest('hex').slice(0, 16);
}

/** @param {string} modulePath @returns {Promise<Readonly<TypeScriptModuleReceipt>>} */
async function computeModuleReceipt(modulePath) {
	const bytes = await readFile(modulePath);
	return Object.freeze({
		bytes: bytes.byteLength,
		sha256: createHash('sha256').update(bytes).digest('hex')
	});
}

/**
 * @param {string} fingerprint
 * @param {Readonly<TypeScriptModuleReceipt>} moduleReceipt
 * @param {Record<string, unknown>} producer
 * @param {Readonly<TypeScriptModuleReceipt> | undefined} javascriptReceipt
 */
function runtimeBuildReceipt(fingerprint, moduleReceipt, producer, javascriptReceipt) {
	return {
		format: 'wasm-typescript-runtime-build-v2',
		fingerprint,
		producer,
		assets: {
			[ENTRY_MODULE]: moduleReceipt,
			...(javascriptReceipt ? { [JAVASCRIPT_MODULE]: javascriptReceipt } : {})
		}
	};
}

/**
 * @param {string} targetDir
 * @param {string} fingerprint
 * @param {Readonly<TypeScriptModuleReceipt>} moduleReceipt
 * @param {Record<string, unknown>} producer
 * @param {Readonly<TypeScriptModuleReceipt> | undefined} javascriptReceipt
 * @returns {Promise<string>}
 */
async function writeRuntimeBuildReceipt(
	targetDir,
	fingerprint,
	moduleReceipt,
	producer,
	javascriptReceipt
) {
	const receiptPath = path.join(targetDir, RUNTIME_BUILD_RECEIPT);
	const receipt = runtimeBuildReceipt(fingerprint, moduleReceipt, producer, javascriptReceipt);
	await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
	return receiptPath;
}

/**
 * @param {string} fingerprint
 * @param {Readonly<TypeScriptModuleReceipt>} moduleReceipt
 * @param {Readonly<TypeScriptModuleReceipt> | undefined} javascriptReceipt
 */
function renderVersionModule(fingerprint, moduleReceipt, javascriptReceipt) {
	/** @param {string} name @param {Readonly<TypeScriptModuleReceipt>} receipt */
	const renderReceipt = (name, receipt) => `export const ${name} = Object.freeze({
\tbytes: ${receipt.bytes},
\tsha256: '${receipt.sha256}'
});
`;
	return (
		`export const WASM_TYPESCRIPT_ASSET_VERSION = '${fingerprint}';\n\n` +
		renderReceipt('WASM_TYPESCRIPT_MODULE_RECEIPT', moduleReceipt) +
		(javascriptReceipt
			? '\n' + renderReceipt('WASM_JAVASCRIPT_MODULE_RECEIPT', javascriptReceipt)
			: '')
	);
}

/**
 * @param {string} versionModulePath
 * @param {string} fingerprint
 * @param {Readonly<TypeScriptModuleReceipt>} moduleReceipt
 * @param {Readonly<TypeScriptModuleReceipt> | undefined} javascriptReceipt
 * @returns {Promise<void>}
 */
async function writeVersionModule(
	versionModulePath,
	fingerprint,
	moduleReceipt,
	javascriptReceipt
) {
	await mkdir(path.dirname(versionModulePath), { recursive: true });
	const moduleSource = renderVersionModule(fingerprint, moduleReceipt, javascriptReceipt);
	const current = await readFile(versionModulePath, 'utf8').catch(() => '');
	if (current === moduleSource) return;
	await writeFile(versionModulePath, moduleSource, 'utf8');
}

/** @param {string} targetDir @param {string} [entryModule] */
async function readInstalledEntryModule(targetDir, entryModule = ENTRY_MODULE) {
	const modulePath = path.join(targetDir, entryModule);
	const compressedModulePath = `${modulePath}.gz`;
	const [moduleBytes, compressedModuleBytes] = await Promise.all([
		readFile(modulePath).catch(() => null),
		readFile(compressedModulePath).catch(() => null)
	]);
	if (moduleBytes && compressedModuleBytes) {
		throw new Error(
			`wasm-typescript target contains both ${entryModule} and ${entryModule}.gz`
		);
	}
	if (moduleBytes) return moduleBytes;
	if (!compressedModuleBytes) {
		throw new Error(
			`wasm-typescript target entry was not found at ${modulePath} or ${compressedModulePath}.`
		);
	}
	try {
		return gunzipSync(compressedModuleBytes);
	} catch (error) {
		throw new Error(
			`wasm-typescript target entry is not valid gzip at ${compressedModulePath}`,
			{
				cause: error
			}
		);
	}
}

export async function verifyWasmTypeScriptDist({
	sourceDir = DEFAULT_SOURCE_DIR,
	targetDir = DEFAULT_TARGET_DIR,
	versionModulePath = DEFAULT_VERSION_MODULE_PATH,
	producerDir = path.dirname(path.resolve(sourceDir))
} = {}) {
	const producer = await verifyWasmTypeScriptProducerBuildReceipt({
		producerDir,
		sourceDir
	});
	const sourceModuleReceipt = await computeModuleReceipt(path.join(sourceDir, ENTRY_MODULE));
	const installedModuleReceipt = await computeModuleReceiptFromBytes(
		await readInstalledEntryModule(targetDir)
	);
	if (JSON.stringify(installedModuleReceipt) !== JSON.stringify(sourceModuleReceipt)) {
		throw new Error(
			'wasm-typescript checked-in module does not match the current producer output; sync the runtime assets'
		);
	}

	const javascriptReceipt = producer.additionalArtifacts?.[JAVASCRIPT_MODULE];
	if (javascriptReceipt) {
		const installed = computeModuleReceiptFromBytes(
			await readInstalledEntryModule(targetDir, JAVASCRIPT_MODULE)
		);
		if (JSON.stringify(installed) !== JSON.stringify(javascriptReceipt)) {
			throw new Error(
				'wasm-typescript checked-in JavaScript module does not match the current producer output'
			);
		}
	}
	const fingerprint = await computeBundleFingerprint(sourceDir);
	const expectedReceipt = runtimeBuildReceipt(
		fingerprint,
		sourceModuleReceipt,
		producer,
		javascriptReceipt
	);
	let actualReceipt;
	try {
		actualReceipt = JSON.parse(
			await readFile(path.join(targetDir, RUNTIME_BUILD_RECEIPT), 'utf8')
		);
	} catch (error) {
		throw new Error('wasm-typescript checked-in runtime receipt could not be read', {
			cause: error
		});
	}
	if (JSON.stringify(actualReceipt) !== JSON.stringify(expectedReceipt)) {
		throw new Error(
			'wasm-typescript checked-in runtime receipt does not match the current producer output'
		);
	}
	const expectedVersionModule = renderVersionModule(
		fingerprint,
		sourceModuleReceipt,
		javascriptReceipt
	);
	const actualVersionModule = await readFile(versionModulePath, 'utf8').catch(() => '');
	if (actualVersionModule !== expectedVersionModule) {
		throw new Error(
			'wasm-typescript checked-in version module does not match the current producer output'
		);
	}
	return {
		sourceDir,
		targetDir,
		fingerprint,
		moduleReceipt: sourceModuleReceipt,
		producer,
		versionModulePath
	};
}

/** @param {Uint8Array} bytes @returns {Readonly<TypeScriptModuleReceipt>} */
function computeModuleReceiptFromBytes(bytes) {
	return Object.freeze({
		bytes: bytes.byteLength,
		sha256: createHash('sha256').update(bytes).digest('hex')
	});
}

export async function syncWasmTypeScriptDist({
	sourceDir = DEFAULT_SOURCE_DIR,
	targetDir = DEFAULT_TARGET_DIR,
	versionModulePath = DEFAULT_VERSION_MODULE_PATH,
	producerDir = path.dirname(path.resolve(sourceDir))
} = {}) {
	const sourceStats = await stat(sourceDir).catch(() => null);
	if (!sourceStats?.isDirectory()) {
		throw new Error(
			`wasm-typescript dist directory was not found at ${sourceDir}. Build wasm-typescript first with "pnpm --dir runtimes/wasm-typescript build".`
		);
	}
	const entryModulePath = path.join(sourceDir, ENTRY_MODULE);
	const entryModuleStats = await stat(entryModulePath).catch(() => null);
	if (!entryModuleStats?.isFile()) {
		throw new Error(`wasm-typescript dist entry was not found at ${entryModulePath}.`);
	}
	const producer = await verifyWasmTypeScriptProducerBuildReceipt({
		producerDir,
		sourceDir
	});

	await rm(targetDir, { recursive: true, force: true });
	await mkdir(targetDir, { recursive: true });
	await copyDirectory(sourceDir, targetDir);
	const fingerprint = await computeBundleFingerprint(targetDir);
	const moduleReceipt = await computeModuleReceipt(path.join(targetDir, ENTRY_MODULE));
	const javascriptReceipt = producer.additionalArtifacts?.[JAVASCRIPT_MODULE];
	const receiptPath = await writeRuntimeBuildReceipt(
		targetDir,
		fingerprint,
		moduleReceipt,
		producer,
		javascriptReceipt
	);
	await writeVersionModule(versionModulePath, fingerprint, moduleReceipt, javascriptReceipt);
	return {
		sourceDir,
		targetDir,
		fingerprint,
		moduleReceipt,
		producer,
		receiptPath,
		versionModulePath
	};
}

if (process.argv[1] && path.resolve(process.argv[1]) === THIS_FILE) {
	const [, , commandOrSourceDir, targetDirArg] = process.argv;
	if (commandOrSourceDir === '--verify' || commandOrSourceDir === '--check') {
		const result = await verifyWasmTypeScriptDist();
		console.log(
			`Verified checked-in wasm-typescript ${result.fingerprint} against ${result.sourceDir}`
		);
		process.exit(0);
	}
	const sourceDirArg = commandOrSourceDir;
	const { sourceDir, targetDir } = await syncWasmTypeScriptDist({
		sourceDir: sourceDirArg || DEFAULT_SOURCE_DIR,
		targetDir: targetDirArg || DEFAULT_TARGET_DIR
	});

	console.log(`Synced wasm-typescript from ${sourceDir} to ${targetDir}`);
}
