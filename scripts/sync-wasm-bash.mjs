import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const THIS_FILE = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(THIS_FILE), '..');
const DEFAULT_SOURCE_DIR = path.join(REPO_ROOT, 'runtimes', 'wasm-bash', 'dist');
const DEFAULT_SDK_PACKAGE_DIR = path.join(REPO_ROOT, 'node_modules', '@wasmer', 'sdk');
const DEFAULT_TARGET_DIR = path.join(REPO_ROOT, 'static', 'wasm-bash');
const DEFAULT_VERSION_MODULE_PATH = path.join(
	REPO_ROOT,
	'src',
	'lib',
	'playground',
	'wasmBashVersion.ts'
);
const DEFAULT_LOCK_FILE_PATH = path.join(REPO_ROOT, 'scripts', 'wasm-bash-assets.lock.json');
const DEFAULT_PNPM_LOCK_PATH = path.join(REPO_ROOT, 'pnpm-lock.yaml');

export const BASH_MANIFEST_FORMAT = 'wasm-bash-runtime-manifest-v2';
export const BASH_FINGERPRINT_DOMAIN = 'wasm-idle:bash-runtime-manifest:v2';
const BASH_RUNTIME = 'wasmer-bash-wasix';
const LICENSE_EXPRESSION = 'GPL-3.0-or-later AND MIT';
const SOURCE_FILES = ['LICENSE.txt', 'bash.webc', 'runtime-build.json'];
const SDK_SOURCE_FILES = ['LICENSE', 'dist/index.mjs', 'dist/wasmer_js_bg.wasm', 'dist/worker.mjs'];
const PUBLISHED_FILES = [
	'LICENSE.txt',
	'bash.webc.gz',
	'bash.webc.gz.bin',
	'runtime-build.json',
	'runtime-manifest.v1.json',
	'runtime-manifest.v2.json',
	'sdk/LICENSE.txt',
	'sdk/index.mjs',
	'sdk/index.mjs.bin',
	'sdk/runtime-manifest.v1.json',
	'sdk/wasmer_js_bg.wasm.gz',
	'sdk/wasmer_js_bg.wasm.gz.bin',
	'sdk/worker.mjs'
].sort();
const EXPECTED_ROOT_LOCK_KEYS = ['bash', 'schemaVersion', 'wasmerSdk'];
const EXPECTED_BASH_LOCK_KEYS = ['license', 'runtimeBuild'];
const EXPECTED_SDK_LOCK_KEYS = [
	'files',
	'license',
	'npmPackage',
	'npmVersion',
	'packageIntegrity',
	'tarballUrl'
];
const EXPECTED_LICENSE_KEYS = ['path', 'sourceUrl', 'spdx'];
const EXPECTED_RECEIPT_KEYS = ['bytes', 'sha256'];
const EXPECTED_RUNTIME_BUILD_KEYS = [
	'abi',
	'binaryenArchiveSha256',
	'binaryenArchiveUrl',
	'binaryenVersion',
	'buildTarget',
	'license',
	'licenseSha256',
	'limitations',
	'package',
	'packageVersion',
	'postprocessArgs',
	'schemaVersion',
	'sourceArchiveSha256',
	'sourceArchiveUrl',
	'sourceRepository',
	'sourceRevision',
	'sysrootArchiveSha256',
	'sysrootArchiveUrl',
	'sysrootRelease',
	'toolchain',
	'toolchainArchiveSha256',
	'toolchainArchiveUrl',
	'wasmBytes',
	'wasmFeatures',
	'wasmSha256',
	'wasmerArchiveSha256',
	'wasmerArchiveUrl',
	'wasmerVersion',
	'webcBytes',
	'webcSha256'
];
const EXPECTED_BASH_PROVENANCE = Object.freeze({
	schemaVersion: 1,
	package: 'wasmer/bash',
	packageVersion: '1.0.25',
	sourceRepository: 'https://github.com/wasix-org/bash',
	sourceRevision: 'fc8096485478055f4fcf31402004fdd8ff6b72b7',
	sourceArchiveUrl:
		'https://github.com/wasix-org/bash/archive/fc8096485478055f4fcf31402004fdd8ff6b72b7.tar.gz',
	sourceArchiveSha256: '8dc67f0d1dd04fed7f0e2a976b24ca4e915c2ea8216e1742705546780f03db41',
	sysrootRelease: 'v2024-07-08.1',
	sysrootArchiveUrl:
		'https://github.com/wasix-org/wasix-libc/releases/download/v2024-07-08.1/sysroot.tar.gz',
	sysrootArchiveSha256: 'ab48114f09d6092eeab6752e50feaa34da8fe33112e02aadc81ea7e664ec7bd9',
	toolchain: 'WASI SDK 20.0 (LLVM 16.0.0)',
	toolchainArchiveUrl:
		'https://github.com/WebAssembly/wasi-sdk/releases/download/wasi-sdk-20/wasi-sdk-20.0-linux.tar.gz',
	toolchainArchiveSha256: '7030139d495a19fbeccb9449150c2b1531e15d8fb74419872a719a7580aad0f9',
	binaryenVersion: '108',
	binaryenArchiveUrl:
		'https://github.com/WebAssembly/binaryen/releases/download/version_108/binaryen-version_108-x86_64-linux.tar.gz',
	binaryenArchiveSha256: '7bb8a2d97214f40bf34abc31d49b34aa5deab10b25d6d13c5f72cb395cf142fb',
	wasmerVersion: '7.2.0',
	wasmerArchiveUrl:
		'https://github.com/wasmerio/wasmer/releases/download/v7.2.0/wasmer-linux-amd64.tar.gz',
	wasmerArchiveSha256: 'fce71a4b0d504b9925e2461d1368b24cce60001111edb3fa871df8187a8a40f2',
	buildTarget: 'shell',
	postprocessArgs: Object.freeze(['--strip-debug']),
	wasmFeatures: Object.freeze(['threads', 'mutable-globals', 'bulk-memory', 'sign-ext']),
	wasmSha256: '62a39c0b18b34ad15eb54388dfc4c323430cd002cc45a54f121690c9b459d3d0',
	wasmBytes: 1_807_388,
	abi: 'wasix_32v1',
	license: 'GPL-3.0-or-later',
	limitations: Object.freeze([
		'Only Bash builtins are bundled; external coreutils commands are unavailable.'
	])
});
const EXPECTED_SDK = Object.freeze({
	package: '@wasmer/sdk',
	version: '0.9.0',
	integrity:
		'sha512-k/CY19NfeLCjA9ZpX69JAoZKiuMT3hKjDFJYWdRGkCdfig9NtC9Op7Gpg2LeezuuQKd4WaSSq8bpSMdHw1BMgg==',
	tarballUrl: 'https://registry.npmjs.org/@wasmer/sdk/-/sdk-0.9.0.tgz',
	repository: 'https://github.com/wasmerio/wasmer-js',
	packageRepository: 'git+https://github.com/wasmerio/wasmer-js.git'
});
const EXPECTED_BASH_LICENSE = Object.freeze({
	path: 'LICENSE.txt',
	sourceUrl:
		'https://github.com/wasix-org/bash/blob/fc8096485478055f4fcf31402004fdd8ff6b72b7/COPYING',
	spdx: 'GPL-3.0-or-later'
});
const EXPECTED_SDK_LICENSE = Object.freeze({
	path: 'LICENSE',
	sourceUrl: 'https://registry.npmjs.org/@wasmer/sdk/-/sdk-0.9.0.tgz#package/LICENSE',
	spdx: 'MIT'
});

