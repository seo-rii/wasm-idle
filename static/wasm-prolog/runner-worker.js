const encoder = new TextEncoder();
const fatalDecoder = new TextDecoder('utf-8', { fatal: true });
const manifestFormat = 'wasm-prolog-runtime-manifest-v2';
const fingerprintDomain = 'wasm-idle:prolog-runtime-manifest:v2';
const hardMaxAssetBytes = 32 * 1024 * 1024;
const maxManifestBytes = 64 * 1024;
const expectedPackage = Object.freeze({
	integrity:
		'sha512-tP3bSRaMboFRWGD5cfBAGIzu2HH80yqRG+i/YL8BEgQ7xasvJAycwgx0DW16vqqRhUHyFOOPbzX4aXuy9s+b1g==',
	name: 'swipl-wasm',
	repository: 'https://github.com/SWI-Prolog/npm-swipl-wasm.git',
	revision: '18fa003833dd4fb2531195063291687255038372',
	tarball: 'https://registry.npmjs.org/swipl-wasm/-/swipl-wasm-8.0.1.tgz',
	version: '8.0.1'
});
const expectedToolchain = Object.freeze({
	emsdkRevision: 'd223ae73c6998296e3ab27cf81dc2c2c9fd383de',
	emsdkVersion: '6.0.0',
	pcre2Revision: 'f454e231fe5006dd7ff8f4693fd2b8eb94333429',
	pcre2Version: '10.47',
	swiplRevision: '6be143dbd030cc9ea621cde719a37f8385575453',
	swiplVersion: '10.1.9',
	zlibVersion: '1.3.2'
});
const expectedAssets = Object.freeze({
	'swipl-web.data': Object.freeze({ mediaType: 'application/octet-stream' }),
	'swipl-web.js': Object.freeze({ mediaType: 'text/javascript' }),
	'swipl-web.wasm': Object.freeze({ mediaType: 'application/wasm' })
});
const expectedStorage = Object.freeze({
	'swipl-web.data.gz': Object.freeze({ logicalPath: 'swipl-web.data', encoding: 'gzip' }),
	'swipl-web.js': Object.freeze({ logicalPath: 'swipl-web.js', encoding: 'identity' }),
	'swipl-web.wasm.gz': Object.freeze({ logicalPath: 'swipl-web.wasm', encoding: 'gzip' })
});

let verifiedRuntimePromise = null;
let verifiedRuntimeIdentity = '';

function requireHttpUrl(value, label) {
	let url;
	try {
		url = new URL(value);
	} catch {
		throw new Error(`${label} URL is invalid.`);
	}
	if (url.protocol !== 'http:' && url.protocol !== 'https:') {
		throw new Error(`${label} URL must use HTTP(S).`);
	}
	if (url.username || url.password || url.hash) {
		throw new Error(`${label} URL must not include credentials or a fragment.`);
	}
	return url;
}

function assetUrl(baseUrl, path, fingerprint) {
	const base = requireHttpUrl(baseUrl, 'SWI-Prolog runtime base');
	const url = new URL(path, base);
	if (fingerprint) url.searchParams.set('v', fingerprint);
	return url.href;
}

function cancelResponseBody(response, reason) {
	try {
		void Promise.resolve(response.body?.cancel(reason)).catch(() => undefined);
	} catch {
		// Preserve the trust-boundary failure that caused cancellation.
	}
}

