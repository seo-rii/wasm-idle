#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

import {
	SWIFT_RUNTIME_CONTRACT_FORMAT,
	SWIFT_RUNTIME_CONTRACT_VERSION
} from './runtime-contract.mjs';

export const SWIFT_RUNTIME_MANIFEST_FORMAT = 'wasm-swift-runtime-manifest-v1';
export const EXPECTED_MANIFEST_RUNTIME_CONTRACT = {
	format: SWIFT_RUNTIME_CONTRACT_FORMAT,
	version: SWIFT_RUNTIME_CONTRACT_VERSION
};
export const REQUIRED_RUNTIME_FILES = [
	'runner-worker.js',
	'swiftc.wasm',
	'swiftpm.wasm',
	'sdk.tar.gz'
];
export const RUNNER_WORKER_REQUIRED_INPUT_FIELDS = [
	'run',
	'baseUrl',
	'manifestUrl',
	'code',
	'stdin',
	'args',
	'activePath',
	'workspaceFiles'
];
export const RUNNER_WORKER_REQUIRED_OUTPUT_FIELDS = ['output', 'results', 'error', 'progress'];
export const RUNNER_WORKER_REQUIRED_ASSET_REFERENCES = [
	'swiftc.wasm',
	'swiftpm.wasm',
	'sdk.tar.gz'
];

export function createSwiftRuntimeManifest({ files, swiftVersion, wasmSdkId, fingerprint }) {
	if (!swiftVersion) throw new Error('swiftVersion is required.');
	if (!wasmSdkId) throw new Error('wasmSdkId is required.');
	if (!fingerprint) throw new Error('fingerprint is required.');
	return {
		format: SWIFT_RUNTIME_MANIFEST_FORMAT,
		runtime: 'Swift',
		swiftVersion,
		wasmSdkId,
		runtimeContract: EXPECTED_MANIFEST_RUNTIME_CONTRACT,
		fingerprint,
		files
	};
}

export async function hashFile(filePath) {
	const bytes = await readFile(filePath);
	return hashBytes(bytes);
}

export function hashBytes(bytes) {
	return {
		bytes: bytes.byteLength,
		sha256: createHash('sha256').update(bytes).digest('hex')
	};
}

export async function validateSwiftWasmModuleBytes(bytes, label) {
	const errors = [];
	if (!hasPrefix(bytes, Uint8Array.of(0, 97, 115, 109, 1, 0, 0, 0))) {
		errors.push(`${label} must start with the WebAssembly binary magic header`);
		return errors;
	}
	try {
		await WebAssembly.compile(bytes);
	} catch (error) {
		errors.push(`${label} must be a valid WebAssembly module: ${error.message}`);
	}
	return errors;
}

function decodeAscii(bytes) {
	let text = '';
	for (const byte of bytes) {
		text += byte >= 32 && byte <= 126 ? String.fromCharCode(byte) : '\0';
	}
	return text;
}

export async function validateSwiftCompilerWasmModuleBytes(bytes, label) {
	const errors = await validateSwiftWasmModuleBytes(bytes, label);
	if (errors.length > 0) return errors;
	const ascii = decodeAscii(bytes);
	if (!/\bswift\b|swiftc|swiftpm|SwiftPM|Swift Package/u.test(ascii)) {
		errors.push(`${label} must contain Swift compiler or SwiftPM identity metadata`);
	}
	if (label === 'swiftc.wasm' && !/swiftc|\bswift\b/u.test(ascii)) {
		errors.push('swiftc.wasm must identify a Swift compiler artifact');
	}
	if (label === 'swiftpm.wasm' && !/swiftpm|SwiftPM|Swift Package/u.test(ascii)) {
		errors.push('swiftpm.wasm must identify a SwiftPM artifact');
	}
	return errors;
}

export function validateSwiftSdkArchiveBytes(bytes, label = 'sdk.tar.gz') {
	const errors = [];
	if (hasPrefix(bytes, Uint8Array.of(80, 75, 3, 4))) {
		errors.push(
			`${label} must be a gzip-compressed archive, not a SwiftWasm .artifactbundle.zip file`
		);
		return errors;
	}
	if (!hasPrefix(bytes, Uint8Array.of(31, 139, 8))) {
		errors.push(`${label} must be a gzip-compressed archive`);
		return errors;
	}
	try {
		const decompressed = gunzipSync(bytes);
		if (decompressed.byteLength === 0) {
			errors.push(`${label} must decompress to a non-empty SDK archive`);
		}
	} catch (error) {
		errors.push(`${label} must be a valid gzip archive: ${error.message}`);
	}
	return errors;
}

export async function buildFileEntries(baseDir, files = REQUIRED_RUNTIME_FILES) {
	const entries = [];
	for (const relativePath of files) {
		if (
			typeof relativePath !== 'string' ||
			!relativePath ||
			path.isAbsolute(relativePath) ||
			path.win32.isAbsolute(relativePath) ||
			relativePath.split(/[\\/]+/u).includes('..')
		) {
			throw new Error(
				`runtime file entry path must be a non-empty relative path: ${relativePath}`
			);
		}
		const readErrors = [];
		const fileBytes = await readRuntimeFileBytes(baseDir, relativePath, readErrors);
		if (!fileBytes) {
			throw new Error(
				readErrors.join('\n') || `runtime file entry was not found: ${relativePath}`
			);
		}
		const { bytes, sha256 } = hashBytes(fileBytes);
		entries.push({ path: relativePath, bytes, sha256 });
	}
	return entries;
}