/** @typedef {{ bytes: number; sha256: string }} Receipt */
/** @typedef {{ bytes: number; sha256: string; uncompressedBytes: number; uncompressedSha256: string }} CompressedReceipt */

/**
 * @typedef {object} SyncWasmBashOptions
 * @property {string} [sourceDir]
 * @property {string} [sdkPackageDir]
 * @property {string} [targetDir]
 * @property {string} [versionModulePath]
 * @property {string} [lockFilePath]
 * @property {string} [pnpmLockPath]
 * @property {(sourcePath: string, targetPath: string) => Promise<void>} [renamePath]
 */

/** @param {Uint8Array} bytes */
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

/** @param {unknown} value @returns {value is Record<string, unknown>} */
const isObject = (value) => !!value && typeof value === 'object' && !Array.isArray(value);

/** @param {unknown} value @param {readonly string[]} expectedKeys */
const hasExactKeys = (value, expectedKeys) =>
	isObject(value) &&
	JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expectedKeys].sort());

/** @param {unknown} value @returns {string} */
function canonicalJson(value) {
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
	if (isObject(value)) {
		return `{${Object.keys(value)
			.sort()
			.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
			.join(',')}}`;
	}
	const primitive = JSON.stringify(value);
	if (primitive === undefined) throw new Error('Bash manifest contains a non-JSON value');
	return primitive;
}

/** @param {string} filePath */
async function isRegularFile(filePath) {
	return !!(await lstat(filePath).catch(() => null))?.isFile();
}

/** @param {string} filePath @param {string} label */
async function readJsonFile(filePath, label) {
	if (!(await isRegularFile(filePath))) throw new Error(`${label} must be a regular file`);
	try {
		return JSON.parse(await readFile(filePath, 'utf8'));
	} catch (error) {
		throw new Error(
			`${label} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`
		);
	}
}

/** @param {unknown} value @param {string} label @returns {Receipt} */
function validateReceipt(value, label) {
	if (!isObject(value)) throw new Error(`${label} has an invalid receipt`);
	if (
		!hasExactKeys(value, EXPECTED_RECEIPT_KEYS) ||
		!Number.isSafeInteger(value.bytes) ||
		/** @type {number} */ (value.bytes) <= 0 ||
		typeof value.sha256 !== 'string' ||
		!/^[a-f0-9]{64}$/u.test(value.sha256)
	) {
		throw new Error(`${label} has an invalid receipt`);
	}
	return Object.freeze({
		bytes: /** @type {number} */ (value.bytes),
		sha256: value.sha256
	});
}

/** @param {Record<string, unknown>} runtimeBuild */
function runtimeBuildProvenance(runtimeBuild) {
	const {
		webcBytes: _webcBytes,
		webcSha256: _webcSha256,
		licenseSha256: _licenseSha256,
		...rest
	} = runtimeBuild;
	return rest;
}

