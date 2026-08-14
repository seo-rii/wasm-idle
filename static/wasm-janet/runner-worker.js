const encoder = new TextEncoder();
const fatalDecoder = new TextDecoder('utf-8', { fatal: true });
const manifestFormat = 'wasm-janet-runtime-manifest-v2';
const fingerprintDomain = 'wasm-idle:janet-runtime-manifest:v2';
const expectedProfileId = 'janet-1.41.3-dev-emscripten-3.1.8-wasm-idle-d647850c';
const expectedLicenseExpression = 'MIT';
const hardMaxAssetBytes = 8 * 1024 * 1024;
const maxManifestBytes = 128 * 1024;
const expectedArtifact = Object.freeze({
	kind: 'opaque-vendored',
	repository: 'https://github.com/seo-rii/wasm-idle.git',
	revision: 'd647850cd6448b457f778d01c304358aefa5244b',
	path: 'static/wasm-janet',
	provenance: 'legacy-import-unrecorded',
	verifiedBuildInput: false
});
const expectedComponents = Object.freeze({
	janet: Object.freeze({
		version: '1.41.3-dev',
		repository: 'https://github.com/janet-lang/janet.git',
		revision: 'unrecorded',
		verifiedBuildInput: false,
		evidence: 'embedded runtime version string'
	}),
	emscripten: Object.freeze({
		version: '3.1.8',
		repository: 'https://github.com/emscripten-core/emscripten.git',
		revision: 'unrecorded',
		verifiedBuildInput: false,
		evidence: 'unverified metadata copied from the initial vendored runtime manifest'
	})
});
const expectedBuild = Object.freeze({
	options: Object.freeze([
		'ENVIRONMENT=worker',
		'MODULARIZE=1',
		'EXPORT_ES6=1',
		'FORCE_FILESYSTEM=1',
		'INVOKE_RUN=0',
		'EXIT_RUNTIME=1',
		'JANET_REDUCED_OS'
	]),
	runner: Object.freeze({
		path: 'scripts/runtime-build/wasm-janet-runner.c',
		verifiedBuildInput: false,
		bytes: 1378,
		sha256: '1a2f357f16e250ed64260a77bd11435837ae033647fb23166eb924a42b4036ee'
	})
});
const expectedAssets = Object.freeze({
	'janet.js': Object.freeze({ mediaType: 'text/javascript' }),
	'janet.wasm': Object.freeze({ mediaType: 'application/wasm' })
});
const expectedStorage = Object.freeze({
	'janet.js': Object.freeze({ logicalPath: 'janet.js', encoding: 'identity' }),
	'janet.wasm.gz': Object.freeze({ logicalPath: 'janet.wasm', encoding: 'gzip' })
});
const expectedManifestKeys = Object.freeze(
	[
		'artifact',
		'assets',
		'build',
		'components',
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
	if (primitive === undefined) throw new Error('Janet manifest contains a non-JSON value.');
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
	const base = requireHttpUrl(baseUrl, 'Janet runtime base');
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
		throw new Error('Janet runtime integrity verification requires Web Crypto.');
	}
	const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes));
	return [...digest].map((value) => value.toString(16).padStart(2, '0')).join('');
}

