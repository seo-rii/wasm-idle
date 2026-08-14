const textEncoder = new TextEncoder();
const fatalDecoder = new TextDecoder('utf-8', { fatal: true });
const manifestFormat = 'wasm-julia-runtime-manifest-v2';
const fingerprintDomain = 'wasm-idle:julia-runtime-manifest:v2';
const expectedProfileId = 'julia-1.0.4-chriskoch-npm-22a55e0d';
const expectedLicenseExpression = 'MIT AND LicenseRef-Julia-Third-Party';
const hardMaxAssetBytes = 64 * 1024 * 1024;
const maxManifestBytes = 128 * 1024;
const expectedArtifact = Object.freeze({
	kind: 'opaque-npm-prebuilt',
	packageName: '@chriskoch/julia-wasm',
	packageVersion: '1.0.4',
	packageSpec: '@chriskoch/julia-wasm@1.0.4',
	registryUrl: 'https://registry.npmjs.org/',
	tarballUrl: 'https://registry.npmjs.org/@chriskoch/julia-wasm/-/julia-wasm-1.0.4.tgz',
	publishedAt: '2020-12-05T19:33:59.354Z',
	repository: 'https://github.com/chris-koch-penn/polylang.git',
	sourceRevision: 'unrecorded',
	importedByCommit: 'c9529ad7b7ecfaea8a55c0fe5693c4d07cd0ae26',
	npmGitHead: 'unrecorded',
	verifiedBuildInput: false,
	bytes: 12_406_918,
	sha256: '03d0e93196dbeec55946bbe447d4c9b2d244dba15fdd882c750fb33598bf640f',
	sha512: '86b957b1b800430c76542eae9959c528f540ad94fbaa34c9edaecc245497216b9cbc353f56aac392db4ddba81aa78a354383a3a11924688b0df40307ce146fc4',
	npmIntegrity:
		'sha512-hrlXsbgAQwx2VC6umVnFKPVArZT7qjTJ7a7MJFSXIWucvDU/VqrDkttN26gap4o1Q4OjoRkkaIsN9AMHzhRvxA==',
	npmShasum: '22a55e0d10ad50f2999d059b325abe4d95cf17b3'
});
const expectedComponents = Object.freeze({
	distribution: Object.freeze({
		version: '1.0.4',
		repository: 'https://github.com/chris-koch-penn/polylang.git',
		revision: 'unrecorded',
		verifiedBuildInput: false,
		evidence:
			'content-locked npm package; source revision and build recipe are not published in package metadata'
	}),
	julia: Object.freeze({
		version: '1.0.4',
		repository: 'https://github.com/JuliaLang/julia.git',
		revision: 'unrecorded',
		verifiedBuildInput: false,
		evidence:
			'npm package identity and bundled README claim; binary-to-source attestation is unavailable'
	}),
	emscripten: Object.freeze({
		version: 'unrecorded',
		repository: 'https://github.com/emscripten-core/emscripten.git',
		revision: 'unrecorded',
		verifiedBuildInput: false,
		evidence: 'opaque prebuilt Emscripten loader without recorded toolchain revision'
	})
});
const expectedLicense = Object.freeze({
	path: 'LICENSE.md',
	spdx: expectedLicenseExpression
});
const expectedDocumentation = Object.freeze({
	path: 'readme.md',
	mediaType: 'text/markdown'
});
const expectedAssets = Object.freeze({
	'julia.data': Object.freeze({ mediaType: 'application/octet-stream' }),
	'julia.js': Object.freeze({ mediaType: 'text/javascript' }),
	'julia.wasm': Object.freeze({ mediaType: 'application/wasm' })
});
const expectedStorage = Object.freeze({
	'julia.data.gz': Object.freeze({ logicalPath: 'julia.data', encoding: 'gzip' }),
	'julia.js.gz': Object.freeze({ logicalPath: 'julia.js', encoding: 'gzip' }),
	'julia.wasm.gz': Object.freeze({ logicalPath: 'julia.wasm', encoding: 'gzip' })
});
const expectedManifestKeys = Object.freeze(
	[
		'artifact',
		'assets',
		'components',
		'documentation',
		'fingerprint',
		'format',
		'license',
		'licenseExpression',
		'metadata',
		'profileId',
		'runtime',
		'storage'
	].sort()
);
const expectedReceiptKeys = Object.freeze(['mediaType', 'path', 'sha256', 'size']);
const expectedStorageReceiptKeys = Object.freeze([
	'encoding',
	'logicalPath',
	'path',
	'sha256',
	'size'
]);
const expectedLicenseReceiptKeys = Object.freeze(['path', 'sha256', 'size', 'spdx']);