async function fetchBoundedBytes(
	urlValue,
	label,
	maxBytes,
	expectedBytes,
	cache,
	alternateExpectedBytes
) {
	if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
		throw new Error(`${label} byte limit is invalid.`);
	}
	const expectedByteSizes = [];
	for (const candidate of [expectedBytes, alternateExpectedBytes]) {
		if (candidate === undefined) continue;
		if (!Number.isSafeInteger(candidate) || candidate <= 0 || candidate > maxBytes) {
			throw new Error(`${label} expected byte size is invalid.`);
		}
		if (!expectedByteSizes.includes(candidate)) expectedByteSizes.push(candidate);
	}
	const maximumExpectedBytes = expectedByteSizes.length
		? Math.max(...expectedByteSizes)
		: undefined;
	const requestUrl = requireHttpUrl(urlValue, label);
	const response = await fetch(requestUrl.href, {
		...(cache ? { cache } : {}),
		credentials: 'omit',
		redirect: 'error',
		referrerPolicy: 'no-referrer'
	});
	try {
		if (!response.url) throw new Error(`${label} response URL is missing.`);
		let responseUrl;
		try {
			responseUrl = new URL(response.url);
		} catch {
			throw new Error(`${label} response URL is invalid.`);
		}
		if (responseUrl.href !== requestUrl.href) {
			throw new Error(`${label} response URL does not match the requested asset.`);
		}
		if (!response.ok)
			throw new Error(`${label} request failed with status ${response.status}.`);
		const contentLength = response.headers.get('content-length');
		if (contentLength !== null) {
			const normalized = contentLength.trim();
			const parsed = Number(normalized);
			if (!/^\d+$/u.test(normalized) || !Number.isSafeInteger(parsed)) {
				throw new Error(`${label} has an invalid Content-Length.`);
			}
			if (expectedByteSizes.length && !expectedByteSizes.includes(parsed)) {
				throw new Error(`${label} Content-Length does not match its receipt.`);
			}
			if (parsed > maxBytes) throw new Error(`${label} exceeds its byte limit.`);
		}
	} catch (error) {
		cancelResponseBody(response, error);
		throw error;
	}
	if (!response.body) {
		const error = new Error(`${label} response does not provide a byte stream.`);
		cancelResponseBody(response, error);
		throw error;
	}

	let reader;
	try {
		reader = response.body.getReader();
	} catch (error) {
		cancelResponseBody(response, error);
		throw error;
	}
	const output = maximumExpectedBytes === undefined ? null : new Uint8Array(maximumExpectedBytes);
	const chunks = output ? null : [];
	let loaded = 0;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			if (!(value instanceof Uint8Array))
				throw new Error(`${label} returned an invalid byte stream.`);
			const nextLoaded = loaded + value.byteLength;
			if (maximumExpectedBytes !== undefined && nextLoaded > maximumExpectedBytes) {
				throw new Error(`${label} exceeds its receipt size.`);
			}
			if (!Number.isSafeInteger(nextLoaded) || nextLoaded > maxBytes) {
				throw new Error(`${label} exceeds its byte limit.`);
			}
			if (output) output.set(value, loaded);
			else chunks.push(value.slice());
			loaded = nextLoaded;
		}
		if (expectedByteSizes.length && !expectedByteSizes.includes(loaded)) {
			throw new Error(`${label} is truncated or has an unexpected decoded size.`);
		}
	} catch (error) {
		try {
			void Promise.resolve(reader.cancel(error)).catch(() => undefined);
		} catch {
			// Preserve the stream or quota failure.
		}
		throw error;
	} finally {
		try {
			reader.releaseLock();
		} catch {
			// Preserve the primary load result.
		}
	}
	if (output) return loaded === output.byteLength ? output : output.slice(0, loaded);
	const bytes = new Uint8Array(loaded);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return bytes;
}

async function sha256Hex(bytes) {
	if (!globalThis.crypto?.subtle?.digest) {
		throw new Error('SWI-Prolog runtime integrity verification requires Web Crypto.');
	}
	const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes));
	return [...digest].map((value) => value.toString(16).padStart(2, '0')).join('');
}

async function computeFingerprint(
	profileId,
	packageMetadata,
	toolchain,
	license,
	metadata,
	assets,
	storage
) {
	let canonical = `${fingerprintDomain}\nformat\0${manifestFormat}\nruntime\0swipl-wasm\nprofileId\0${profileId}\n`;
	for (const [name, value] of Object.entries(packageMetadata).sort(([left], [right]) =>
		left < right ? -1 : left > right ? 1 : 0
	)) {
		canonical += `package\0${name}\0${value}\n`;
	}
	for (const [name, value] of Object.entries(toolchain).sort(([left], [right]) =>
		left < right ? -1 : left > right ? 1 : 0
	)) {
		canonical += `toolchain\0${name}\0${value}\n`;
	}
	canonical += `license\0${license.path}\0${license.spdx}\0${license.size}\0${license.sha256}\n`;
	canonical += `metadata\0${metadata.path}\0${metadata.mediaType}\0${metadata.size}\0${metadata.sha256}\n`;
	for (const asset of [...assets].sort((left, right) =>
		left.path < right.path ? -1 : left.path > right.path ? 1 : 0
	)) {
		canonical += `asset\0${asset.path}\0${asset.mediaType}\0${asset.size}\0${asset.sha256}\n`;
	}
	for (const asset of [...storage].sort((left, right) =>
		left.path < right.path ? -1 : left.path > right.path ? 1 : 0
	)) {
		canonical += `storage\0${asset.path}\0${asset.logicalPath}\0${asset.encoding}\0${asset.size}\0${asset.sha256}\n`;
	}
	return await sha256Hex(encoder.encode(canonical));
}