async function computeFingerprint(
	profileId,
	licenseExpression,
	artifact,
	components,
	build,
	license,
	metadata,
	assets,
	storage
) {
	let canonical = `${fingerprintDomain}\nformat\0${manifestFormat}\nruntime\0janet-lang-janet\nprofileId\0${profileId}\n`;
	canonical += `licenseExpression\0${licenseExpression}\n`;
	canonical += `artifact\0${canonicalJson(artifact)}\n`;
	canonical += `components\0${canonicalJson(components)}\n`;
	canonical += `build\0${canonicalJson(build)}\n`;
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

function normalizeProvenanceObject(candidate, expected, label) {
	if (!isObject(candidate) || canonicalJson(candidate) !== canonicalJson(expected)) {
		throw new Error(`Janet runtime ${label} metadata is invalid.`);
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
		throw new Error(`Janet runtime storage receipt is invalid for ${expected.path}.`);
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
	if (!isObject(value)) throw new Error('Janet runtime manifest must be an object.');
	if (!hasExactKeys(value, expectedManifestKeys)) {
		throw new Error('Janet runtime manifest schema is invalid.');
	}
	if (value.format !== manifestFormat || value.runtime !== 'janet-lang-janet') {
		throw new Error('Janet runtime manifest format is unsupported.');
	}
	if (
		value.profileId !== expectedProfileId ||
		value.licenseExpression !== expectedLicenseExpression ||
		typeof expectedFingerprint !== 'string' ||
		!/^[a-f0-9]{64}$/u.test(expectedFingerprint)
	) {
		throw new Error('Janet runtime profile or expected fingerprint is invalid.');
	}
	if (value.fingerprint !== expectedFingerprint) {
		throw new Error('Janet runtime manifest fingerprint does not match the pinned runtime.');
	}
	const artifact = normalizeProvenanceObject(value.artifact, expectedArtifact, 'artifact');
	const components = normalizeProvenanceObject(value.components, expectedComponents, 'component');
	const build = normalizeProvenanceObject(value.build, expectedBuild, 'build');
	if (
		!hasExactKeys(value.license, expectedLicenseReceiptKeys) ||
		value.license.path !== 'LICENSE.txt' ||
		value.license.spdx !== 'MIT' ||
		!Number.isSafeInteger(value.license.size) ||
		value.license.size <= 0 ||
		value.license.size > maxAssetBytes ||
		typeof value.license.sha256 !== 'string' ||
		!/^[a-f0-9]{64}$/u.test(value.license.sha256)
	) {
		throw new Error('Janet runtime license receipt is invalid.');
	}
	const license = {
		path: value.license.path,
		spdx: value.license.spdx,
		size: value.license.size,
		sha256: value.license.sha256
	};
	const metadata = normalizeReceipt(
		value.metadata,
		{ path: 'runtime-build.json', mediaType: 'application/json' },
		maxAssetBytes,
		'Janet runtime metadata'
	);
	if (!Array.isArray(value.assets) || value.assets.length !== 2) {
		throw new Error('Janet runtime manifest must declare exactly two logical assets.');
	}
	if (!Array.isArray(value.storage) || value.storage.length !== 2) {
		throw new Error('Janet runtime manifest must declare exactly two storage assets.');
	}
	const assetByPath = new Map();
	for (const candidate of value.assets) {
		const expected = expectedAssets[candidate?.path];
		if (!expected || assetByPath.has(candidate.path)) {
			throw new Error('Janet runtime manifest has an unexpected or duplicate logical asset.');
		}
		assetByPath.set(
			candidate.path,
			normalizeReceipt(
				candidate,
				{ path: candidate.path, mediaType: expected.mediaType },
				maxAssetBytes,
				`Janet runtime asset ${candidate.path}`
			)
		);
	}
	const storageByPath = new Map();
	for (const candidate of value.storage) {
		const expected = expectedStorage[candidate?.path];
		if (!expected || storageByPath.has(candidate.path)) {
			throw new Error('Janet runtime manifest has an unexpected or duplicate storage asset.');
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
		throw new Error('Janet runtime manifest is missing a required receipt.');
	}
	const assets = [...assetByPath.values()];
	const storage = [...storageByPath.values()];
	if (
		(await computeFingerprint(
			value.profileId,
			value.licenseExpression,
			artifact,
			components,
			build,
			license,
			metadata,
			assets,
			storage
		)) !== expectedFingerprint
	) {
		throw new Error('Janet runtime receipt graph failed fingerprint verification.');
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
		throw new Error('Janet runtime gzip decompression is unavailable.');
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

async function importVerifiedRuntimeModule(bytes) {
	try {
		fatalDecoder.decode(bytes);
	} catch {
		throw new Error('Janet runtime JavaScript is not valid UTF-8.');
	}
	if (
		typeof Blob !== 'function' ||
		typeof URL.createObjectURL !== 'function' ||
		typeof URL.revokeObjectURL !== 'function'
	) {
		throw new Error('Janet verified runtime module evaluation is unavailable.');
	}
	const moduleUrl = URL.createObjectURL(new Blob([bytes], { type: 'text/javascript' }));
	try {
		return await import(moduleUrl);
	} finally {
		try {
			URL.revokeObjectURL(moduleUrl);
		} catch {
			// Blob cleanup must not replace the verified import outcome.
		}
	}
}

async function loadVerifiedJanetBytes(
	baseUrl,
	manifestUrl,
	manifestFingerprint,
	requestedMaxAssetBytes
) {
	if (!Number.isSafeInteger(requestedMaxAssetBytes) || requestedMaxAssetBytes <= 0) {
		throw new Error('Janet runtime asset byte limit is invalid.');
	}
	const maxAssetBytes = Math.min(requestedMaxAssetBytes, hardMaxAssetBytes);
	const identity = `${baseUrl}\n${manifestUrl}\n${manifestFingerprint}\n${maxAssetBytes}`;
	if (verifiedRuntimePromise) {
		if (verifiedRuntimeIdentity !== identity) {
			throw new Error('Janet worker cannot replace an initialized runtime profile.');
		}
		return await verifiedRuntimePromise;
	}
	verifiedRuntimeIdentity = identity;
	verifiedRuntimePromise = (async () => {
		const resolvedManifestUrl =
			manifestUrl || assetUrl(baseUrl, 'runtime-manifest.v2.json', manifestFingerprint);
		const manifestBytes = await fetchBoundedBytes(
			resolvedManifestUrl,
			'Janet runtime manifest',
			Math.min(maxManifestBytes, maxAssetBytes),
			undefined,
			'no-store'
		);
		let parsed;
		try {
			parsed = JSON.parse(fatalDecoder.decode(manifestBytes));
		} catch {
			throw new Error('Janet runtime manifest is not valid UTF-8 JSON.');
		}
		const manifest = await normalizeManifest(parsed, manifestFingerprint, maxAssetBytes);
		const logicalBytesByPath = new Map();
		for (const storagePath of Object.keys(expectedStorage).sort()) {
			const storageReceipt = manifest.storageByPath.get(storagePath);
			const logicalReceipt = manifest.assetByPath.get(storageReceipt.logicalPath);
			const transportedBytes = await fetchBoundedBytes(
				assetUrl(baseUrl, storagePath, manifestFingerprint),
				`Janet runtime storage ${storagePath}`,
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
								`Janet runtime asset ${logicalReceipt.path}`
							)
						: transportedBytes;
			} else if (
				storageReceipt.encoding === 'gzip' &&
				(await receiptMatchesBytes(logicalReceipt, transportedBytes))
			) {
				// Browsers may transparently decode a gzip Content-Encoding response.
				logicalBytes = transportedBytes;
			} else {
				throw new Error(
					`Janet runtime storage ${storagePath} failed SHA-256 verification.`
				);
			}
			await verifyReceiptBytes(
				logicalReceipt,
				logicalBytes,
				`Janet runtime asset ${logicalReceipt.path}`
			);
			logicalBytesByPath.set(logicalReceipt.path, logicalBytes);
		}
		return Object.freeze({
			javascriptBytes: logicalBytesByPath.get('janet.js'),
			wasmBytes: logicalBytesByPath.get('janet.wasm')
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

function createSharedInputReader(channel) {
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
		throw new Error('Invalid Janet streaming stdin channel.');
	}

	const control = new Int32Array(channel.buffer, 0, 4);
	const bytes = new Uint8Array(channel.buffer, channel.controlBytes, channel.capacity);
	return () => {
		while (true) {
			if (Atomics.load(control, 3) === 1) {
				throw new Error('Janet streaming stdin was cancelled.');
			}
			const write = Atomics.load(control, 0);
			const read = Atomics.load(control, 1);
			const available = write - read;
			if (available < 0 || available > bytes.byteLength) {
				throw new Error('Janet streaming stdin counters are invalid.');
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

function createInputReader(stdin, channel) {
	const sharedReader = createSharedInputReader(channel);
	if (sharedReader) return sharedReader;
	const bytes = encoder.encode(typeof stdin === 'string' ? stdin : '');
	let offset = 0;
	return () => (offset >= bytes.byteLength ? null : bytes[offset++]);
}

function createCharOutput(onOutput) {
	const decoder = new TextDecoder();
	let bytes = [];
	return (value) => {
		if (value === null || value === 10) {
			const text = decoder.decode(new Uint8Array(bytes));
			bytes = [];
			if (text) onOutput(text);
			return;
		}
		if (value !== 0) bytes.push(value);
	};
}

function postOutput(lines) {
	const output = lines.filter(Boolean).join('\n');
	if (output) self.postMessage({ output: output.endsWith('\n') ? output : `${output}\n` });
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
	const stderr = [];
	try {
		if (log) console.log(`[wasm-idle:janet-worker] run start baseUrl=${baseUrl}`);
		const verified = await loadVerifiedJanetBytes(
			baseUrl,
			manifestUrl,
			manifestFingerprint,
			maxAssetBytes
		);
		if (runtimeEvaluationStarted) {
			throw new Error('Janet worker cannot execute more than one runtime instance.');
		}
		runtimeEvaluationStarted = true;
		const runtimeModule = await importVerifiedRuntimeModule(verified.javascriptBytes);
		const createModule = runtimeModule.default || runtimeModule;
		if (typeof createModule !== 'function') {
			throw new Error('Janet runtime module did not export an Emscripten module factory.');
		}
		const readStdin = createInputReader(stdin, stdinChannel);
		const writeStdout = createCharOutput((message) => postOutput([message]));
		const writeStderr = createCharOutput((message) => stderr.push(message));
		const module = await createModule({
			locateFile(path) {
				if (path !== 'janet.wasm') {
					throw new Error(`Janet requested an undeclared runtime asset: ${path}`);
				}
				return 'wasm-idle-verified:janet.wasm';
			},
			print: (message) => postOutput([String(message)]),
			printErr: (message) => stderr.push(String(message)),
			preRun: [(runtime) => runtime.FS.init(readStdin, writeStdout, writeStderr)],
			stdin: readStdin,
			wasmBinary: verified.wasmBytes
		});
		const sourcePath = `/${activePath || 'main.janet'}`;
		module.FS.writeFile(sourcePath, String(code || ''));
		const status = module.callMain([sourcePath]);
		if (stderr.length > 0 || status !== 0) {
			throw new Error(stderr.join('\n') || `Janet exited with status ${status}.`);
		}
		if (log) console.log('[wasm-idle:janet-worker] run settled');
		self.postMessage({ results: true });
	} catch (error) {
		const message = stderr.length > 0 ? stderr.join('\n') : error?.message || String(error);
		if (log) console.error('[wasm-idle:janet-worker] failed', error);
		self.postMessage({ error: message });
	}
};
