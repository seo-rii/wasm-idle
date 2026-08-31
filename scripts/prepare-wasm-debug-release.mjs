import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { DEFAULT_WASM_DEBUG_VERSION_MODULE_PATH, syncWasmDebugDist } from './sync-wasm-debug.mjs';

const THIS_FILE = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(THIS_FILE), '..');
const SHA256 = /^[0-9a-f]{64}$/u;
const PRODUCER_REVISION = /^[0-9a-f]{40}$/u;

export const DEFAULT_WASM_DEBUG_RELEASE_PROFILE_PATH = path.join(
	REPO_ROOT,
	'scripts/wasm-debug-release.v2.json'
);
export const DEFAULT_WASM_DEBUG_STATIC_DIR = path.join(REPO_ROOT, 'static');
export const MAX_WASM_DEBUG_MANIFEST_BYTES = 64 * 1024;
export const MAX_WASM_DEBUG_RUNTIME_BYTES = 55_000_000;

function sha256(bytes) {
	return createHash('sha256').update(bytes).digest('hex');
}

function abortReason(signal) {
	return signal?.reason ?? new DOMException('The operation was aborted', 'AbortError');
}

function throwIfAborted(signal) {
	if (signal?.aborted) throw abortReason(signal);
}

async function cancelResponse(response, reason) {
	try {
		await response.body?.cancel(reason);
	} catch {
		// Preserve the release validation failure that initiated cancellation.
	}
}

function parseContentLength(response, label) {
	const value = response.headers.get('content-length');
	if (value === null) return undefined;
	if (!/^(?:0|[1-9][0-9]*)$/u.test(value)) {
		throw new Error(`${label} returned an invalid Content-Length`);
	}
	const bytes = Number(value);
	if (!Number.isSafeInteger(bytes)) {
		throw new Error(`${label} returned an invalid Content-Length`);
	}
	return bytes;
}

async function fetchBoundedBytes({ url, fetchImpl, limit, label, expectedBytes, signal }) {
	throwIfAborted(signal);
	const response = await fetchImpl(url, { cache: 'no-store', signal });
	if (!response?.ok) {
		const error = new Error(
			`Unable to download ${label} (${response?.status ?? 'invalid response'}) from ${url}`
		);
		if (response) await cancelResponse(response, error);
		throw error;
	}

	let declaredBytes;
	try {
		declaredBytes = parseContentLength(response, label);
	} catch (error) {
		await cancelResponse(response, error);
		throw error;
	}
	if (declaredBytes !== undefined && declaredBytes > limit) {
		const error = new Error(`${label} exceeds its ${limit} byte limit`);
		await cancelResponse(response, error);
		throw error;
	}
	if (!response.body) {
		throw new Error(`${label} response body is unavailable`);
	}

	const reader = response.body.getReader();
	const chunks = [];
	let receivedBytes = 0;
	let finished = false;
	let cancelled = false;
	const cancelOnAbort = () => {
		cancelled = true;
		void reader.cancel(abortReason(signal)).catch(() => undefined);
	};
	signal?.addEventListener('abort', cancelOnAbort, { once: true });
	try {
		while (true) {
			throwIfAborted(signal);
			const { done, value } = await reader.read();
			throwIfAborted(signal);
			if (done) {
				finished = true;
				break;
			}
			if (!(value instanceof Uint8Array)) {
				throw new TypeError(`${label} response body yielded invalid bytes`);
			}
			if (value.byteLength > limit - receivedBytes) {
				const error = new Error(`${label} exceeds its ${limit} byte limit`);
				cancelled = true;
				try {
					await reader.cancel(error);
				} catch {
					// Preserve the byte-limit failure.
				}
				throw error;
			}
			const owned = Uint8Array.from(value);
			chunks.push(owned);
			receivedBytes += owned.byteLength;
		}
	} catch (error) {
		if (!finished && !cancelled) {
			cancelled = true;
			try {
				await reader.cancel(error);
			} catch {
				// Preserve the download or lifecycle failure.
			}
		}
		throw error;
	} finally {
		signal?.removeEventListener('abort', cancelOnAbort);
		reader.releaseLock();
	}

	if (expectedBytes !== undefined && receivedBytes !== expectedBytes) {
		throw new Error(
			`${label} size mismatch: expected ${expectedBytes} bytes, received ${receivedBytes}`
		);
	}
	const bytes = new Uint8Array(receivedBytes);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return bytes;
}