/** @param {string} lockFilePath */
async function readInputLock(lockFilePath) {
	const value = await readJsonFile(lockFilePath, 'wasm-bash asset lock');
	if (!hasExactKeys(value, EXPECTED_ROOT_LOCK_KEYS) || value.schemaVersion !== 1) {
		throw new Error('wasm-bash asset lock has an invalid root shape');
	}
	if (
		!hasExactKeys(value.bash, EXPECTED_BASH_LOCK_KEYS) ||
		!hasExactKeys(value.bash.license, EXPECTED_LICENSE_KEYS) ||
		canonicalJson(value.bash.license) !== canonicalJson(EXPECTED_BASH_LICENSE) ||
		!hasExactKeys(value.bash.runtimeBuild, EXPECTED_RUNTIME_BUILD_KEYS) ||
		canonicalJson(runtimeBuildProvenance(value.bash.runtimeBuild)) !==
			canonicalJson(EXPECTED_BASH_PROVENANCE)
	) {
		throw new Error('wasm-bash asset lock has invalid Bash provenance metadata');
	}
	validateReceipt(
		{ bytes: value.bash.runtimeBuild.webcBytes, sha256: value.bash.runtimeBuild.webcSha256 },
		'wasm-bash locked WEBc'
	);
	if (
		typeof value.bash.runtimeBuild.licenseSha256 !== 'string' ||
		!/^[a-f0-9]{64}$/u.test(value.bash.runtimeBuild.licenseSha256)
	) {
		throw new Error('wasm-bash asset lock has an invalid Bash license receipt');
	}
	if (
		!hasExactKeys(value.wasmerSdk, EXPECTED_SDK_LOCK_KEYS) ||
		value.wasmerSdk.npmPackage !== EXPECTED_SDK.package ||
		value.wasmerSdk.npmVersion !== EXPECTED_SDK.version ||
		value.wasmerSdk.packageIntegrity !== EXPECTED_SDK.integrity ||
		value.wasmerSdk.tarballUrl !== EXPECTED_SDK.tarballUrl ||
		!hasExactKeys(value.wasmerSdk.license, EXPECTED_LICENSE_KEYS) ||
		canonicalJson(value.wasmerSdk.license) !== canonicalJson(EXPECTED_SDK_LICENSE) ||
		!isObject(value.wasmerSdk.files) ||
		JSON.stringify(Object.keys(value.wasmerSdk.files).sort()) !==
			JSON.stringify([...SDK_SOURCE_FILES].sort())
	) {
		throw new Error('wasm-bash asset lock has invalid Wasmer SDK provenance metadata');
	}
	/** @type {Map<string, Receipt>} */
	const sdkReceipts = new Map();
	for (const relativePath of SDK_SOURCE_FILES) {
		sdkReceipts.set(
			relativePath,
			validateReceipt(value.wasmerSdk.files[relativePath], `@wasmer/sdk ${relativePath}`)
		);
	}
	return Object.freeze({
		bashLicense: EXPECTED_BASH_LICENSE,
		runtimeBuild: Object.freeze({ ...value.bash.runtimeBuild }),
		sdk: Object.freeze({
			package: EXPECTED_SDK.package,
			version: EXPECTED_SDK.version,
			packageIntegrity: EXPECTED_SDK.integrity,
			tarballUrl: EXPECTED_SDK.tarballUrl,
			repository: EXPECTED_SDK.repository,
			license: EXPECTED_SDK_LICENSE,
			receipts: sdkReceipts
		})
	});
}

/** @param {string} pnpmLockPath @param {string} packageIntegrity */
async function validatePnpmIntegrity(pnpmLockPath, packageIntegrity) {
	if (!(await isRegularFile(pnpmLockPath))) {
		throw new Error(`pnpm lock must be a regular file: ${pnpmLockPath}`);
	}
	const source = await readFile(pnpmLockPath, 'utf8');
	const escapedIntegrity = packageIntegrity.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
	const packageEntry = new RegExp(
		`(?:^|\\n)\\s*'@wasmer/sdk@0\\.9\\.0':\\s*\\n\\s*resolution:\\s*\\{integrity:\\s*${escapedIntegrity}\\}`,
		'u'
	);
	if (!packageEntry.test(source)) {
		throw new Error('pnpm lock does not contain the pinned @wasmer/sdk package integrity');
	}
}

/** @param {string | undefined} sourceDir */
async function resolveSourceDir(sourceDir) {
	if (sourceDir) return path.resolve(sourceDir);
	if (!(await isRegularFile(path.join(DEFAULT_SOURCE_DIR, 'bash.webc')))) {
		const { prepareBashRuntime } =
			await import('../runtimes/wasm-bash/scripts/prepare-runtime.mjs');
		await prepareBashRuntime();
	}
	return DEFAULT_SOURCE_DIR;
}

