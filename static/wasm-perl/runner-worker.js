const encoder = new TextEncoder();
const fatalDecoder = new TextDecoder('utf-8', { fatal: true });
const manifestFormat = 'wasm-perl-runtime-manifest-v2';
const fingerprintDomain = 'wasm-idle:perl-runtime-manifest:v2';
const expectedProfileId = 'webperl-v0.09-beta-perl-5.28.1-emscripten-1.38.28';
const expectedLicenseExpression = 'Artistic-1.0-Perl OR GPL-1.0-or-later';
const hardMaxAssetBytes = 32 * 1024 * 1024;
const maxManifestBytes = 128 * 1024;
const expectedArtifact = Object.freeze({
	doi: '10.5281/zenodo.2582586',
	kind: 'opaque-prebuilt',
	path: 'webperl_prebuilt_v0.09-beta.zip',
	repository: 'https://github.com/haukex/webperl.git',
	revision: '6f2173d29a2c2e3536e1de75ff5d291ae96ab348',
	sha256: '5f441249217e90ab378c666f473d4206ab4f44907f6bb0aa8d70834bc38c40dc',
	size: 3936557,
	tag: 'v0.09-beta',
	url: 'https://zenodo.org/api/records/2582586/files/webperl_prebuilt_v0.09-beta.zip/content'
});
const expectedComponents = Object.freeze({
	cpanExtensions: Object.freeze({
		evidence: 'versioned WebPerl build configuration without transitive artifact locks',
		modules: Object.freeze(['Cpanel::JSON::XS', 'Devel::StackTrace', 'Future']),
		verifiedBuildInput: false
	}),
	emscripten: Object.freeze({
		evidence: 'versioned WebPerl build configuration',
		repository: 'https://github.com/emscripten-core/emscripten.git',
		revision: '69ab40586822209758165df170e9fc8b81e05608',
		verifiedBuildInput: false,
		version: '1.38.28'
	}),
	perl: Object.freeze({
		evidence: 'embedded runtime version string and versioned WebPerl build configuration',
		repository: 'https://github.com/haukex/emperl5.git',
		revision: 'e70d909feb796ec99d5e91de5d1635d4526ec131',
		verifiedBuildInput: false,
		version: '5.28.1'
	}),
	webperl: Object.freeze({
		evidence: 'release tag and opaque prebuilt archive',
		repository: 'https://github.com/haukex/webperl.git',
		revision: '6f2173d29a2c2e3536e1de75ff5d291ae96ab348',
		verifiedBuildInput: false,
		version: 'v0.09-beta'
	})
});
const expectedLicenses = Object.freeze({
	'licenses/LICENSE_artistic.txt': Object.freeze({ spdx: 'Artistic-1.0-Perl' }),
	'licenses/LICENSE_gpl.txt': Object.freeze({ spdx: 'GPL-1.0-or-later' })
});
const expectedAssets = Object.freeze({
	'emperl.data': Object.freeze({ mediaType: 'application/octet-stream' }),
	'emperl.js': Object.freeze({ mediaType: 'text/javascript' }),
	'emperl.wasm': Object.freeze({ mediaType: 'application/wasm' })
});
const expectedStorage = Object.freeze({
	'emperl.data.gz': Object.freeze({ logicalPath: 'emperl.data', encoding: 'gzip' }),
	'emperl.js.gz': Object.freeze({ logicalPath: 'emperl.js', encoding: 'gzip' }),
	'emperl.wasm.gz': Object.freeze({ logicalPath: 'emperl.wasm', encoding: 'gzip' })
});
const expectedManifestKeys = Object.freeze(
	[
		'artifact',
		'assets',
		'components',
		'fingerprint',
		'format',
		'licenseExpression',
		'licenses',
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
	const base = requireHttpUrl(baseUrl, 'WebPerl runtime base');
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
		throw new Error('WebPerl runtime integrity verification requires Web Crypto.');
	}
	const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes));
	return [...digest].map((value) => value.toString(16).padStart(2, '0')).join('');
}

function canonicalJson(value) {
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
	if (isObject(value)) {
		return `{${Object.keys(value)
			.sort()
			.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
			.join(',')}}`;
	}
	return JSON.stringify(value);
}