function normalizeReceipt(candidate, expected, maxAssetBytes, label) {
	if (
		!candidate ||
		typeof candidate !== 'object' ||
		Array.isArray(candidate) ||
		candidate.path !== expected.path ||
		candidate.mediaType !== expected.mediaType ||
		!Number.isSafeInteger(candidate.size) ||
		candidate.size <= 0 ||
		candidate.size > maxAssetBytes ||
		typeof candidate.sha256 !== 'string' ||
		!/^[a-f0-9]{64}$/u.test(candidate.sha256)
	) {
		throw new Error(`${label} receipt is invalid or exceeds its byte limit.`);
	}
	return {
		path: expected.path,
		mediaType: expected.mediaType,
		size: candidate.size,
		sha256: candidate.sha256
	};
}

function normalizeStorageReceipt(candidate, expected, maxAssetBytes) {
	if (
		!candidate ||
		typeof candidate !== 'object' ||
		Array.isArray(candidate) ||
		candidate.path !== expected.path ||
		candidate.logicalPath !== expected.logicalPath ||
		candidate.encoding !== expected.encoding ||
		!Number.isSafeInteger(candidate.size) ||
		candidate.size <= 0 ||
		candidate.size > maxAssetBytes ||
		typeof candidate.sha256 !== 'string' ||
		!/^[a-f0-9]{64}$/u.test(candidate.sha256)
	) {
		throw new Error(`SWI-Prolog runtime storage receipt is invalid for ${expected.path}.`);
	}
	return {
		path: expected.path,
		logicalPath: expected.logicalPath,
		encoding: expected.encoding,
		size: candidate.size,
		sha256: candidate.sha256
	};
}

function normalizeProvenanceObject(candidate, expected, label) {
	if (
		!candidate ||
		typeof candidate !== 'object' ||
		Array.isArray(candidate) ||
		JSON.stringify(Object.keys(candidate).sort()) !==
			JSON.stringify(Object.keys(expected).sort()) ||
		Object.entries(expected).some(([name, value]) => candidate[name] !== value)
	) {
		throw new Error(`SWI-Prolog runtime ${label} metadata is invalid.`);
	}
	return { ...candidate };
}

