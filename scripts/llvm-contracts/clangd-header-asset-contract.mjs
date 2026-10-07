// Consumer-owned copy of the wasm-llvm clangd header asset contract.
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';

export const CLANGD_HEADER_ASSET = 'clangd/clangd.headers.json.gz';
const MAX_HEADER_BYTES = 128 * 1024 * 1024;
const SHA256 = /^[0-9a-f]{64}$/u;
/** @param {Uint8Array} bytes */
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
/** @param {unknown} value @returns {value is Record<string, any>} */
const isObject = (value) => !!value && typeof value === 'object' && !Array.isArray(value);

/**
 * @typedef {{ asset: string; format: string; version: string; targetTriple: string; resourceDir: string; bytes: number; sha256: string; uncompressedBytes: number; uncompressedSha256: string }} ClangdHeaderMetadata
 */

/**
 * Check and normalize the separately versioned header descriptor.
 * @param {unknown} value
 * @returns {ClangdHeaderMetadata}
 */
export function validateClangdHeaderMetadata(value) {
	if (
		!isObject(value) ||
		value.asset !== CLANGD_HEADER_ASSET ||
		value.format !== 'clangd-headers-v1' ||
		typeof value.version !== 'string' ||
		!SHA256.test(value.version) ||
		typeof value.sha256 !== 'string' ||
		!SHA256.test(value.sha256) ||
		typeof value.uncompressedSha256 !== 'string' ||
		!SHA256.test(value.uncompressedSha256) ||
		value.version !== value.uncompressedSha256 ||
		typeof value.targetTriple !== 'string' ||
		!/^wasm32-[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(value.targetTriple) ||
		typeof value.resourceDir !== 'string' ||
		!/^\/lib\/clang\/[a-zA-Z0-9_.-]+$/u.test(value.resourceDir) ||
		!Number.isSafeInteger(value.bytes) ||
		value.bytes <= 0 ||
		value.bytes > MAX_HEADER_BYTES ||
		!Number.isSafeInteger(value.uncompressedBytes) ||
		value.uncompressedBytes <= 0 ||
		value.uncompressedBytes > MAX_HEADER_BYTES
	) {
		throw new Error('Invalid clangd header asset metadata');
	}
	return {
		asset: value.asset,
		format: value.format,
		version: value.version,
		targetTriple: value.targetTriple,
		resourceDir: value.resourceDir,
		bytes: value.bytes,
		sha256: value.sha256,
		uncompressedBytes: value.uncompressedBytes,
		uncompressedSha256: value.uncompressedSha256
	};
}

/**
 * Verify both compression identities and every virtual filesystem path before installation.
 * @param {Uint8Array} compressed
 * @param {unknown} descriptor
 */
export function verifyClangdHeaderAsset(compressed, descriptor) {
	const metadata = validateClangdHeaderMetadata(descriptor);
	if (compressed.byteLength !== metadata.bytes || sha256(compressed) !== metadata.sha256)
		throw new Error('clangd header asset does not match its compressed receipt');
	const raw = gunzipSync(compressed, { maxOutputLength: metadata.uncompressedBytes });
	if (
		raw.byteLength !== metadata.uncompressedBytes ||
		sha256(raw) !== metadata.uncompressedSha256
	)
		throw new Error('clangd header asset does not match its uncompressed receipt');
	const headers = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw));
	if (
		!isObject(headers) ||
		headers.schemaVersion !== 1 ||
		typeof headers.version !== 'string' ||
		!headers.version ||
		headers.targetTriple !== metadata.targetTriple ||
		headers.resourceDir !== metadata.resourceDir ||
		!isObject(headers.files)
	)
		throw new Error('Invalid clangd header tree metadata');
	const roots = ['/usr/include/', `${metadata.resourceDir}/include/`];
	for (const [file, contents] of Object.entries(headers.files)) {
		if (
			!roots.some((root) => file.startsWith(root)) ||
			file
				.slice(1)
				.split('/')
				.some((part) => !part || part === '.' || part === '..') ||
			/[\\\x00-\x1f]/u.test(file) ||
			typeof contents !== 'string'
		)
			throw new Error('Invalid clangd header path or contents');
	}
	for (const file of [
		`/usr/include/${metadata.targetTriple}/stdio.h`,
		'/usr/include/c++/v1/vector',
		`${metadata.resourceDir}/include/stddef.h`
	]) {
		if (typeof headers.files[file] !== 'string')
			throw new Error(`Required clangd asset header is missing: ${file}`);
	}
	return headers;
}