let verifiedRuntimePromise = null;
let verifiedRuntimeIdentity = '';
let runtimeEvaluationStarted = false;

function isObject(value) {
	return !!value && typeof value === 'object' && !Array.isArray(value);
}

function hasExactKeys(value, expectedKeys) {
	return (
		isObject(value) &&
		JSON.stringify(Object.keys(value).sort()) === JSON.stringify(expectedKeys)
	);
}

function canonicalJson(value) {
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
	if (isObject(value)) {
		return `{${Object.keys(value)
			.sort()
			.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
			.join(',')}}`;
	}
	const primitive = JSON.stringify(value);
	if (primitive === undefined) throw new Error('Julia manifest contains a non-JSON value.');
	return primitive;
}

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
	const base = requireHttpUrl(baseUrl, 'Julia runtime base');
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
		if (!response.ok) {
			throw new Error(`${label} request failed with status ${response.status}.`);
		}
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
			if (!(value instanceof Uint8Array)) {
				throw new Error(`${label} returned an invalid byte stream.`);
			}
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
		throw new Error('Julia runtime integrity verification requires Web Crypto.');
	}
	const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes));
	return [...digest].map((value) => value.toString(16).padStart(2, '0')).join('');
}

async function computeFingerprint(
	profileId,
	licenseExpression,
	artifact,
	components,
	license,
	documentation,
	metadata,
	assets,
	storage
) {
	let canonical = `${fingerprintDomain}\nformat\0${manifestFormat}\nruntime\0chriskoch-julia-wasm\nprofileId\0${profileId}\n`;
	canonical += `licenseExpression\0${licenseExpression}\n`;
	canonical += `artifact\0${canonicalJson(artifact)}\n`;
	canonical += `components\0${canonicalJson(components)}\n`;
	canonical += `license\0${license.path}\0${license.spdx}\0${license.size}\0${license.sha256}\n`;
	canonical += `documentation\0${documentation.path}\0${documentation.mediaType}\0${documentation.size}\0${documentation.sha256}\n`;
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
	return await sha256Hex(textEncoder.encode(canonical));
}

function normalizeProvenanceObject(candidate, expected, label) {
	if (!isObject(candidate) || canonicalJson(candidate) !== canonicalJson(expected)) {
		throw new Error(`Julia runtime ${label} metadata is invalid.`);
	}
	return candidate;
}

function normalizeReceipt(candidate, expected, maxAssetBytes, label) {
	if (
		!hasExactKeys(candidate, expectedReceiptKeys) ||
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
		!hasExactKeys(candidate, expectedStorageReceiptKeys) ||
		candidate.path !== expected.path ||
		candidate.logicalPath !== expected.logicalPath ||
		candidate.encoding !== expected.encoding ||
		!Number.isSafeInteger(candidate.size) ||
		candidate.size <= 0 ||
		candidate.size > maxAssetBytes ||
		typeof candidate.sha256 !== 'string' ||
		!/^[a-f0-9]{64}$/u.test(candidate.sha256)
	) {
		throw new Error(`Julia runtime storage receipt is invalid for ${expected.path}.`);
	}
	return {
		path: expected.path,
		logicalPath: expected.logicalPath,
		encoding: expected.encoding,
		size: candidate.size,
		sha256: candidate.sha256
	};
}