async function normalizeManifest(value, expectedFingerprint, maxAssetBytes) {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error('SWI-Prolog runtime manifest must be an object.');
	}
	if (value.format !== manifestFormat || value.runtime !== 'swipl-wasm') {
		throw new Error('SWI-Prolog runtime manifest format is unsupported.');
	}
	if (
		typeof value.profileId !== 'string' ||
		!/^swipl-wasm-[A-Za-z0-9._+-]+$/u.test(value.profileId) ||
		typeof expectedFingerprint !== 'string' ||
		!/^[a-f0-9]{64}$/u.test(expectedFingerprint)
	) {
		throw new Error('SWI-Prolog runtime profile or expected fingerprint is invalid.');
	}
	if (value.fingerprint !== expectedFingerprint) {
		throw new Error(
			'SWI-Prolog runtime manifest fingerprint does not match the pinned runtime.'
		);
	}
	const packageMetadata = normalizeProvenanceObject(value.package, expectedPackage, 'package');
	const toolchain = normalizeProvenanceObject(value.toolchain, expectedToolchain, 'toolchain');
	if (
		!value.license ||
		typeof value.license !== 'object' ||
		Array.isArray(value.license) ||
		value.license.path !== 'LICENSE.txt' ||
		value.license.spdx !== 'BSD-2-Clause' ||
		!Number.isSafeInteger(value.license.size) ||
		value.license.size <= 0 ||
		value.license.size > maxAssetBytes ||
		typeof value.license.sha256 !== 'string' ||
		!/^[a-f0-9]{64}$/u.test(value.license.sha256)
	) {
		throw new Error('SWI-Prolog runtime license receipt is invalid.');
	}
	const license = {
		path: 'LICENSE.txt',
		spdx: 'BSD-2-Clause',
		size: value.license.size,
		sha256: value.license.sha256
	};
	const metadata = normalizeReceipt(
		value.metadata,
		{ path: 'runtime-build.json', mediaType: 'application/json' },
		maxAssetBytes,
		'SWI-Prolog runtime metadata'
	);
	if (!Array.isArray(value.assets) || value.assets.length !== 3) {
		throw new Error('SWI-Prolog runtime manifest must declare exactly three logical assets.');
	}
	if (!Array.isArray(value.storage) || value.storage.length !== 3) {
		throw new Error('SWI-Prolog runtime manifest must declare exactly three storage assets.');
	}
	const assetByPath = new Map();
	for (const candidate of value.assets) {
		const expected = expectedAssets[candidate?.path];
		if (!expected || assetByPath.has(candidate.path)) {
			throw new Error(
				'SWI-Prolog runtime manifest has an unexpected or duplicate logical asset.'
			);
		}
		assetByPath.set(
			candidate.path,
			normalizeReceipt(
				candidate,
				{ path: candidate.path, mediaType: expected.mediaType },
				maxAssetBytes,
				`SWI-Prolog runtime asset ${candidate.path}`
			)
		);
	}
	const storageByPath = new Map();
	for (const candidate of value.storage) {
		const expected = expectedStorage[candidate?.path];
		if (!expected || storageByPath.has(candidate.path)) {
			throw new Error(
				'SWI-Prolog runtime manifest has an unexpected or duplicate storage asset.'
			);
		}
		storageByPath.set(
			candidate.path,
			normalizeStorageReceipt(candidate, { path: candidate.path, ...expected }, maxAssetBytes)
		);
	}
	if (
		Object.keys(expectedAssets).some((path) => !assetByPath.has(path)) ||
		Object.keys(expectedStorage).some((path) => !storageByPath.has(path))
	) {
		throw new Error('SWI-Prolog runtime manifest is missing a required asset.');
	}
	const assets = [...assetByPath.values()];
	const storage = [...storageByPath.values()];
	if (
		(await computeFingerprint(
			value.profileId,
			packageMetadata,
			toolchain,
			license,
			metadata,
			assets,
			storage
		)) !== expectedFingerprint
	) {
		throw new Error('SWI-Prolog runtime receipt graph failed fingerprint verification.');
	}
	return { assetByPath, storageByPath };
}

async function verifyReceiptBytes(receipt, bytes, label) {
	if (bytes.byteLength !== receipt.size) throw new Error(`${label} has an unexpected byte size.`);
	if ((await sha256Hex(bytes)) !== receipt.sha256) {
		throw new Error(`${label} failed SHA-256 verification.`);
	}
}

async function receiptMatchesBytes(receipt, bytes) {
	return bytes.byteLength === receipt.size && (await sha256Hex(bytes)) === receipt.sha256;
}

async function decompressGzipBounded(compressedBytes, expectedBytes, maxBytes, label) {
	if (typeof DecompressionStream !== 'function') {
		throw new Error('SWI-Prolog runtime gzip decompression is unavailable.');
	}
	if (!Number.isSafeInteger(expectedBytes) || expectedBytes <= 0 || expectedBytes > maxBytes) {
		throw new Error(`${label} logical byte size is invalid.`);
	}
	let reader;
	try {
		reader = new Blob([compressedBytes])
			.stream()
			.pipeThrough(new DecompressionStream('gzip'))
			.getReader();
	} catch {
		throw new Error(`${label} gzip stream could not be opened.`);
	}
	const output = new Uint8Array(expectedBytes);
	let loaded = 0;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			if (!(value instanceof Uint8Array))
				throw new Error(`${label} gzip returned an invalid byte stream.`);
			const nextLoaded = loaded + value.byteLength;
			if (!Number.isSafeInteger(nextLoaded) || nextLoaded > expectedBytes) {
				throw new Error(`${label} gzip exceeds its logical receipt size.`);
			}
			output.set(value, loaded);
			loaded = nextLoaded;
		}
		if (loaded !== expectedBytes) throw new Error(`${label} gzip is truncated.`);
		return output;
	} catch (error) {
		try {
			void Promise.resolve(reader.cancel(error)).catch(() => undefined);
		} catch {
			// Preserve the decompression failure.
		}
		throw error;
	} finally {
		try {
			reader.releaseLock();
		} catch {
			// Preserve the decompression result.
		}
	}
}