async function computeFingerprint(
	profileId,
	licenseExpression,
	artifact,
	components,
	licenses,
	metadata,
	assets,
	storage
) {
	let canonical = `${fingerprintDomain}\nformat\0${manifestFormat}\nruntime\0webperl\nprofileId\0${profileId}\n`;
	canonical += `licenseExpression\0${licenseExpression}\n`;
	canonical += `artifact\0${canonicalJson(artifact)}\n`;
	canonical += `components\0${canonicalJson(components)}\n`;
	for (const license of [...licenses].sort((left, right) =>
		left.path < right.path ? -1 : left.path > right.path ? 1 : 0
	)) {
		canonical += `license\0${license.path}\0${license.spdx}\0${license.size}\0${license.sha256}\n`;
	}
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

function normalizeProvenanceObject(candidate, expected, label) {
	if (!isObject(candidate) || canonicalJson(candidate) !== canonicalJson(expected)) {
		throw new Error(`WebPerl runtime ${label} metadata is invalid.`);
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
		throw new Error(`WebPerl runtime storage receipt is invalid for ${expected.path}.`);
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
	if (!isObject(value)) throw new Error('WebPerl runtime manifest must be an object.');
	if (!hasExactKeys(value, expectedManifestKeys)) {
		throw new Error('WebPerl runtime manifest schema is invalid.');
	}
	if (value.format !== manifestFormat || value.runtime !== 'webperl') {
		throw new Error('WebPerl runtime manifest format is unsupported.');
	}
	if (
		value.profileId !== expectedProfileId ||
		value.licenseExpression !== expectedLicenseExpression ||
		typeof expectedFingerprint !== 'string' ||
		!/^[a-f0-9]{64}$/u.test(expectedFingerprint)
	) {
		throw new Error('WebPerl runtime profile or expected fingerprint is invalid.');
	}
	if (value.fingerprint !== expectedFingerprint) {
		throw new Error('WebPerl runtime manifest fingerprint does not match the pinned runtime.');
	}
	const artifact = normalizeProvenanceObject(value.artifact, expectedArtifact, 'artifact');
	const components = normalizeProvenanceObject(value.components, expectedComponents, 'component');
	if (!Array.isArray(value.licenses) || value.licenses.length !== 2) {
		throw new Error('WebPerl runtime manifest must declare exactly two license receipts.');
	}
	const licenses = [];
	const licensePaths = new Set();
	for (const candidate of value.licenses) {
		const expected = expectedLicenses[candidate?.path];
		if (
			!expected ||
			!hasExactKeys(candidate, expectedLicenseReceiptKeys) ||
			licensePaths.has(candidate.path) ||
			candidate.spdx !== expected.spdx ||
			!Number.isSafeInteger(candidate.size) ||
			candidate.size <= 0 ||
			candidate.size > maxAssetBytes ||
			typeof candidate.sha256 !== 'string' ||
			!/^[a-f0-9]{64}$/u.test(candidate.sha256)
		) {
			throw new Error('WebPerl runtime license receipt is invalid.');
		}
		licensePaths.add(candidate.path);
		licenses.push({
			path: candidate.path,
			spdx: expected.spdx,
			size: candidate.size,
			sha256: candidate.sha256
		});
	}
	const metadata = normalizeReceipt(
		value.metadata,
		{ path: 'runtime-build.json', mediaType: 'application/json' },
		maxAssetBytes,
		'WebPerl runtime metadata'
	);
	if (!Array.isArray(value.assets) || value.assets.length !== 3) {
		throw new Error('WebPerl runtime manifest must declare exactly three logical assets.');
	}
	if (!Array.isArray(value.storage) || value.storage.length !== 3) {
		throw new Error('WebPerl runtime manifest must declare exactly three storage assets.');
	}
	const assetByPath = new Map();
	for (const candidate of value.assets) {
		const expected = expectedAssets[candidate?.path];
		if (!expected || assetByPath.has(candidate.path)) {
			throw new Error(
				'WebPerl runtime manifest has an unexpected or duplicate logical asset.'
			);
		}
		assetByPath.set(
			candidate.path,
			normalizeReceipt(
				candidate,
				{ path: candidate.path, mediaType: expected.mediaType },
				maxAssetBytes,
				`WebPerl runtime asset ${candidate.path}`
			)
		);
	}
	const storageByPath = new Map();
	for (const candidate of value.storage) {
		const expected = expectedStorage[candidate?.path];
		if (!expected || storageByPath.has(candidate.path)) {
			throw new Error(
				'WebPerl runtime manifest has an unexpected or duplicate storage asset.'
			);
		}
		storageByPath.set(
			candidate.path,
			normalizeStorageReceipt(candidate, { path: candidate.path, ...expected }, maxAssetBytes)
		);
	}
	if (
		Object.keys(expectedLicenses).some((path) => !licensePaths.has(path)) ||
		Object.keys(expectedAssets).some((path) => !assetByPath.has(path)) ||
		Object.keys(expectedStorage).some((path) => !storageByPath.has(path))
	) {
		throw new Error('WebPerl runtime manifest is missing a required receipt.');
	}
	const assets = [...assetByPath.values()];
	const storage = [...storageByPath.values()];
	if (
		(await computeFingerprint(
			value.profileId,
			value.licenseExpression,
			artifact,
			components,
			licenses,
			metadata,
			assets,
			storage
		)) !== expectedFingerprint
	) {
		throw new Error('WebPerl runtime receipt graph failed fingerprint verification.');
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
		throw new Error('WebPerl runtime gzip decompression is unavailable.');
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
		throw new Error('WebPerl runtime JavaScript is not valid UTF-8.');
	}
	if (
		typeof Blob !== 'function' ||
		typeof URL.createObjectURL !== 'function' ||
		typeof URL.revokeObjectURL !== 'function' ||
		typeof importScripts !== 'function'
	) {
		throw new Error('WebPerl verified runtime evaluation is unavailable.');
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

async function loadVerifiedWebPerlBytes(
	baseUrl,
	manifestUrl,
	manifestFingerprint,
	requestedMaxAssetBytes
) {
	if (!Number.isSafeInteger(requestedMaxAssetBytes) || requestedMaxAssetBytes <= 0) {
		throw new Error('WebPerl runtime asset byte limit is invalid.');
	}
	const maxAssetBytes = Math.min(requestedMaxAssetBytes, hardMaxAssetBytes);
	const identity = `${baseUrl}\n${manifestUrl}\n${manifestFingerprint}\n${maxAssetBytes}`;
	if (verifiedRuntimePromise) {
		if (verifiedRuntimeIdentity !== identity) {
			throw new Error('WebPerl worker cannot replace an initialized runtime profile.');
		}
		return await verifiedRuntimePromise;
	}
	verifiedRuntimeIdentity = identity;
	verifiedRuntimePromise = (async () => {
		const resolvedManifestUrl =
			manifestUrl || assetUrl(baseUrl, 'runtime-manifest.v2.json', manifestFingerprint);
		const manifestBytes = await fetchBoundedBytes(
			resolvedManifestUrl,
			'WebPerl runtime manifest',
			Math.min(maxManifestBytes, maxAssetBytes),
			undefined,
			'no-store'
		);
		let parsed;
		try {
			parsed = JSON.parse(fatalDecoder.decode(manifestBytes));
		} catch {
			throw new Error('WebPerl runtime manifest is not valid UTF-8 JSON.');
		}
		const manifest = await normalizeManifest(parsed, manifestFingerprint, maxAssetBytes);
		const logicalBytesByPath = new Map();
		for (const storagePath of Object.keys(expectedStorage).sort()) {
			const storageReceipt = manifest.storageByPath.get(storagePath);
			const logicalReceipt = manifest.assetByPath.get(storageReceipt.logicalPath);
			const transportedBytes = await fetchBoundedBytes(
				assetUrl(baseUrl, storagePath, manifestFingerprint),
				`WebPerl runtime storage ${storagePath}`,
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
					`WebPerl runtime asset ${logicalReceipt.path}`
				);
			} else if (await receiptMatchesBytes(logicalReceipt, transportedBytes)) {
				// Browsers may transparently decode a gzip Content-Encoding response.
				logicalBytes = transportedBytes;
			} else {
				throw new Error(
					`WebPerl runtime storage ${storagePath} failed SHA-256 verification.`
				);
			}
			await verifyReceiptBytes(
				logicalReceipt,
				logicalBytes,
				`WebPerl runtime asset ${logicalReceipt.path}`
			);
			logicalBytesByPath.set(logicalReceipt.path, logicalBytes);
		}
		return Object.freeze({
			javascriptBytes: logicalBytesByPath.get('emperl.js'),
			wasmBytes: logicalBytesByPath.get('emperl.wasm'),
			dataBytes: logicalBytesByPath.get('emperl.data')
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
		throw new Error('Invalid WebPerl streaming stdin channel.');
	}
	const control = new Int32Array(channel.buffer, 0, 4);
	const bytes = new Uint8Array(channel.buffer, channel.controlBytes, channel.capacity);
	return () => {
		while (true) {
			if (Atomics.load(control, 3) === 1) {
				throw new Error('WebPerl streaming stdin was cancelled.');
			}
			const write = Atomics.load(control, 0);
			const read = Atomics.load(control, 1);
			const available = write - read;
			if (available < 0 || available > bytes.byteLength) {
				throw new Error('WebPerl streaming stdin counters are invalid.');
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

function postOutput(text) {
	if (text) self.postMessage({ output: text });
}

self.onmessage = async (event) => {
	const {
		baseUrl,
		manifestUrl,
		manifestFingerprint,
		maxAssetBytes,
		code,
		args = [],
		stdin,
		stdinChannel,
		activePath = 'main.pl',
		log
	} = event.data || {};
	try {
		if (log) console.log(`[wasm-idle:perl-worker] run start baseUrl=${baseUrl}`);
		const verified = await loadVerifiedWebPerlBytes(
			baseUrl,
			manifestUrl,
			manifestFingerprint,
			maxAssetBytes
		);
		if (runtimeEvaluationStarted) {
			throw new Error('WebPerl worker cannot execute more than one runtime instance.');
		}
		runtimeEvaluationStarted = true;
		await new Promise((resolve, reject) => {
			let stdoutBuffer = '';
			let stderrBuffer = '';
			const flushStdout = () => {
				if (!stdoutBuffer) return;
				postOutput(stdoutBuffer);
				stdoutBuffer = '';
			};
			const flushStderr = () => {
				if (!stderrBuffer) return;
				postOutput(stderrBuffer);
				stderrBuffer = '';
			};
			globalThis.Module = {
				noInitialRun: true,
				noExitRuntime: false,
				wasmBinary: verified.wasmBytes,
				locateFile(path) {
					if (path !== 'emperl.wasm' && path !== 'emperl.data') {
						throw new Error(`WebPerl requested an undeclared runtime asset: ${path}`);
					}
					return `wasm-idle-verified:${path}`;
				},
				getPreloadedPackage(packageName, packageSize) {
					if (
						packageName !== 'wasm-idle-verified:emperl.data' ||
						packageSize !== verified.dataBytes.byteLength
					) {
						throw new Error('WebPerl requested an unexpected preloaded package.');
					}
					return verified.dataBytes.buffer;
				},
				print(text) {
					postOutput(`${text}\n`);
				},
				printErr(text) {
					postOutput(`${text}\n`);
				},
				stdin: createStdinReader(stdin, stdinChannel),
				stdout(codePoint) {
					if (codePoint === null || codePoint === 10) {
						if (codePoint === 10) stdoutBuffer += '\n';
						flushStdout();
						return;
					}
					stdoutBuffer += String.fromCharCode(codePoint);
				},
				stderr(codePoint) {
					if (codePoint === null || codePoint === 10) {
						if (codePoint === 10) stderrBuffer += '\n';
						flushStderr();
						return;
					}
					stderrBuffer += String.fromCharCode(codePoint);
				},
				onAbort(reason) {
					reject(new Error(String(reason || 'Perl runtime aborted')));
				},
				onRuntimeInitialized() {
					try {
						const fileBaseName = String(activePath).split('/').pop() || 'main.pl';
						const fileName = `/tmp/${fileBaseName}`;
						try {
							globalThis.Module.FS_createPath('/', 'tmp', true, true);
						} catch {
							// Some WebPerl builds create /tmp during startup.
						}
						globalThis.Module.FS_createDataFile(
							'/tmp',
							fileBaseName,
							encoder.encode(code),
							true,
							true
						);
						const status = globalThis.Module.callMain([fileName, ...args.map(String)]);
						flushStdout();
						flushStderr();
						if (typeof status === 'number' && status !== 0) {
							reject(new Error(`Perl exited with status ${status}.`));
							return;
						}
						resolve();
					} catch (error) {
						flushStdout();
						flushStderr();
						reject(error);
					}
				}
			};
			try {
				importVerifiedRuntimeScript(verified.javascriptBytes);
			} catch (error) {
				reject(error);
			}
		});
		if (log) console.log('[wasm-idle:perl-worker] run settled');
		self.postMessage({ results: true });
	} catch (error) {
		if (log) console.error('[wasm-idle:perl-worker] failed', error);
		self.postMessage({ error: error?.message || String(error) });
	}
};