async function normalizeManifest(value, expectedFingerprint, maxAssetBytes) {
	if (!isObject(value)) throw new Error('Julia runtime manifest must be an object.');
	if (!hasExactKeys(value, expectedManifestKeys)) {
		throw new Error('Julia runtime manifest schema is invalid.');
	}
	if (value.format !== manifestFormat || value.runtime !== 'chriskoch-julia-wasm') {
		throw new Error('Julia runtime manifest format is unsupported.');
	}
	if (
		value.profileId !== expectedProfileId ||
		value.licenseExpression !== expectedLicenseExpression ||
		typeof expectedFingerprint !== 'string' ||
		!/^[a-f0-9]{64}$/u.test(expectedFingerprint)
	) {
		throw new Error('Julia runtime profile or expected fingerprint is invalid.');
	}
	if (value.fingerprint !== expectedFingerprint) {
		throw new Error('Julia runtime manifest fingerprint does not match the pinned runtime.');
	}
	const artifact = normalizeProvenanceObject(value.artifact, expectedArtifact, 'artifact');
	const components = normalizeProvenanceObject(value.components, expectedComponents, 'component');
	if (
		!hasExactKeys(value.license, expectedLicenseReceiptKeys) ||
		value.license.path !== expectedLicense.path ||
		value.license.spdx !== expectedLicense.spdx ||
		!Number.isSafeInteger(value.license.size) ||
		value.license.size <= 0 ||
		value.license.size > maxAssetBytes ||
		typeof value.license.sha256 !== 'string' ||
		!/^[a-f0-9]{64}$/u.test(value.license.sha256)
	) {
		throw new Error('Julia runtime license receipt is invalid.');
	}
	const license = {
		path: expectedLicense.path,
		spdx: expectedLicense.spdx,
		size: value.license.size,
		sha256: value.license.sha256
	};
	const documentation = normalizeReceipt(
		value.documentation,
		expectedDocumentation,
		maxAssetBytes,
		'Julia runtime documentation'
	);
	const metadata = normalizeReceipt(
		value.metadata,
		{ path: 'runtime-build.json', mediaType: 'application/json' },
		maxAssetBytes,
		'Julia runtime metadata'
	);
	if (!Array.isArray(value.assets) || value.assets.length !== 3) {
		throw new Error('Julia runtime manifest must declare exactly three logical assets.');
	}
	if (!Array.isArray(value.storage) || value.storage.length !== 3) {
		throw new Error('Julia runtime manifest must declare exactly three storage assets.');
	}
	const assetByPath = new Map();
	for (const candidate of value.assets) {
		const expected = expectedAssets[candidate?.path];
		if (!expected || assetByPath.has(candidate.path)) {
			throw new Error('Julia runtime manifest has an unexpected or duplicate logical asset.');
		}
		assetByPath.set(
			candidate.path,
			normalizeReceipt(
				candidate,
				{ path: candidate.path, mediaType: expected.mediaType },
				maxAssetBytes,
				`Julia runtime asset ${candidate.path}`
			)
		);
	}
	const storageByPath = new Map();
	for (const candidate of value.storage) {
		const expected = expectedStorage[candidate?.path];
		if (!expected || storageByPath.has(candidate.path)) {
			throw new Error('Julia runtime manifest has an unexpected or duplicate storage asset.');
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
		throw new Error('Julia runtime manifest is missing a required receipt.');
	}
	const assets = [...assetByPath.values()];
	const storage = [...storageByPath.values()];
	if (
		(await computeFingerprint(
			value.profileId,
			value.licenseExpression,
			artifact,
			components,
			license,
			documentation,
			metadata,
			assets,
			storage
		)) !== expectedFingerprint
	) {
		throw new Error('Julia runtime receipt graph failed fingerprint verification.');
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
		throw new Error('Julia runtime gzip decompression is unavailable.');
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
			if (!(value instanceof Uint8Array)) {
				throw new Error(`${label} gzip returned an invalid byte stream.`);
			}
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
		throw new Error('Julia runtime JavaScript is not valid UTF-8.');
	}
	if (
		typeof Blob !== 'function' ||
		typeof URL.createObjectURL !== 'function' ||
		typeof URL.revokeObjectURL !== 'function' ||
		typeof importScripts !== 'function'
	) {
		throw new Error('Julia verified runtime evaluation is unavailable.');
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

async function loadVerifiedJuliaBytes(
	baseUrl,
	manifestUrl,
	manifestFingerprint,
	requestedMaxAssetBytes
) {
	if (!Number.isSafeInteger(requestedMaxAssetBytes) || requestedMaxAssetBytes <= 0) {
		throw new Error('Julia runtime asset byte limit is invalid.');
	}
	const maxAssetBytes = Math.min(requestedMaxAssetBytes, hardMaxAssetBytes);
	const identity = `${baseUrl}\n${manifestUrl}\n${manifestFingerprint}\n${maxAssetBytes}`;
	if (verifiedRuntimePromise) {
		if (verifiedRuntimeIdentity !== identity) {
			throw new Error('Julia worker cannot replace an initialized runtime profile.');
		}
		return await verifiedRuntimePromise;
	}
	verifiedRuntimeIdentity = identity;
	verifiedRuntimePromise = (async () => {
		const resolvedManifestUrl =
			manifestUrl || assetUrl(baseUrl, 'runtime-manifest.v2.json', manifestFingerprint);
		const manifestBytes = await fetchBoundedBytes(
			resolvedManifestUrl,
			'Julia runtime manifest',
			Math.min(maxManifestBytes, maxAssetBytes),
			undefined,
			'no-store'
		);
		let parsed;
		try {
			parsed = JSON.parse(fatalDecoder.decode(manifestBytes));
		} catch {
			throw new Error('Julia runtime manifest is not valid UTF-8 JSON.');
		}
		const manifest = await normalizeManifest(parsed, manifestFingerprint, maxAssetBytes);
		const logicalBytesByPath = new Map();
		for (const storagePath of Object.keys(expectedStorage).sort()) {
			const storageReceipt = manifest.storageByPath.get(storagePath);
			const logicalReceipt = manifest.assetByPath.get(storageReceipt.logicalPath);
			const transportedBytes = await fetchBoundedBytes(
				assetUrl(baseUrl, storagePath, manifestFingerprint),
				`Julia runtime storage ${storagePath}`,
				Math.max(storageReceipt.size, logicalReceipt.size),
				storageReceipt.size,
				undefined,
				logicalReceipt.size
			);
			let logicalBytes;
			if (await receiptMatchesBytes(storageReceipt, transportedBytes)) {
				logicalBytes = await decompressGzipBounded(
					transportedBytes,
					logicalReceipt.size,
					maxAssetBytes,
					`Julia runtime asset ${logicalReceipt.path}`
				);
			} else if (await receiptMatchesBytes(logicalReceipt, transportedBytes)) {
				// Browsers may transparently decode a gzip Content-Encoding response.
				logicalBytes = transportedBytes;
			} else {
				throw new Error(
					`Julia runtime storage ${storagePath} failed SHA-256 verification.`
				);
			}
			await verifyReceiptBytes(
				logicalReceipt,
				logicalBytes,
				`Julia runtime asset ${logicalReceipt.path}`
			);
			logicalBytesByPath.set(logicalReceipt.path, logicalBytes);
		}
		return Object.freeze({
			javascriptBytes: logicalBytesByPath.get('julia.js'),
			wasmBytes: logicalBytesByPath.get('julia.wasm'),
			dataBytes: logicalBytesByPath.get('julia.data')
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

function createStdinReader(stdin, channel) {
	if (channel === undefined) {
		const bytes = textEncoder.encode(typeof stdin === 'string' ? stdin : '');
		let offset = 0;
		return () => (offset < bytes.length ? bytes[offset++] : null);
	}
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
		throw new Error('Invalid Julia streaming stdin channel.');
	}

	const control = new Int32Array(channel.buffer, 0, 4);
	const bytes = new Uint8Array(channel.buffer, channel.controlBytes, channel.capacity);
	let yieldAfterChunk = false;
	return () => {
		while (true) {
			if (Atomics.load(control, 3) === 1) {
				throw new Error('Julia streaming stdin was cancelled.');
			}
			const write = Atomics.load(control, 0);
			const read = Atomics.load(control, 1);
			const available = write - read;
			if (available < 0 || available > bytes.byteLength) {
				throw new Error('Julia streaming stdin counters are invalid.');
			}
			if (available > 0) {
				const value = bytes[read % bytes.byteLength];
				Atomics.store(control, 1, read + 1);
				if (available === 1) {
					yieldAfterChunk = true;
					self.postMessage({ type: 'stdin-request' });
				}
				return value;
			}
			if (Atomics.load(control, 2) === 1) return null;
			if (yieldAfterChunk) {
				yieldAfterChunk = false;
				return undefined;
			}
			self.postMessage({ type: 'stdin-request' });
			Atomics.wait(control, 0, write);
		}
	};
}

function postOutput(lines) {
	const output = lines.filter(Boolean).join('\n');
	if (output) self.postMessage({ output: output.endsWith('\n') ? output : `${output}\n` });
}

function postOutputChunk(output) {
	if (output) self.postMessage({ output });
}

function createCharOutput(lines, onChunk = () => {}) {
	const decoder = new TextDecoder();
	let line = '';
	const flush = () => {
		const tail = decoder.decode();
		if (tail) onChunk(tail);
		line += tail;
		if (line) lines.push(line);
		line = '';
	};
	const output = (value) => {
		if (value === null) {
			flush();
			return;
		}
		if (value === 0) return;
		const text = decoder.decode(Uint8Array.of(value), { stream: true });
		if (text) {
			line += text;
			onChunk(text);
		}
		if (value === 10) {
			const completedLine = line.endsWith('\n') ? line.slice(0, -1) : line;
			if (completedLine) lines.push(completedLine);
			line = '';
		}
	};
	output.finish = flush;
	return output;
}

function cString(module, text) {
	const bytes = new TextEncoder().encode(`${text}\0`);
	const ptr = module._malloc(bytes.length);
	module.HEAPU8.set(bytes, ptr);
	return ptr;
}

function juliaString(text) {
	return JSON.stringify(String(text || ''));
}

function buildRunnerSource(code, stdin, activePath, streaming) {
	const stdinSource = streaming ? 'open("/dev/stdin", "r")' : `IOBuffer(${juliaString(stdin)})`;
	const stdinSetup = `import Base: readline, readlines, read, eachline
const __wasm_idle_stdin = ${stdinSource}
readline() = Base.readline(__wasm_idle_stdin)
readline(::typeof(stdin)) = Base.readline(__wasm_idle_stdin)
readlines() = Base.readlines(__wasm_idle_stdin)
readlines(::typeof(stdin)) = Base.readlines(__wasm_idle_stdin)
read() = Base.read(__wasm_idle_stdin, String)
read(::typeof(stdin)) = Base.read(__wasm_idle_stdin)
read(::typeof(stdin), ::Type{String}) = Base.read(__wasm_idle_stdin, String)
eachline() = Base.eachline(__wasm_idle_stdin)
eachline(::typeof(stdin)) = Base.eachline(__wasm_idle_stdin)`;
	return `${stdinSetup}
try
    Base.include_string(Main, ${juliaString(code)}, ${juliaString(activePath || 'main.jl')})
catch error
    showerror(stderr, error)
    println(stderr)
    rethrow(error)
end`;
}

async function loadJuliaRuntime(verified, stdinReader, stdout, stderr) {
	const stdoutDevice = createCharOutput(stdout, postOutputChunk);
	const stderrDevice = createCharOutput(stderr);
	const verifiedWasmPath = 'wasm-idle-verified:julia.wasm';
	const verifiedDataPath = 'wasm-idle-verified:julia.data';
	const module = {
		noInitialRun: true,
		wasmBinary: verified.wasmBytes,
		getPreloadedPackage(packageName, packageSize) {
			if (packageName !== verifiedDataPath || packageSize !== verified.dataBytes.byteLength) {
				throw new Error('Julia requested an unexpected preloaded package.');
			}
			if (
				verified.dataBytes.byteOffset === 0 &&
				verified.dataBytes.byteLength === verified.dataBytes.buffer.byteLength
			) {
				return verified.dataBytes.buffer;
			}
			return verified.dataBytes.buffer.slice(
				verified.dataBytes.byteOffset,
				verified.dataBytes.byteOffset + verified.dataBytes.byteLength
			);
		},
		locateFile(fileName) {
			const value = String(fileName);
			if (value === 'https://cdn.jsdelivr.net') return verifiedDataPath;
			if (value === 'julia-wasm/julia.wasm') return verifiedWasmPath;
			throw new Error(`Julia requested an undeclared runtime asset: ${value}`);
		},
		print: (text) => {
			const output = String(text);
			stdout.push(output);
			postOutput([output]);
		},
		printErr: (text) => stderr.push(String(text)),
		stdin: stdinReader,
		stdout: stdoutDevice,
		stderr: stderrDevice
	};
	globalThis.Module = module;
	const initializedModule = await new Promise((resolve, reject) => {
		module.onRuntimeInitialized = () => {
			try {
				module._jl_initialize();
				resolve(module);
			} catch (error) {
				reject(error);
			}
		};
		try {
			importVerifiedRuntimeScript(verified.javascriptBytes);
		} catch (error) {
			reject(error);
		}
	});
	return {
		module: initializedModule,
		finishOutput() {
			stdoutDevice.finish();
			stderrDevice.finish();
		}
	};
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
		activePath,
		log
	} = event.data || {};
	const stdout = [];
	const stderr = [];
	let finishOutput = () => {};
	try {
		if (log) console.log(`[wasm-idle:julia-worker] run start baseUrl=${baseUrl}`);
		const stdinReader = createStdinReader(stdin || '', stdinChannel);
		const verified = await loadVerifiedJuliaBytes(
			baseUrl,
			manifestUrl,
			manifestFingerprint,
			maxAssetBytes
		);
		if (runtimeEvaluationStarted) {
			throw new Error('Julia worker cannot execute more than one runtime instance.');
		}
		runtimeEvaluationStarted = true;
		const runtime = await loadJuliaRuntime(verified, stdinReader, stdout, stderr);
		const { module } = runtime;
		finishOutput = runtime.finishOutput;
		const runnerSource = buildRunnerSource(
			code || '',
			stdin || '',
			activePath,
			stdinChannel !== undefined
		);
		const sourcePtr = cString(module, runnerSource);
		try {
			module._jl_eval_string(sourcePtr);
		} finally {
			module._free(sourcePtr);
		}
		finishOutput();
		const exception =
			typeof module._jl_exception_occurred === 'function'
				? module._jl_exception_occurred()
				: 0;
		const filteredStderr = stderr.filter(
			(line) =>
				!line.includes(
					'file packager has copied file data into memory, but in memory growth we are forced to copy it again'
				)
		);
		if (filteredStderr.length > 0) throw new Error(filteredStderr.join('\n'));
		if (exception) throw new Error('Julia execution failed.');
		if (log) console.log('[wasm-idle:julia-worker] run settled');
		self.postMessage({ results: true });
	} catch (error) {
		const message = stderr.length > 0 ? stderr.join('\n') : error?.message || String(error);
		if (log) console.error('[wasm-idle:julia-worker] failed', error);
		self.postMessage({ error: message });
	} finally {
		finishOutput();
	}
};