function importVerifiedRuntimeScript(bytes) {
	try {
		fatalDecoder.decode(bytes);
	} catch {
		throw new Error('SWI-Prolog runtime JavaScript is not valid UTF-8.');
	}
	if (
		typeof Blob !== 'function' ||
		typeof URL.createObjectURL !== 'function' ||
		typeof URL.revokeObjectURL !== 'function' ||
		typeof importScripts !== 'function'
	) {
		throw new Error('SWI-Prolog verified runtime evaluation is unavailable.');
	}
	const scriptUrl = URL.createObjectURL(new Blob([bytes], { type: 'text/javascript' }));
	try {
		importScripts(scriptUrl);
	} finally {
		try {
			URL.revokeObjectURL(scriptUrl);
		} catch {
			// Blob cleanup must not replace the verified evaluation outcome.
		}
	}
}

async function createVerifiedSwiplFactory(
	baseUrl,
	manifestUrl,
	manifestFingerprint,
	requestedMaxAssetBytes
) {
	if (!Number.isSafeInteger(requestedMaxAssetBytes) || requestedMaxAssetBytes <= 0) {
		throw new Error('SWI-Prolog runtime asset byte limit is invalid.');
	}
	const maxAssetBytes = Math.min(requestedMaxAssetBytes, hardMaxAssetBytes);
	const identity = `${baseUrl}\n${manifestUrl}\n${manifestFingerprint}\n${maxAssetBytes}`;
	if (verifiedRuntimePromise) {
		if (verifiedRuntimeIdentity !== identity) {
			throw new Error('SWI-Prolog worker cannot replace an initialized runtime profile.');
		}
		return await verifiedRuntimePromise;
	}
	verifiedRuntimeIdentity = identity;
	verifiedRuntimePromise = (async () => {
		const resolvedManifestUrl =
			manifestUrl || assetUrl(baseUrl, 'runtime-manifest.v2.json', manifestFingerprint);
		const manifestBytes = await fetchBoundedBytes(
			resolvedManifestUrl,
			'SWI-Prolog runtime manifest',
			Math.min(maxManifestBytes, maxAssetBytes),
			undefined,
			'no-store'
		);
		let parsed;
		try {
			parsed = JSON.parse(fatalDecoder.decode(manifestBytes));
		} catch {
			throw new Error('SWI-Prolog runtime manifest is not valid UTF-8 JSON.');
		}
		const manifest = await normalizeManifest(parsed, manifestFingerprint, maxAssetBytes);
		const logicalBytesByPath = new Map();
		for (const storagePath of Object.keys(expectedStorage).sort()) {
			const storageReceipt = manifest.storageByPath.get(storagePath);
			const logicalReceipt = manifest.assetByPath.get(storageReceipt.logicalPath);
			const transportedBytes = await fetchBoundedBytes(
				assetUrl(baseUrl, storagePath, manifestFingerprint),
				`SWI-Prolog runtime storage ${storagePath}`,
				Math.max(storageReceipt.size, logicalReceipt.size),
				storageReceipt.size,
				undefined,
				storageReceipt.encoding === 'gzip' ? logicalReceipt.size : undefined
			);
			let logicalBytes;
			if (await receiptMatchesBytes(storageReceipt, transportedBytes)) {
				logicalBytes =
					storageReceipt.encoding === 'gzip'
						? await decompressGzipBounded(
								transportedBytes,
								logicalReceipt.size,
								maxAssetBytes,
								`SWI-Prolog runtime asset ${logicalReceipt.path}`
							)
						: transportedBytes;
			} else if (
				storageReceipt.encoding === 'gzip' &&
				(await receiptMatchesBytes(logicalReceipt, transportedBytes))
			) {
				// Fetch transparently decodes HTTP Content-Encoding. The pinned logical
				// receipt remains the executable trust boundary in that transport mode.
				logicalBytes = transportedBytes;
			} else {
				throw new Error(
					`SWI-Prolog runtime storage ${storagePath} failed SHA-256 verification.`
				);
			}
			await verifyReceiptBytes(
				logicalReceipt,
				logicalBytes,
				`SWI-Prolog runtime asset ${logicalReceipt.path}`
			);
			logicalBytesByPath.set(logicalReceipt.path, logicalBytes);
		}
		const javascriptBytes = logicalBytesByPath.get('swipl-web.js');
		const wasmBytes = logicalBytesByPath.get('swipl-web.wasm');
		const dataBytes = logicalBytesByPath.get('swipl-web.data');
		importVerifiedRuntimeScript(javascriptBytes);
		if (typeof globalThis.SWIPL !== 'function') {
			throw new Error('SWI-Prolog runtime JavaScript did not initialize.');
		}
		return (options) =>
			globalThis.SWIPL({
				...options,
				wasmBinary: wasmBytes,
				locateFile(path) {
					if (path !== 'swipl-web.wasm' && path !== 'swipl-web.data') {
						throw new Error(
							`SWI-Prolog requested an undeclared runtime asset: ${path}`
						);
					}
					return `wasm-idle-verified:${path}`;
				},
				getPreloadedPackage(packageName, packageSize) {
					if (
						packageName !== 'wasm-idle-verified:swipl-web.data' ||
						packageSize !== dataBytes.byteLength
					) {
						throw new Error('SWI-Prolog requested an unexpected preloaded package.');
					}
					return dataBytes.buffer;
				}
			});
	})();
	try {
		return await verifiedRuntimePromise;
	} catch (error) {
		verifiedRuntimePromise = null;
		verifiedRuntimeIdentity = '';
		throw error;
	}
}