export function fingerprintFileEntries(entries) {
	const hash = createHash('sha256');
	for (const entry of [...entries].sort((a, b) => a.path.localeCompare(b.path))) {
		hash.update(entry.path);
		hash.update('\0');
		hash.update(String(entry.bytes));
		hash.update('\0');
		hash.update(entry.sha256);
		hash.update('\n');
	}
	return hash.digest('hex').slice(0, 16);
}

function hasPrefix(bytes, prefix) {
	if (bytes.byteLength < prefix.length) return false;
	for (const [index, byte] of prefix.entries()) {
		if (bytes[index] !== byte) return false;
	}
	return true;
}

async function readRuntimeFileBytes(baseDir, relativePath, errors) {
	const resolvedBaseDir = path.resolve(baseDir);
	const filePath = path.resolve(resolvedBaseDir, relativePath);
	if (!filePath.startsWith(`${resolvedBaseDir}${path.sep}`)) {
		errors.push(`${relativePath} escapes the Swift runtime bundle directory`);
		return null;
	}
	try {
		return await readFile(filePath);
	} catch {
		if (relativePath.endsWith('.gz')) {
			errors.push(`${relativePath} was not found`);
			return null;
		}
		const compressedFilePath = `${filePath}.gz`;
		if (!compressedFilePath.startsWith(`${resolvedBaseDir}${path.sep}`)) {
			errors.push(`${relativePath}.gz escapes the Swift runtime bundle directory`);
			return null;
		}
		const compressedBytes = await readFile(compressedFilePath).catch(() => null);
		if (!compressedBytes) {
			errors.push(`${relativePath} was not found`);
			return null;
		}
		try {
			return gunzipSync(compressedBytes);
		} catch (error) {
			errors.push(`${relativePath}.gz could not be decompressed: ${error.message}`);
			return null;
		}
	}
}

export async function validateSwiftRuntimeFileSignatures(baseDir) {
	const errors = [];
	for (const wasmFile of ['swiftc.wasm', 'swiftpm.wasm']) {
		const bytes = await readRuntimeFileBytes(baseDir, wasmFile, errors);
		if (bytes) {
			errors.push(...(await validateSwiftCompilerWasmModuleBytes(bytes, wasmFile)));
		}
	}
	const sdkBytes = await readRuntimeFileBytes(baseDir, 'sdk.tar.gz', errors);
	if (sdkBytes) {
		errors.push(...validateSwiftSdkArchiveBytes(sdkBytes));
	}
	return errors;
}

export function validateSwiftRuntimeManifest(manifest) {
	const errors = [];
	if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
		return ['manifest must be an object'];
	}
	if (manifest.format !== SWIFT_RUNTIME_MANIFEST_FORMAT) {
		errors.push(`format must be ${SWIFT_RUNTIME_MANIFEST_FORMAT}`);
	}
	if (manifest.runtime !== 'Swift') errors.push('runtime must be Swift');
	if (
		typeof manifest.swiftVersion !== 'string' ||
		!/^\d+\.\d+(?:\.\d+)?(?:[-+][0-9A-Za-z.-]+)?$/u.test(manifest.swiftVersion)
	) {
		errors.push('swiftVersion must be a Swift release version string such as 6.3.3');
	}
	if (
		typeof manifest.wasmSdkId !== 'string' ||
		!/^[A-Za-z0-9._+-]+_wasm$/u.test(manifest.wasmSdkId)
	) {
		errors.push('wasmSdkId must name a Swift Wasm SDK ending in _wasm');
	}
	if (
		!manifest.runtimeContract ||
		typeof manifest.runtimeContract !== 'object' ||
		Array.isArray(manifest.runtimeContract)
	) {
		errors.push('runtimeContract must describe the Swift browser runtime contract');
	} else {
		if (manifest.runtimeContract.format !== EXPECTED_MANIFEST_RUNTIME_CONTRACT.format) {
			errors.push(
				`runtimeContract.format must be ${EXPECTED_MANIFEST_RUNTIME_CONTRACT.format}`
			);
		}
		if (manifest.runtimeContract.version !== EXPECTED_MANIFEST_RUNTIME_CONTRACT.version) {
			errors.push(
				`runtimeContract.version must be ${EXPECTED_MANIFEST_RUNTIME_CONTRACT.version}`
			);
		}
	}
	if (typeof manifest.fingerprint !== 'string' || !/^[a-f0-9]{16}$/u.test(manifest.fingerprint)) {
		errors.push('fingerprint must be a 16-character lowercase hex string');
	}
	if (!Array.isArray(manifest.files)) {
		errors.push('files must be an array');
		return errors;
	}
	const paths = new Set();
	for (const [index, file] of manifest.files.entries()) {
		if (!file || typeof file !== 'object') {
			errors.push(`files[${index}] must be an object`);
			continue;
		}
		if (
			typeof file.path !== 'string' ||
			!file.path ||
			path.isAbsolute(file.path) ||
			path.win32.isAbsolute(file.path) ||
			file.path.split(/[\\/]+/u).includes('..')
		) {
			errors.push(`files[${index}].path must be a non-empty relative path`);
		} else {
			if (paths.has(file.path)) errors.push(`files[${index}].path duplicates ${file.path}`);
			paths.add(file.path);
		}
		if (!Number.isSafeInteger(file.bytes) || file.bytes <= 0) {
			errors.push(`files[${index}].bytes must be a positive safe integer`);
		}
		if (typeof file.sha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(file.sha256)) {
			errors.push(`files[${index}].sha256 must be a lowercase sha256 hex digest`);
		}
	}
	for (const requiredFile of REQUIRED_RUNTIME_FILES) {
		if (!paths.has(requiredFile)) errors.push(`missing required runtime file ${requiredFile}`);
	}
	return errors;
}

