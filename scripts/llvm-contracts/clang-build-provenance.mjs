// Consumer adaptation of wasm-llvm 14ea5ec's Clang build receipt contract.
// Producer verification owns source trees and recipe files; the consumer preserves
// that evidence and binds it to the exact raw bytes installed after repackaging.
import { createHash } from 'node:crypto';
import { LEGACY_CLANG_RELEASE } from './clang-legacy-release.mjs';

export const CLANG_BUILD_RECEIPT = 'clang-build-receipt.json';
const MAX_RECEIPT_BYTES = 1024 * 1024;
const MAX_INPUT_BYTES = 512 * 1024 * 1024;
const SHA256 = /^[a-f0-9]{64}$/u;
const COMMIT = /^[a-f0-9]{40}$/u;
/** @param {unknown} value */
const digest = (value) => typeof value === 'string' && SHA256.test(value);
/** @param {unknown} value */
const commit = (value) => typeof value === 'string' && COMMIT.test(value);
const RECIPE_FILES = [
	'build-toolchain.mjs',
	'build-provenance.mjs',
	'build-memfs.mjs',
	'prepare-clangd-headers.mjs',
	'sysroot-pruning.mjs',
	'gcc-compat.mjs',
	'hot-path-launcher.sh'
];
const TOOL_NAMES = [
	'cmake',
	'ninja',
	'tar',
	'wasiClang',
	'wasiClangxx',
	'wasiAr',
	'wasiRanlib',
	'wasiLld',
	'nativeC',
	'nativeCxx',
	'llvmTablegen',
	'clangTablegen',
	'emsdkClang',
	'wasmOpt',
	'emccDriver'
];
/** @param {Uint8Array | string} bytes */
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
/** @param {unknown} value @returns {value is Record<string, any>} */
const isObject = (value) => !!value && typeof value === 'object' && !Array.isArray(value);
/** @param {any} value */
const identity = (value) =>
	isObject(value) && Number.isSafeInteger(value.bytes) && value.bytes > 0 && digest(value.sha256);
/** @param {string} message @returns {never} */
const fail = (message) => {
	throw new Error(`Clang build provenance: ${message}`);
};

/**
 * Historical, pinned bundles predate the receipt and retain that status. An
 * explicit unverified declaration cannot enter the normal synchronization path.
 * @param {Record<string, any>} toolchain
 */
export function validateClangBuildProvenance(toolchain) {
	const provenance = toolchain.buildProvenance;
	if (provenance === undefined) return undefined;
	if (!isObject(provenance) || provenance.status !== 'verified')
		fail('sync requires verified declared build provenance');
	if (
		provenance.receipt !== CLANG_BUILD_RECEIPT ||
		!identity(provenance) ||
		provenance.bytes > MAX_RECEIPT_BYTES
	)
		fail('invalid build receipt metadata');
	return provenance;
}

/**
 * Validate evidence before using its declared lengths as decompression bounds.
 * @param {Record<string, any>} toolchain
 * @param {Uint8Array} bytes
 * @returns {Record<string, any>}
 */