/** @param {string} sourceDir @param {Awaited<ReturnType<typeof readInputLock>>} inputLock */
async function readBashSource(sourceDir, inputLock) {
	for (const relativePath of SOURCE_FILES) {
		if (!(await isRegularFile(path.join(sourceDir, relativePath)))) {
			throw new Error(`wasm-bash asset ${relativePath} was not found in ${sourceDir}`);
		}
	}
	const [licenseBytes, webcBytes, runtimeBuildBytes] = await Promise.all(
		SOURCE_FILES.map((relativePath) => readFile(path.join(sourceDir, relativePath)))
	);
	let runtimeBuild;
	try {
		runtimeBuild = JSON.parse(runtimeBuildBytes.toString('utf8'));
	} catch {
		throw new Error('wasm-bash runtime-build.json does not match the Bash asset lock');
	}
	if (
		!hasExactKeys(runtimeBuild, EXPECTED_RUNTIME_BUILD_KEYS) ||
		canonicalJson(runtimeBuild) !== canonicalJson(inputLock.runtimeBuild) ||
		runtimeBuild.webcBytes !== webcBytes.byteLength ||
		runtimeBuild.webcSha256 !== sha256(webcBytes) ||
		runtimeBuild.licenseSha256 !== sha256(licenseBytes)
	) {
		throw new Error('wasm-bash runtime-build.json does not match the Bash asset lock');
	}
	return Object.freeze({ licenseBytes, webcBytes, runtimeBuildBytes, runtimeBuild });
}

/** @param {string} sdkPackageDir @param {Awaited<ReturnType<typeof readInputLock>>} inputLock */
async function readSdkSource(sdkPackageDir, inputLock) {
	for (const relativePath of ['package.json', ...SDK_SOURCE_FILES]) {
		if (!(await isRegularFile(path.join(sdkPackageDir, relativePath)))) {
			throw new Error(`@wasmer/sdk ${relativePath} was not found in ${sdkPackageDir}`);
		}
	}
	const packageJson = await readJsonFile(
		path.join(sdkPackageDir, 'package.json'),
		'@wasmer/sdk package.json'
	);
	if (
		packageJson.name !== EXPECTED_SDK.package ||
		packageJson.version !== EXPECTED_SDK.version ||
		packageJson.license !== 'MIT' ||
		!isObject(packageJson.repository) ||
		packageJson.repository.type !== 'git' ||
		packageJson.repository.url !== EXPECTED_SDK.packageRepository
	) {
		throw new Error('@wasmer/sdk package metadata does not match the Bash asset lock');
	}
	/** @type {Map<string, Buffer>} */
	const bytesByPath = new Map();
	for (const relativePath of SDK_SOURCE_FILES) {
		const bytes = await readFile(path.join(sdkPackageDir, relativePath));
		const expectedReceipt = inputLock.sdk.receipts.get(relativePath);
		if (
			!expectedReceipt ||
			expectedReceipt.bytes !== bytes.byteLength ||
			expectedReceipt.sha256 !== sha256(bytes)
		) {
			throw new Error(`@wasmer/sdk ${relativePath} does not match the Bash asset lock`);
		}
		bytesByPath.set(relativePath, bytes);
	}
	return Object.freeze({
		licenseBytes: /** @type {Buffer} */ (bytesByPath.get('LICENSE')),
		javascriptBytes: /** @type {Buffer} */ (bytesByPath.get('dist/index.mjs')),
		wasmBytes: /** @type {Buffer} */ (bytesByPath.get('dist/wasmer_js_bg.wasm')),
		workerBytes: /** @type {Buffer} */ (bytesByPath.get('dist/worker.mjs'))
	});
}

/** @param {Record<string, unknown>} manifest */
export function computeBashRuntimeFingerprint(manifest) {
	const hash = createHash('sha256');
	hash.update(`${BASH_FINGERPRINT_DOMAIN}\n`);
	for (const key of ['format', 'runtime', 'profileId', 'licenseExpression']) {
		hash.update(`${key}\0${manifest[key]}\n`);
	}
	for (const key of ['artifact', 'components', 'build', 'license']) {
		hash.update(`${key}\0${canonicalJson(manifest[key])}\n`);
	}
	const metadata = /** @type {Record<string, unknown>} */ (manifest.metadata);
	hash.update(
		`metadata\0${metadata.path}\0${metadata.mediaType}\0${metadata.size}\0${metadata.sha256}\n`
	);
	const assets = /** @type {Array<Record<string, unknown>>} */ (manifest.assets);
	for (const asset of [...assets].sort((left, right) =>
		String(left.path).localeCompare(String(right.path))
	)) {
		hash.update(`asset\0${asset.path}\0${asset.mediaType}\0${asset.size}\0${asset.sha256}\n`);
	}
	const storage = /** @type {Array<Record<string, unknown>>} */ (manifest.storage);
	for (const asset of [...storage].sort((left, right) =>
		String(left.path).localeCompare(String(right.path))
	)) {
		hash.update(
			`storage\0${asset.path}\0${asset.logicalPath}\0${asset.encoding}\0${asset.size}\0${asset.sha256}\n`
		);
	}
	return hash.digest('hex');
}

/** @param {string} sourceDir */
async function computeLegacyFingerprint(sourceDir) {
	const hash = createHash('sha256');
	for (const relativePath of [...SOURCE_FILES].sort()) {
		hash.update(relativePath);
		hash.update('\0');
		hash.update(await readFile(path.join(sourceDir, relativePath)));
		hash.update('\n');
	}
	return hash.digest('hex').slice(0, 16);
}