function assertSafeAssetPath(value, label) {
	if (typeof value !== 'string' || !value) {
		throw new Error(`wasm debug release has an unsafe ${label} asset path`);
	}
	const segments = value.split('/');
	let decodedSegments;
	try {
		decodedSegments = segments.map((segment) => decodeURIComponent(segment));
	} catch {
		throw new Error(`wasm debug release has an unsafe ${label} asset path`);
	}
	if (
		path.posix.isAbsolute(value) ||
		value.includes('\\') ||
		value.includes('\0') ||
		value.includes(':') ||
		value.includes('?') ||
		value.includes('#') ||
		segments.some((segment) => !segment || segment === '.' || segment === '..') ||
		decodedSegments.some(
			(segment) =>
				!segment ||
				segment === '.' ||
				segment === '..' ||
				segment.includes('/') ||
				segment.includes('\\') ||
				segment.includes('\0')
		)
	) {
		throw new Error(`wasm debug release has an unsafe ${label} asset path`);
	}
	return value;
}

function extractAssetEntries(manifest) {
	if (
		!manifest ||
		typeof manifest !== 'object' ||
		Array.isArray(manifest) ||
		manifest.manifestVersion !== 2 ||
		!manifest.debugger ||
		typeof manifest.debugger !== 'object' ||
		Array.isArray(manifest.debugger)
	) {
		throw new Error('wasm debug release manifest has an invalid root contract');
	}
	const entries = [];
	for (const [runtimeKey, runtimeLabel] of [
		['lldb', 'LLDB'],
		['targetRuntime', 'WAMR']
	]) {
		const runtime = manifest.debugger[runtimeKey];
		if (!runtime || typeof runtime !== 'object' || Array.isArray(runtime)) {
			throw new Error(`wasm debug release manifest has an invalid ${runtimeLabel} contract`);
		}
		for (const kind of ['js', 'wasm', 'worker']) {
			const assetPath = assertSafeAssetPath(runtime[kind], `${runtimeLabel} ${kind}`);
			const expectedSha256 = runtime[`${kind}Sha256`];
			if (typeof expectedSha256 !== 'string' || !SHA256.test(expectedSha256)) {
				throw new Error(
					`wasm debug release manifest has an invalid ${runtimeLabel} ${kind} SHA-256`
				);
			}
			entries.push({ path: assetPath, sha256: expectedSha256 });
		}
	}
	const paths = new Set(entries.map((entry) => entry.path));
	if (entries.length !== 6 || paths.size !== entries.length) {
		throw new Error('wasm debug release manifest must contain six distinct runtime assets');
	}
	return entries;
}

function resolveContained(root, relativePath) {
	const resolved = path.resolve(root, relativePath);
	const relative = path.relative(root, resolved);
	if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
		throw new Error(`wasm debug release asset escapes its temporary bundle: ${relativePath}`);
	}
	return resolved;
}

async function loadReleaseProfile(profilePath) {
	const value = JSON.parse(await readFile(profilePath, 'utf8'));
	if (!value || typeof value !== 'object' || Array.isArray(value) || value.schemaVersion !== 1) {
		throw new Error('wasm debug release profile has an invalid schema version');
	}
	if (
		typeof value.producerRevision !== 'string' ||
		!PRODUCER_REVISION.test(value.producerRevision)
	) {
		throw new Error('wasm debug release profile must pin a 40-character producer revision');
	}
	const receipt = value.manifestReceipt;
	if (
		!receipt ||
		typeof receipt !== 'object' ||
		Array.isArray(receipt) ||
		!Number.isSafeInteger(receipt.bytes) ||
		receipt.bytes <= 0 ||
		receipt.bytes > MAX_WASM_DEBUG_MANIFEST_BYTES ||
		typeof receipt.sha256 !== 'string' ||
		!SHA256.test(receipt.sha256)
	) {
		throw new Error('wasm debug release profile has an invalid manifest receipt');
	}
	return {
		producerRevision: value.producerRevision,
		manifestReceipt: { bytes: receipt.bytes, sha256: receipt.sha256 }
	};
}