export function parseClangBuildReceipt(toolchain, bytes) {
	const provenance = validateClangBuildProvenance(toolchain);
	if (!provenance || bytes.byteLength !== provenance.bytes || sha256(bytes) !== provenance.sha256)
		fail('build receipt does not match its file identity');
	const receipt = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
	if (
		!isObject(receipt) ||
		receipt.schemaVersion !== 1 ||
		receipt.producerId !== 'wasm-llvm/clang-browser' ||
		receipt.kind !== 'clang-build-receipt' ||
		receipt.buildMode !== 'fresh-output-directory'
	)
		fail('unsupported receipt schema, producer, or build mode');
	if (
		toolchain.producer?.id !== receipt.producerId ||
		!digest(receipt.manifestSha256) ||
		receipt.manifestSha256 !== toolchain.producer?.manifestSha256
	)
		fail('producer manifest identity mismatch');
	for (const field of ['llvmVersion', 'llvmCommit', 'wasiSdkVersion', 'emsdkVersion']) {
		if (
			typeof toolchain[field] !== 'string' ||
			!toolchain[field] ||
			toolchain[field] !== receipt.buildOptions?.[field]
		)
			fail(`${field} differs from toolchain metadata`);
	}
	for (const name of ['llvm', 'emsdk']) {
		const source = receipt.sources?.[name];
		if (
			!isObject(source) ||
			!commit(source.commit) ||
			!commit(source.tree) ||
			!digest(source.diffSha256) ||
			source.commit !== receipt.buildOptions?.[`${name}Commit`]
		)
			fail(`incomplete ${name} source identity`);
	}
	if (
		receipt.sources.llvm.repository !== 'https://github.com/llvm/llvm-project' ||
		receipt.sources.emsdk.repository !== 'https://github.com/emscripten-core/emsdk'
	)
		fail('unexpected source repository');
	const patches = receipt.sources.llvm.patches;
	if (
		!Array.isArray(patches) ||
		patches.length !== 4 ||
		patches.some((patch) => !isObject(patch) || !digest(patch.sha256)) ||
		patches[0].repository !== receipt.buildOptions.yowaspWasiPatchRepo ||
		patches[0].commit !== receipt.buildOptions.yowaspWasiPatchCommit ||
		!commit(patches[0].commit) ||
		patches[3].path !== toolchain.clangd?.patch ||
		patches[3].sha256 !== toolchain.clangd?.patchSha256
	)
		fail('patch identity does not match the toolchain');
	for (const name of ['wasiSdk', 'emsdkUpstream']) {
		const tree = receipt.installedToolchains?.[name];
		if (!identity(tree) || !Number.isSafeInteger(tree.entries) || tree.entries <= 0)
			fail(`missing ${name} installed tree identity`);
	}
	for (const name of TOOL_NAMES) {
		if (!identity(receipt.tools?.[name])) fail(`missing ${name} executable identity`);
	}
	if (
		!Array.isArray(receipt.recipe?.files) ||
		receipt.recipe.files.length !== RECIPE_FILES.length ||
		receipt.recipe.sha256 !== sha256(JSON.stringify(receipt.recipe.files)) ||
		receipt.recipe.files.some(
			/** @param {any} entry @param {number} index */
			(entry, index) => entry?.path !== `scripts/${RECIPE_FILES[index]}` || !identity(entry)
		)
	)
		fail('invalid recipe identity');
	const names = ['clang', 'lld', 'memfs', 'memfsReceipt', 'sysroot', 'clangdJs', 'clangdWasm'];
	if (receipt.buildOptions.clangdSeparateHeaders === 'ON') names.push('clangdHeaders');
	else if (receipt.buildOptions.clangdSeparateHeaders !== 'OFF')
		fail('invalid separate header option');
	if (
		(receipt.buildOptions.clangdSeparateHeaders === 'ON') !==
			(toolchain.clangd?.headers !== undefined) ||
		!isObject(receipt.inputs) ||
		Object.keys(receipt.inputs).length !== names.length ||
		names.some(
			(name) =>
				!identity(receipt.inputs[name]) || receipt.inputs[name].bytes > MAX_INPUT_BYTES
		)
	)
		fail('incomplete or excessive build input identities');
	return receipt;
}

/**
 * @param {Record<string, any>} receipt
 * @param {Record<string, Uint8Array>} inputs
 */
export function verifyClangBuildReceiptInputs(receipt, inputs) {
	for (const [name, expected] of Object.entries(receipt.inputs)) {
		const bytes = inputs[name];
		if (!bytes || bytes.byteLength !== expected.bytes || sha256(bytes) !== expected.sha256)
			fail(`${name} input identity mismatch`);
	}
}

/** @param {any} value @returns {any} */
function canonicalObject(value) {
	if (Array.isArray(value)) return value.map(canonicalObject);
	if (isObject(value))
		return Object.fromEntries(
			Object.keys(value)
				.sort()
				.map((key) => [key, canonicalObject(value[key])])
		);
	return value;
}

/**
 * An absent receipt is allowed only for the exact historical compiler already
 * reviewed and installed here. Removing new evidence cannot create an exception.
 * @param {Record<string, any>} toolchain
 * @param {Record<string, Uint8Array>} inputs
 */
export function verifyLegacyClangRelease(toolchain, inputs) {
	const selected = Object.fromEntries(
		LEGACY_CLANG_RELEASE.metadataFields.map((field) => [field, toolchain[field]])
	);
	if (sha256(JSON.stringify(canonicalObject(selected))) !== LEGACY_CLANG_RELEASE.metadataSha256)
		fail('missing build receipt outside the pinned historical release');
	verifyClangBuildReceiptInputs({ inputs: LEGACY_CLANG_RELEASE.inputs }, inputs);
}