export async function validateSwiftRuntimeManifestFiles(baseDir, manifest) {
	const errors = validateSwiftRuntimeManifest(manifest);
	if (errors.length > 0) return errors;
	errors.push(...(await validateSwiftRuntimeFileSignatures(baseDir)));
	const resolvedBaseDir = path.resolve(baseDir);
	for (const file of manifest.files) {
		const errorCountBeforeRead = errors.length;
		const bytes = await readRuntimeFileBytes(resolvedBaseDir, file.path, errors);
		if (!bytes) {
			if (errors.length === errorCountBeforeRead) {
				errors.push(`${file.path} is listed in the manifest but was not found`);
			}
			continue;
		}
		const actual = hashBytes(bytes);
		if (actual.bytes !== file.bytes) {
			errors.push(
				`${file.path} bytes mismatch: manifest ${file.bytes}, actual ${actual.bytes}`
			);
		}
		if (actual.sha256 !== file.sha256) {
			errors.push(`${file.path} sha256 mismatch`);
		}
	}
	const expectedFingerprint = fingerprintFileEntries(manifest.files);
	if (manifest.fingerprint !== expectedFingerprint) {
		errors.push(
			`fingerprint mismatch: manifest ${manifest.fingerprint}, expected ${expectedFingerprint}`
		);
	}
	return errors;
}

export function validateSwiftRunnerWorkerSource(source) {
	const errors = [];
	if (typeof source !== 'string' || !source.trim()) {
		return ['runner-worker.js must be a non-empty JavaScript file'];
	}
	if (!/\b(?:self\.)?onmessage\s*=|addEventListener\s*\(\s*['"]message['"]/u.test(source)) {
		errors.push('runner-worker.js must handle worker message events');
	}
	for (const field of RUNNER_WORKER_REQUIRED_INPUT_FIELDS) {
		if (!new RegExp(`\\b${field}\\b`, 'u').test(source)) {
			errors.push(`runner-worker.js must read ${field} from run messages`);
		}
	}
	if (!/\bpostMessage\s*\(/u.test(source) && !/\bself\.postMessage\s*\(/u.test(source)) {
		errors.push('runner-worker.js must post worker responses');
	}
	if (!/\bfetch\s*\(\s*manifestUrl\b/u.test(source)) {
		errors.push('runner-worker.js must fetch manifestUrl');
	}
	if (!/\.json\s*\(/u.test(source)) {
		errors.push('runner-worker.js must parse the runtime manifest as JSON');
	}
	for (const field of RUNNER_WORKER_REQUIRED_OUTPUT_FIELDS) {
		if (!new RegExp(`\\b${field}\\b`, 'u').test(source)) {
			errors.push(`runner-worker.js must be able to post ${field} responses`);
		}
	}
	for (const assetReference of RUNNER_WORKER_REQUIRED_ASSET_REFERENCES) {
		if (!source.includes(assetReference)) {
			errors.push(`runner-worker.js must reference ${assetReference}`);
		}
	}
	return errors;
}

async function main(argv = process.argv.slice(2)) {
	const args = [...argv];
	if (args[0] === '--') args.shift();
	if (args.length > 1) {
		throw new Error('validate:manifest accepts at most one manifest path argument');
	}
	if (args[0]?.startsWith('-')) {
		throw new Error(`Unknown option: ${args[0]}`);
	}
	const manifestPath =
		args[0] ||
		path.resolve(
			path.dirname(fileURLToPath(import.meta.url)),
			'..',
			'runtime-manifest.v1.json'
		);
	const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
	const errors = await validateSwiftRuntimeManifestFiles(path.dirname(manifestPath), manifest);
	if (errors.length > 0) {
		for (const error of errors) console.error(error);
		process.exitCode = 1;
		return;
	}
	console.log(`Validated ${manifestPath}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
	try {
		await main();
	} catch (error) {
		console.error(error instanceof Error ? error.message : error);
		process.exitCode = 1;
	}
}