export async function prepareWasmDebugRelease({
	fetchImpl = globalThis.fetch,
	profilePath = DEFAULT_WASM_DEBUG_RELEASE_PROFILE_PATH,
	staticDir = DEFAULT_WASM_DEBUG_STATIC_DIR,
	versionModulePath = DEFAULT_WASM_DEBUG_VERSION_MODULE_PATH,
	signal
} = {}) {
	if (typeof fetchImpl !== 'function') {
		throw new TypeError('wasm debug release preparation requires fetch');
	}
	throwIfAborted(signal);
	const profile = await loadReleaseProfile(path.resolve(profilePath));
	const releaseBaseUrl = `https://raw.githubusercontent.com/seo-rii/wasm-llvm/${profile.producerRevision}/artifacts/runtime-source/`;
	const manifestUrl = new URL('runtime-manifest.v2.json', releaseBaseUrl).href;
	const manifestBytes = await fetchBoundedBytes({
		url: manifestUrl,
		fetchImpl,
		limit: MAX_WASM_DEBUG_MANIFEST_BYTES,
		label: 'wasm debug release manifest',
		expectedBytes: profile.manifestReceipt.bytes,
		signal
	});
	if (sha256(manifestBytes) !== profile.manifestReceipt.sha256) {
		throw new Error('wasm debug release manifest failed SHA-256 validation');
	}
	let manifest;
	try {
		manifest = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(manifestBytes));
	} catch (error) {
		throw new Error('wasm debug release manifest is not valid UTF-8 JSON', { cause: error });
	}
	const assets = extractAssetEntries(manifest);
	const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'wasm-debug-release-'));
	const sourceDir = path.join(temporaryRoot, 'runtime-source');
	let totalAssetBytes = 0;
	try {
		await mkdir(sourceDir, { recursive: true });
		await writeFile(path.join(sourceDir, 'runtime-manifest.v2.json'), manifestBytes);
		for (const asset of assets) {
			throwIfAborted(signal);
			const remainingBytes = MAX_WASM_DEBUG_RUNTIME_BYTES - totalAssetBytes;
			const bytes = await fetchBoundedBytes({
				url: new URL(asset.path, releaseBaseUrl).href,
				fetchImpl,
				limit: remainingBytes,
				label: `wasm debug aggregate runtime asset ${asset.path}`,
				signal
			});
			if (sha256(bytes) !== asset.sha256) {
				throw new Error(`wasm debug runtime asset ${asset.path} failed SHA-256 validation`);
			}
			totalAssetBytes += bytes.byteLength;
			const destination = resolveContained(sourceDir, asset.path);
			await mkdir(path.dirname(destination), { recursive: true });
			await writeFile(destination, bytes);
		}
		throwIfAborted(signal);
		await syncWasmDebugDist({
			sourceDir,
			staticDir,
			versionModulePath
		});
		return {
			producerRevision: profile.producerRevision,
			releaseBaseUrl,
			assetCount: assets.length,
			totalAssetBytes
		};
	} finally {
		await rm(temporaryRoot, { recursive: true, force: true });
	}
}

if (process.argv[1] && path.resolve(process.argv[1]) === THIS_FILE) {
	if (process.argv.length !== 2) {
		throw new Error('Usage: node scripts/prepare-wasm-debug-release.mjs');
	}
	const result = await prepareWasmDebugRelease();
	console.log(
		`Prepared ${result.assetCount} LLDB/WAMR assets (${result.totalAssetBytes} bytes) from wasm-llvm ${result.producerRevision}.`
	);
}