/** @param {string} targetDir @param {string} currentDir */
async function collectRelativeFiles(targetDir, currentDir = targetDir) {
	/** @type {string[]} */
	const files = [];
	for (const entry of await readdir(currentDir, { withFileTypes: true })) {
		const entryPath = path.join(currentDir, entry.name);
		if (entry.isDirectory()) files.push(...(await collectRelativeFiles(targetDir, entryPath)));
		else if (entry.isFile()) {
			files.push(path.relative(targetDir, entryPath).split(path.sep).join('/'));
		} else {
			throw new Error(`wasm-bash generated tree contains a non-file entry: ${entryPath}`);
		}
	}
	return files.sort();
}

/** @param {string} filePath @param {unknown} value */
async function writeJson(filePath, value) {
	await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

/** @param {CompressedReceipt} receipt */
const compressedReceiptSource = (receipt) => `Object.freeze({
\t\tbytes: ${receipt.bytes},
\t\tsha256: '${receipt.sha256}',
\t\tuncompressedBytes: ${receipt.uncompressedBytes},
\t\tuncompressedSha256: '${receipt.uncompressedSha256}'
\t})`;

/** @param {Receipt} receipt */
const identityReceiptSource = (receipt) => `Object.freeze({
\t\tbytes: ${receipt.bytes},
\t\tsha256: '${receipt.sha256}'
\t})`;

/** @param {Record<string, unknown>} profile */
function buildVersionSource(profile) {
	const manifestReceipt = /** @type {Receipt} */ (profile.manifestReceipt);
	const sdkJavaScriptReceipt = /** @type {Receipt} */ (profile.sdkJavaScriptReceipt);
	const wasmerWasmReceipt = /** @type {CompressedReceipt} */ (profile.wasmerWasmReceipt);
	const webcReceipt = /** @type {CompressedReceipt} */ (profile.webcReceipt);
	return `export const WASM_BASH_RUNTIME_PROFILE = Object.freeze({
\tprofileId: '${profile.profileId}',
\tbashPackageVersion: '${profile.bashPackageVersion}',
\tbashSourceRevision: '${profile.bashSourceRevision}',
\twasmerSdkVersion: '${profile.wasmerSdkVersion}',
\twasmerSdkPackageIntegrity:
\t\t'${profile.wasmerSdkPackageIntegrity}',
\tmanifestFingerprint: '${profile.manifestFingerprint}',
\tmanifestReceipt: ${identityReceiptSource(manifestReceipt)},
\tsdkJavaScriptReceipt: ${identityReceiptSource(sdkJavaScriptReceipt)},
\twasmerWasmReceipt: ${compressedReceiptSource(wasmerWasmReceipt)},
\twebcReceipt: ${compressedReceiptSource(webcReceipt)}
});

export const WASM_BASH_RUNTIME_BUNDLE = Object.freeze({
\tprofile: WASM_BASH_RUNTIME_PROFILE
});

export const WASM_BASH_ASSET_VERSION = WASM_BASH_RUNTIME_PROFILE.manifestFingerprint;

export const WASM_BASH_WEBC_RECEIPT = Object.freeze({
\tbytes: WASM_BASH_RUNTIME_PROFILE.webcReceipt.uncompressedBytes,
\tsha256: WASM_BASH_RUNTIME_PROFILE.webcReceipt.uncompressedSha256
});
`;
}

/**
 * @param {string} nextTarget
 * @param {Awaited<ReturnType<typeof readInputLock>>} inputLock
 * @param {Awaited<ReturnType<typeof readBashSource>>} bashSource
 * @param {Awaited<ReturnType<typeof readSdkSource>>} sdkSource
 * @param {string} legacyFingerprint
 */
async function buildGeneration(nextTarget, inputLock, bashSource, sdkSource, legacyFingerprint) {
	await mkdir(path.join(nextTarget, 'sdk'), { recursive: true });
	const compressedWebc = gzipSync(bashSource.webcBytes, { level: 9 });
	const compressedWasm = gzipSync(sdkSource.wasmBytes, { level: 9 });
	await Promise.all([
		writeFile(path.join(nextTarget, 'LICENSE.txt'), bashSource.licenseBytes),
		writeFile(path.join(nextTarget, 'runtime-build.json'), bashSource.runtimeBuildBytes),
		writeFile(path.join(nextTarget, 'bash.webc.gz'), compressedWebc),
		writeFile(path.join(nextTarget, 'bash.webc.gz.bin'), compressedWebc),
		writeFile(path.join(nextTarget, 'sdk', 'LICENSE.txt'), sdkSource.licenseBytes),
		writeFile(path.join(nextTarget, 'sdk', 'index.mjs'), sdkSource.javascriptBytes),
		writeFile(path.join(nextTarget, 'sdk', 'index.mjs.bin'), sdkSource.javascriptBytes),
		writeFile(path.join(nextTarget, 'sdk', 'wasmer_js_bg.wasm.gz'), compressedWasm),
		writeFile(path.join(nextTarget, 'sdk', 'wasmer_js_bg.wasm.gz.bin'), compressedWasm),
		writeFile(path.join(nextTarget, 'sdk', 'worker.mjs'), sdkSource.workerBytes)
	]);
	await writeJson(path.join(nextTarget, 'runtime-manifest.v1.json'), {
		format: 'wasm-bash-runtime-manifest-v1',
		runtime: 'GNU Bash',
		package: bashSource.runtimeBuild.package,
		packageVersion: bashSource.runtimeBuild.packageVersion,
		sourceRevision: bashSource.runtimeBuild.sourceRevision,
		fingerprint: legacyFingerprint,
		files: SOURCE_FILES
	});
	await writeJson(path.join(nextTarget, 'sdk', 'runtime-manifest.v1.json'), {
		formatVersion: 1,
		runtimeModule: 'index.mjs',
		packages: { [inputLock.sdk.package]: inputLock.sdk.version },
		files: [
			{ path: 'index.mjs', ...inputLock.sdk.receipts.get('dist/index.mjs') },
			{ path: 'LICENSE.txt', ...inputLock.sdk.receipts.get('LICENSE') },
			{ path: 'wasmer_js_bg.wasm', ...inputLock.sdk.receipts.get('dist/wasmer_js_bg.wasm') },
			{ path: 'worker.mjs', ...inputLock.sdk.receipts.get('dist/worker.mjs') }
		]
	});

	const profileId = `bash-${bashSource.runtimeBuild.packageVersion}-wasmer-sdk-${inputLock.sdk.version}-${bashSource.runtimeBuild.sourceRevision.slice(0, 8)}`;
	const sdkJavaScriptReceipt = Object.freeze({
		bytes: sdkSource.javascriptBytes.byteLength,
		sha256: sha256(sdkSource.javascriptBytes)
	});
	const wasmerWasmReceipt = Object.freeze({
		bytes: compressedWasm.byteLength,
		sha256: sha256(compressedWasm),
		uncompressedBytes: sdkSource.wasmBytes.byteLength,
		uncompressedSha256: sha256(sdkSource.wasmBytes)
	});
	const webcReceipt = Object.freeze({
		bytes: compressedWebc.byteLength,
		sha256: sha256(compressedWebc),
		uncompressedBytes: bashSource.webcBytes.byteLength,
		uncompressedSha256: sha256(bashSource.webcBytes)
	});
	const manifestWithoutFingerprint = {
		format: BASH_MANIFEST_FORMAT,
		runtime: BASH_RUNTIME,
		profileId,
		licenseExpression: LICENSE_EXPRESSION,
		artifact: {
			kind: 'wasmer-package-webc',
			package: bashSource.runtimeBuild.package,
			packageVersion: bashSource.runtimeBuild.packageVersion,
			repository: bashSource.runtimeBuild.sourceRepository,
			revision: bashSource.runtimeBuild.sourceRevision,
			sourceArchiveUrl: bashSource.runtimeBuild.sourceArchiveUrl,
			sourceArchiveSha256: bashSource.runtimeBuild.sourceArchiveSha256,
			verifiedBuildInput: true
		},
		components: {
			bash: {
				version: bashSource.runtimeBuild.packageVersion,
				repository: bashSource.runtimeBuild.sourceRepository,
				revision: bashSource.runtimeBuild.sourceRevision,
				verifiedBuildInput: true,
				evidence: 'runtime-build.json and locked source receipts'
			},
			wasmerSdk: {
				version: inputLock.sdk.version,
				package: inputLock.sdk.package,
				packageIntegrity: inputLock.sdk.packageIntegrity,
				repository: inputLock.sdk.repository,
				verifiedBuildInput: true,
				evidence: 'pnpm package integrity and locked npm source receipts'
			}
		},
		build: {
			target: bashSource.runtimeBuild.buildTarget,
			abi: bashSource.runtimeBuild.abi,
			toolchain: {
				name: bashSource.runtimeBuild.toolchain,
				archiveUrl: bashSource.runtimeBuild.toolchainArchiveUrl,
				archiveSha256: bashSource.runtimeBuild.toolchainArchiveSha256
			},
			sysroot: {
				release: bashSource.runtimeBuild.sysrootRelease,
				archiveUrl: bashSource.runtimeBuild.sysrootArchiveUrl,
				archiveSha256: bashSource.runtimeBuild.sysrootArchiveSha256
			},
			binaryen: {
				version: bashSource.runtimeBuild.binaryenVersion,
				archiveUrl: bashSource.runtimeBuild.binaryenArchiveUrl,
				archiveSha256: bashSource.runtimeBuild.binaryenArchiveSha256
			},
			packager: {
				name: 'wasmer',
				version: bashSource.runtimeBuild.wasmerVersion,
				archiveUrl: bashSource.runtimeBuild.wasmerArchiveUrl,
				archiveSha256: bashSource.runtimeBuild.wasmerArchiveSha256
			},
			postprocessArgs: bashSource.runtimeBuild.postprocessArgs,
			wasmFeatures: bashSource.runtimeBuild.wasmFeatures
		},
		license: {
			bash: {
				path: 'LICENSE.txt',
				sourceUrl: inputLock.bashLicense.sourceUrl,
				spdx: inputLock.bashLicense.spdx,
				size: bashSource.licenseBytes.byteLength,
				sha256: sha256(bashSource.licenseBytes)
			},
			wasmerSdk: {
				path: 'sdk/LICENSE.txt',
				sourceUrl: inputLock.sdk.license.sourceUrl,
				spdx: inputLock.sdk.license.spdx,
				size: sdkSource.licenseBytes.byteLength,
				sha256: sha256(sdkSource.licenseBytes)
			}
		},
		metadata: {
			path: 'runtime-build.json',
			mediaType: 'application/json',
			size: bashSource.runtimeBuildBytes.byteLength,
			sha256: sha256(bashSource.runtimeBuildBytes)
		},
		assets: [
			{
				path: 'sdk/index.mjs',
				mediaType: 'text/javascript',
				size: sdkSource.javascriptBytes.byteLength,
				sha256: sdkJavaScriptReceipt.sha256
			},
			{
				path: 'sdk/wasmer_js_bg.wasm',
				mediaType: 'application/wasm',
				size: sdkSource.wasmBytes.byteLength,
				sha256: wasmerWasmReceipt.uncompressedSha256
			},
			{
				path: 'bash.webc',
				mediaType: 'application/octet-stream',
				size: bashSource.webcBytes.byteLength,
				sha256: webcReceipt.uncompressedSha256
			}
		],
		storage: [
			{
				path: 'sdk/index.mjs.bin',
				logicalPath: 'sdk/index.mjs',
				encoding: 'identity',
				size: sdkSource.javascriptBytes.byteLength,
				sha256: sdkJavaScriptReceipt.sha256
			},
			{
				path: 'sdk/wasmer_js_bg.wasm.gz.bin',
				logicalPath: 'sdk/wasmer_js_bg.wasm',
				encoding: 'gzip',
				size: compressedWasm.byteLength,
				sha256: wasmerWasmReceipt.sha256
			},
			{
				path: 'bash.webc.gz.bin',
				logicalPath: 'bash.webc',
				encoding: 'gzip',
				size: compressedWebc.byteLength,
				sha256: webcReceipt.sha256
			}
		]
	};
	const manifest = {
		...manifestWithoutFingerprint,
		fingerprint: computeBashRuntimeFingerprint(manifestWithoutFingerprint)
	};
	const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
	await writeFile(path.join(nextTarget, 'runtime-manifest.v2.json'), manifestBytes);
	const runtimeProfile = Object.freeze({
		profileId,
		bashPackageVersion: bashSource.runtimeBuild.packageVersion,
		bashSourceRevision: bashSource.runtimeBuild.sourceRevision,
		wasmerSdkVersion: inputLock.sdk.version,
		wasmerSdkPackageIntegrity: inputLock.sdk.packageIntegrity,
		manifestFingerprint: manifest.fingerprint,
		manifestReceipt: Object.freeze({
			bytes: manifestBytes.byteLength,
			sha256: sha256(manifestBytes)
		}),
		sdkJavaScriptReceipt,
		wasmerWasmReceipt,
		webcReceipt
	});
	return Object.freeze({ manifest, manifestBytes, runtimeProfile });
}

/** @param {string} nextTarget @param {Record<string, unknown>} manifest */
async function validateGeneration(nextTarget, manifest) {
	const files = await collectRelativeFiles(nextTarget);
	if (JSON.stringify(files) !== JSON.stringify(PUBLISHED_FILES)) {
		throw new Error(
			`wasm-bash generated tree has an unexpected file graph: ${files.join(', ')}`
		);
	}
	for (const [canonicalPath, legacyPath] of [
		['sdk/index.mjs.bin', 'sdk/index.mjs'],
		['sdk/wasmer_js_bg.wasm.gz.bin', 'sdk/wasmer_js_bg.wasm.gz'],
		['bash.webc.gz.bin', 'bash.webc.gz']
	]) {
		const [canonicalBytes, legacyBytes] = await Promise.all([
			readFile(path.join(nextTarget, canonicalPath)),
			readFile(path.join(nextTarget, legacyPath))
		]);
		if (!canonicalBytes.equals(legacyBytes)) {
			throw new Error(`wasm-bash legacy alias ${legacyPath} differs from ${canonicalPath}`);
		}
	}
	const parsedManifest = JSON.parse(
		await readFile(path.join(nextTarget, 'runtime-manifest.v2.json'), 'utf8')
	);
	if (
		canonicalJson(parsedManifest) !== canonicalJson(manifest) ||
		parsedManifest.fingerprint !== computeBashRuntimeFingerprint(parsedManifest)
	) {
		throw new Error('wasm-bash generated manifest failed fingerprint validation');
	}
}

/**
 * @param {{ nextTarget: string; targetDir: string; nextVersion: string; versionModulePath: string; token: string; renamePath: (sourcePath: string, targetPath: string) => Promise<void> }} input
 */
async function publishGeneration({
	nextTarget,
	targetDir,
	nextVersion,
	versionModulePath,
	token,
	renamePath
}) {
	const previousTarget = `${targetDir}.previous-${token}`;
	const previousVersion = `${versionModulePath}.previous-${token}`;
	let targetBackedUp = false;
	let versionBackedUp = false;
	let targetPublished = false;
	let versionPublished = false;
	try {
		if (await lstat(targetDir).catch(() => null)) {
			await renamePath(targetDir, previousTarget);
			targetBackedUp = true;
		}
		if (await lstat(versionModulePath).catch(() => null)) {
			await renamePath(versionModulePath, previousVersion);
			versionBackedUp = true;
		}
		await renamePath(nextTarget, targetDir);
		targetPublished = true;
		await renamePath(nextVersion, versionModulePath);
		versionPublished = true;
	} catch (error) {
		if (versionPublished) await rm(versionModulePath, { recursive: true, force: true });
		if (targetPublished) await rm(targetDir, { recursive: true, force: true });
		if (versionBackedUp) await rename(previousVersion, versionModulePath).catch(() => {});
		if (targetBackedUp) await rename(previousTarget, targetDir).catch(() => {});
		throw error;
	} finally {
		await rm(nextTarget, { recursive: true, force: true });
		await rm(nextVersion, { recursive: true, force: true });
	}
	await rm(previousTarget, { recursive: true, force: true });
	await rm(previousVersion, { recursive: true, force: true });
}

/** @param {string} parent @param {string} candidate */
function containsPath(parent, candidate) {
	const relative = path.relative(parent, candidate);
	return (
		relative === '' ||
		(!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`))
	);
}

/** @param {string} left @param {string} right */
const pathsOverlap = (left, right) => containsPath(left, right) || containsPath(right, left);

/** @param {SyncWasmBashOptions} [options] */
export async function syncWasmBashAssets({
	sourceDir,
	sdkPackageDir = DEFAULT_SDK_PACKAGE_DIR,
	targetDir = DEFAULT_TARGET_DIR,
	versionModulePath = DEFAULT_VERSION_MODULE_PATH,
	lockFilePath = DEFAULT_LOCK_FILE_PATH,
	pnpmLockPath = DEFAULT_PNPM_LOCK_PATH,
	renamePath = rename
} = {}) {
	const resolvedSourceDir = await resolveSourceDir(sourceDir);
	const resolvedSdkPackageDir = path.resolve(sdkPackageDir);
	const resolvedTargetDir = path.resolve(targetDir);
	const resolvedVersionModulePath = path.resolve(versionModulePath);
	if (
		pathsOverlap(resolvedSourceDir, resolvedTargetDir) ||
		pathsOverlap(resolvedSdkPackageDir, resolvedTargetDir) ||
		containsPath(resolvedTargetDir, resolvedVersionModulePath)
	) {
		throw new Error(
			'wasm-bash source, target, SDK, and generated module paths must not overlap'
		);
	}
	const inputLock = await readInputLock(path.resolve(lockFilePath));
	await validatePnpmIntegrity(path.resolve(pnpmLockPath), inputLock.sdk.packageIntegrity);
	const [bashSource, sdkSource, legacyFingerprint] = await Promise.all([
		readBashSource(resolvedSourceDir, inputLock),
		readSdkSource(resolvedSdkPackageDir, inputLock),
		computeLegacyFingerprint(resolvedSourceDir)
	]);
	const token = `${process.pid}-${randomUUID()}`;
	const nextTarget = `${resolvedTargetDir}.next-${token}`;
	const nextVersion = `${resolvedVersionModulePath}.next-${token}`;
	await rm(nextTarget, { recursive: true, force: true });
	await rm(nextVersion, { recursive: true, force: true });
	await mkdir(path.dirname(resolvedTargetDir), { recursive: true });
	await mkdir(path.dirname(resolvedVersionModulePath), { recursive: true });
	try {
		const generation = await buildGeneration(
			nextTarget,
			inputLock,
			bashSource,
			sdkSource,
			legacyFingerprint
		);
		await validateGeneration(nextTarget, generation.manifest);
		await writeFile(nextVersion, buildVersionSource(generation.runtimeProfile), 'utf8');
		await publishGeneration({
			nextTarget,
			targetDir: resolvedTargetDir,
			nextVersion,
			versionModulePath: resolvedVersionModulePath,
			token,
			renamePath
		});
		return Object.freeze({
			sourceDir: resolvedSourceDir,
			sdkPackageDir: resolvedSdkPackageDir,
			targetDir: resolvedTargetDir,
			versionModulePath: resolvedVersionModulePath,
			fingerprint: generation.runtimeProfile.manifestFingerprint,
			legacyFingerprint,
			runtimeProfile: generation.runtimeProfile,
			webcReceipt: Object.freeze({
				bytes: generation.runtimeProfile.webcReceipt.uncompressedBytes,
				sha256: generation.runtimeProfile.webcReceipt.uncompressedSha256
			})
		});
	} catch (error) {
		await rm(nextTarget, { recursive: true, force: true });
		await rm(nextVersion, { recursive: true, force: true });
		throw error;
	}
}

if (process.argv[1] && path.resolve(process.argv[1]) === THIS_FILE) {
	const [, , sourceDirArg, targetDirArg] = process.argv;
	const result = await syncWasmBashAssets({
		sourceDir: sourceDirArg ? path.resolve(sourceDirArg) : undefined,
		targetDir: targetDirArg ? path.resolve(targetDirArg) : DEFAULT_TARGET_DIR
	});
	console.log(`Synced wasm-bash from ${result.sourceDir} to ${result.targetDir}`);
}