function postOutput(text) {
	if (!text) return;
	self.postMessage({ output: text.endsWith('\n') ? text : `${text}\n` });
}

function normalizeWorkspacePath(path) {
	const parts = [];
	for (const part of String(path || '')
		.replace(/^\/+/, '')
		.split('/')) {
		if (!part || part === '.' || part === '..' || part.includes('\0')) continue;
		parts.push(part);
	}
	return parts.join('/') || 'main.prolog';
}

function dirname(path) {
	const slash = path.lastIndexOf('/');
	return slash === -1 ? '' : path.slice(0, slash);
}

function prologString(value) {
	return `'${String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

function createSharedStdinReader(channel) {
	if (channel === undefined) return null;
	if (
		channel?.protocol !== 'wasm-idle-static-stdin-ring' ||
		channel?.protocolVersion !== 1 ||
		channel?.controlBytes !== 16 ||
		!Number.isSafeInteger(channel?.capacity) ||
		channel.capacity <= 0 ||
		typeof SharedArrayBuffer !== 'function' ||
		!(channel.buffer instanceof SharedArrayBuffer) ||
		channel.buffer.byteLength !== channel.controlBytes + channel.capacity ||
		typeof Atomics.wait !== 'function'
	) {
		throw new Error('Invalid SWI-Prolog streaming stdin channel.');
	}
	const control = new Int32Array(channel.buffer, 0, 4);
	const bytes = new Uint8Array(channel.buffer, channel.controlBytes, channel.capacity);
	return () => {
		while (true) {
			if (Atomics.load(control, 3) === 1)
				throw new Error('SWI-Prolog streaming stdin was cancelled.');
			const write = Atomics.load(control, 0);
			const read = Atomics.load(control, 1);
			const available = write - read;
			if (available < 0 || available > bytes.byteLength) {
				throw new Error('SWI-Prolog streaming stdin counters are invalid.');
			}
			if (available > 0) {
				const value = bytes[read % bytes.byteLength];
				Atomics.store(control, 1, read + 1);
				return value;
			}
			if (Atomics.load(control, 2) === 1) return null;
			self.postMessage({ type: 'stdin-request' });
			Atomics.wait(control, 0, write);
		}
	};
}

function createStdinReader(stdin, channel) {
	const sharedReader = createSharedStdinReader(channel);
	if (sharedReader) return sharedReader;
	const bytes = encoder.encode(typeof stdin === 'string' ? stdin : '');
	let offset = 0;
	return () => (offset >= bytes.byteLength ? null : bytes[offset++]);
}

function mkdirp(fs, path) {
	if (!path) return;
	let current = '';
	for (const part of path.split('/')) {
		if (!part) continue;
		current += `/${part}`;
		if (!fs.analyzePath(current).exists) fs.mkdir(current);
	}
}

function writeWorkspaceFile(fs, path, content) {
	const normalized = normalizeWorkspacePath(path);
	const fullPath = `/${normalized}`;
	mkdirp(fs, dirname(normalized));
	fs.writeFile(fullPath, content);
	return fullPath;
}

self.onmessage = async (event) => {
	const {
		baseUrl,
		manifestUrl,
		manifestFingerprint,
		maxAssetBytes,
		code,
		stdin,
		stdinChannel,
		activePath = 'main.prolog',
		workspaceFiles = [],
		diagnose = false,
		log
	} = event.data || {};
	let diagnosticOutput = '';
	const originalConsole = diagnose
		? {
				log: console.log.bind(console),
				warn: console.warn.bind(console),
				error: console.error.bind(console)
			}
		: null;
	const appendDiagnosticOutput = (...args) => {
		if (!diagnose) return;
		const output = args
			.map((value) => (typeof value === 'string' ? value : value?.message || String(value)))
			.join(' ');
		if (output) diagnosticOutput += output.endsWith('\n') ? output : `${output}\n`;
	};
	if (originalConsole) {
		console.log = (...args) => {
			appendDiagnosticOutput(...args);
			originalConsole.log(...args);
		};
		console.warn = (...args) => {
			appendDiagnosticOutput(...args);
			originalConsole.warn(...args);
		};
		console.error = (...args) => {
			appendDiagnosticOutput(...args);
			originalConsole.error(...args);
		};
	}
	try {
		if (log) {
			console.log(
				`[wasm-idle:prolog-worker] ${diagnose ? 'diagnose' : 'run'} start baseUrl=${baseUrl}`
			);
		}
		const createSwipl = await createVerifiedSwiplFactory(
			baseUrl,
			manifestUrl,
			manifestFingerprint,
			maxAssetBytes
		);
		const swipl = await createSwipl({
			arguments: ['-q'],
			print(text) {
				const output = String(text);
				if (diagnose) diagnosticOutput += `${output}\n`;
				postOutput(output);
			},
			printErr(text) {
				const output = String(text);
				if (diagnose) diagnosticOutput += `${output}\n`;
				postOutput(output);
			},
			stdin: createStdinReader(stdin, stdinChannel)
		});
		for (const file of workspaceFiles) writeWorkspaceFile(swipl.FS, file.path, file.content);
		const mainPath = writeWorkspaceFile(swipl.FS, activePath, code);
		const query = diagnose
			? `setup_call_cleanup(open_string(${prologString(code)}, Stream), (repeat, read_term(Stream, Term, [syntax_errors(error)]), (Term == end_of_file -> ! ; fail)), close(Stream)).`
			: `consult(${prologString(mainPath)}), (current_predicate(main/0) -> main ; true).`;
		const goal = swipl.prolog.query(query);
		try {
			const result = goal.once();
			if (result === false) throw new Error('Prolog goal failed.');
		} finally {
			goal.close?.();
		}
		if (diagnose && /\b(?:error|warning)\b|syntax error/iu.test(diagnosticOutput)) {
			throw new Error(diagnosticOutput.trim());
		}
		if (log) console.log(`[wasm-idle:prolog-worker] ${diagnose ? 'diagnose' : 'run'} settled`);
		self.postMessage({ results: true });
	} catch (error) {
		if (log) console.error('[wasm-idle:prolog-worker] failed', error);
		self.postMessage({ error: error?.message || String(error) });
	} finally {
		if (originalConsole) {
			console.log = originalConsole.log;
			console.warn = originalConsole.warn;
			console.error = originalConsole.error;
		}
	}
};
