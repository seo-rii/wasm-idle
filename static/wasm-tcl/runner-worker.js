const encoder = new TextEncoder();
const fatalDecoder = new TextDecoder('utf-8', { fatal: true });
const manifestFormat = 'wasm-tcl-runtime-manifest-v2';
const fingerprintDomain = 'wasm-idle:tcl-runtime-manifest:v2';
const hardMaxAssetBytes = 16 * 1024 * 1024;
const maxManifestBytes = 64 * 1024;
const expectedProfileId = 'wacl-pages-045aa904-tcl-8.6.6';
const expectedArtifact = Object.freeze({
	kind: 'opaque-prebuilt',
	path: 'wacl/releases/wacl.zip',
	repository: 'https://github.com/ecky-l/ecky-l.github.io.git',
	revision: '045aa904c2073eeded1be803cf5416901f6ce8ee',
	sha256: '50d4ecb40c4db0448942332f9562c3cedc8bea38fa89d95ca5e5b9afcc5afb23',
	size: 1350907,
	url: 'https://raw.githubusercontent.com/ecky-l/ecky-l.github.io/045aa904c2073eeded1be803cf5416901f6ce8ee/wacl/releases/wacl.zip'
});
const expectedComponents = Object.freeze({
	emscripten: Object.freeze({
		revision: 'f1222cc8c315e47ba3541a42ab391bd3b1d9be14',
		verifiedBuildInput: false,
		version: '1.37.9'
	}),
	requirejs: Object.freeze({
		revision: 'f2335026867afd80c394247bfe5278d2bd8f32ee',
		verifiedBuildInput: false,
		version: '2.3.3'
	}),
	rlJson: Object.freeze({
		revision: '89ae2c67fc6023b3e0886ff5d2850dcde127a1c1',
		verifiedBuildInput: false,
		version: '0.9.7'
	}),
	tcl: Object.freeze({
		revision: '27696b490b9b339a869a8f6fe3113d05ebcbf565',
		verifiedBuildInput: false,
		version: '8.6.6'
	}),
	tcllib: Object.freeze({
		revision: '700ee122b5c26243929831b242897ea7170c7015',
		verifiedBuildInput: false,
		version: '1.18'
	}),
	tdom: Object.freeze({
		revision: '5a0a14aeb9321e50532af6c18ef4d05e44b158c8',
		verifiedBuildInput: false,
		version: '0.8.3'
	}),
	wacl: Object.freeze({
		repository: 'https://github.com/ecky-l/wacl.git',
		revision: '9daacabb0102a9986f33263261350edfeebdd83b',
		verifiedBuildInput: false,
		version: '2017-05-29'
	})
});
const expectedPatches = Object.freeze([
	Object.freeze({ id: 'inject-verified-wasm' }),
	Object.freeze({ id: 'inject-host-module' }),
	Object.freeze({ id: 'preserve-host-output' }),
	Object.freeze({ id: 'preserve-host-error-output' }),
	Object.freeze({ id: 'guard-window-cleanup' })
]);
const expectedLicenseMetadata = Object.freeze({
	'licenses/REQUIREJS.txt': Object.freeze({
		spdx: 'MIT'
	}),
	'licenses/TCL.txt': Object.freeze({
		spdx: 'TCL'
	}),
	'licenses/WACL.txt': Object.freeze({
		spdx: 'BSD-3-Clause'
	})
});
const expectedManifestKeys = Object.freeze(
	[
		'artifact',
		'assets',
		'components',
		'fingerprint',
		'format',
		'licenses',
		'metadata',
		'patches',
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
const expectedAssets = Object.freeze({
	'require.js': Object.freeze({ mediaType: 'text/javascript' }),
	'tcl/wacl-custom.data': Object.freeze({ mediaType: 'application/octet-stream' }),
	'tcl/wacl-library.data': Object.freeze({ mediaType: 'application/octet-stream' }),
	'tcl/wacl.js': Object.freeze({ mediaType: 'text/javascript' }),
	'tcl/wacl.wasm': Object.freeze({ mediaType: 'application/wasm' })
});
const expectedStorage = Object.freeze({
	'require.js': Object.freeze({ logicalPath: 'require.js', encoding: 'identity' }),
	'tcl/wacl-custom.data': Object.freeze({
		logicalPath: 'tcl/wacl-custom.data',
		encoding: 'identity'
	}),
	'tcl/wacl-library.data.gz': Object.freeze({
		logicalPath: 'tcl/wacl-library.data',
		encoding: 'gzip'
	}),
	'tcl/wacl.js': Object.freeze({ logicalPath: 'tcl/wacl.js', encoding: 'identity' }),
	'tcl/wacl.wasm.gz': Object.freeze({ logicalPath: 'tcl/wacl.wasm', encoding: 'gzip' })
});
const verifiedWasmGluePatch =
	'var _wasmbly=Promise.resolve(typeof self!=="undefined"&&self.Module&&self.Module["wasmBinary"]||(function(){throw new Error("Verified Wacl Wasm was not provided.")})());';

let verifiedRuntimePromise = null;
let verifiedRuntimeIdentity = '';
let activeStdinReader = () => null;
let activeOutputWriter = () => undefined;

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
	const base = requireHttpUrl(baseUrl, 'Wacl Tcl runtime base');
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
		throw new Error('Wacl Tcl runtime integrity verification requires Web Crypto.');
	}
	const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes));
	return [...digest].map((value) => value.toString(16).padStart(2, '0')).join('');
}

function canonicalValue(kind, value) {
	if (Array.isArray(value)) {
		return [...value]
			.sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)))
			.map((entry) => `${kind}\0${JSON.stringify(entry)}\n`)
			.join('');
	}
	return Object.entries(value)
		.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
		.map(([name, entry]) => `${kind}\0${name}\0${JSON.stringify(entry)}\n`)
		.join('');
}

async function computeFingerprint(
	profileId,
	artifact,
	components,
	patches,
	licenses,
	metadata,
	assets,
	storage
) {
	let canonical = `${fingerprintDomain}\nformat\0${manifestFormat}\nruntime\0wacl\nprofileId\0${profileId}\n`;
	canonical += canonicalValue('artifact', artifact);
	canonical += canonicalValue('component', components);
	canonical += canonicalValue('patch', patches);
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

function normalizeExactObject(candidate, expected, label) {
	if (
		!candidate ||
		typeof candidate !== 'object' ||
		Array.isArray(candidate) ||
		JSON.stringify(Object.keys(candidate).sort()) !==
			JSON.stringify(Object.keys(expected).sort()) ||
		Object.entries(expected).some(([name, value]) => candidate[name] !== value)
	) {
		throw new Error(`Wacl Tcl runtime ${label} metadata is invalid.`);
	}
	return { ...candidate };
}

function normalizeComponents(candidate) {
	if (
		!candidate ||
		typeof candidate !== 'object' ||
		Array.isArray(candidate) ||
		JSON.stringify(Object.keys(candidate).sort()) !==
			JSON.stringify(Object.keys(expectedComponents).sort())
	) {
		throw new Error('Wacl Tcl runtime component metadata is invalid.');
	}
	const components = {};
	for (const [name, expected] of Object.entries(expectedComponents)) {
		components[name] = normalizeExactObject(candidate[name], expected, `component ${name}`);
	}
	return components;
}

function normalizePatches(candidate) {
	if (
		!Array.isArray(candidate) ||
		candidate.length !== expectedPatches.length ||
		candidate.some(
			(entry) =>
				!entry ||
				typeof entry !== 'object' ||
				Array.isArray(entry) ||
				Object.keys(entry).length !== 1 ||
				typeof entry.id !== 'string'
		) ||
		JSON.stringify([...candidate].sort((left, right) => left.id.localeCompare(right.id))) !==
			JSON.stringify(
				[...expectedPatches].sort((left, right) => left.id.localeCompare(right.id))
			)
	) {
		throw new Error('Wacl Tcl runtime patch metadata is invalid.');
	}
	return candidate.map((entry) => ({ id: entry.id }));
}

function normalizeReceipt(candidate, expected, maxAssetBytes, label) {
	if (
		!candidate ||
		typeof candidate !== 'object' ||
		Array.isArray(candidate) ||
		JSON.stringify(Object.keys(candidate).sort()) !== JSON.stringify(expectedReceiptKeys) ||
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
		JSON.stringify(Object.keys(candidate).sort()) !==
			JSON.stringify(expectedStorageReceiptKeys) ||
		candidate.path !== expected.path ||
		candidate.logicalPath !== expected.logicalPath ||
		candidate.encoding !== expected.encoding ||
		!Number.isSafeInteger(candidate.size) ||
		candidate.size <= 0 ||
		candidate.size > maxAssetBytes ||
		typeof candidate.sha256 !== 'string' ||
		!/^[a-f0-9]{64}$/u.test(candidate.sha256)
	) {
		throw new Error(`Wacl Tcl runtime storage receipt is invalid for ${expected.path}.`);
	}
	return {
		path: expected.path,
		logicalPath: expected.logicalPath,
		encoding: expected.encoding,
		size: candidate.size,
		sha256: candidate.sha256
	};
}

function normalizeLicenses(candidate, maxAssetBytes) {
	if (
		!Array.isArray(candidate) ||
		candidate.length !== Object.keys(expectedLicenseMetadata).length
	) {
		throw new Error('Wacl Tcl runtime must declare its pinned component licenses.');
	}
	const paths = new Set();
	return candidate.map((entry) => {
		const expected = expectedLicenseMetadata[entry?.path];
		if (
			!entry ||
			typeof entry !== 'object' ||
			Array.isArray(entry) ||
			!expected ||
			JSON.stringify(Object.keys(entry).sort()) !==
				JSON.stringify(['path', 'sha256', 'size', 'spdx']) ||
			paths.has(entry.path) ||
			entry.spdx !== expected.spdx ||
			!Number.isSafeInteger(entry.size) ||
			entry.size <= 0 ||
			entry.size > maxAssetBytes ||
			typeof entry.sha256 !== 'string' ||
			!/^[a-f0-9]{64}$/u.test(entry.sha256)
		) {
			throw new Error('Wacl Tcl runtime license receipt is invalid.');
		}
		paths.add(entry.path);
		return {
			path: entry.path,
			spdx: entry.spdx,
			size: entry.size,
			sha256: entry.sha256
		};
	});
}

async function normalizeManifest(value, expectedFingerprint, maxAssetBytes) {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error('Wacl Tcl runtime manifest must be an object.');
	}
	if (value.format !== manifestFormat || value.runtime !== 'wacl') {
		throw new Error('Wacl Tcl runtime manifest format is unsupported.');
	}
	if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(expectedManifestKeys)) {
		throw new Error('Wacl Tcl runtime manifest schema is invalid.');
	}
	if (
		value.profileId !== expectedProfileId ||
		typeof expectedFingerprint !== 'string' ||
		!/^[a-f0-9]{64}$/u.test(expectedFingerprint)
	) {
		throw new Error('Wacl Tcl runtime profile or expected fingerprint is invalid.');
	}
	if (value.fingerprint !== expectedFingerprint) {
		throw new Error('Wacl Tcl runtime manifest fingerprint does not match the pinned runtime.');
	}
	const artifact = normalizeExactObject(value.artifact, expectedArtifact, 'artifact');
	const components = normalizeComponents(value.components);
	const patches = normalizePatches(value.patches);
	const licenses = normalizeLicenses(value.licenses, maxAssetBytes);
	const metadata = normalizeReceipt(
		value.metadata,
		{ path: 'runtime-build.json', mediaType: 'application/json' },
		maxAssetBytes,
		'Wacl Tcl runtime metadata'
	);
	if (!Array.isArray(value.assets) || value.assets.length !== 5) {
		throw new Error('Wacl Tcl runtime manifest must declare exactly five logical assets.');
	}
	if (!Array.isArray(value.storage) || value.storage.length !== 5) {
		throw new Error('Wacl Tcl runtime manifest must declare exactly five storage assets.');
	}
	const assetByPath = new Map();
	for (const candidate of value.assets) {
		const expected = expectedAssets[candidate?.path];
		if (!expected || assetByPath.has(candidate.path)) {
			throw new Error(
				'Wacl Tcl runtime manifest has an unexpected or duplicate logical asset.'
			);
		}
		assetByPath.set(
			candidate.path,
			normalizeReceipt(
				candidate,
				{ path: candidate.path, mediaType: expected.mediaType },
				maxAssetBytes,
				`Wacl Tcl runtime asset ${candidate.path}`
			)
		);
	}
	const storageByPath = new Map();
	for (const candidate of value.storage) {
		const expected = expectedStorage[candidate?.path];
		if (!expected || storageByPath.has(candidate.path)) {
			throw new Error(
				'Wacl Tcl runtime manifest has an unexpected or duplicate storage asset.'
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
		throw new Error('Wacl Tcl runtime manifest is missing a required asset.');
	}
	const assets = [...assetByPath.values()];
	const storage = [...storageByPath.values()];
	if (
		(await computeFingerprint(
			value.profileId,
			artifact,
			components,
			patches,
			licenses,
			metadata,
			assets,
			storage
		)) !== expectedFingerprint
	) {
		throw new Error('Wacl Tcl runtime receipt graph failed fingerprint verification.');
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
		throw new Error('Wacl Tcl runtime gzip decompression is unavailable.');
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

function importVerifiedScript(bytes, label) {
	let source;
	try {
		source = fatalDecoder.decode(bytes);
	} catch {
		throw new Error(`${label} is not valid UTF-8 JavaScript.`);
	}
	if (
		typeof Blob !== 'function' ||
		typeof URL.createObjectURL !== 'function' ||
		typeof URL.revokeObjectURL !== 'function' ||
		typeof importScripts !== 'function'
	) {
		throw new Error('Wacl Tcl verified runtime evaluation is unavailable.');
	}
	const scriptUrl = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
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

function createRequireModule(moduleName) {
	return new Promise((resolve, reject) => {
		const requirejs = self.requirejs || self.require;
		if (!requirejs) {
			reject(new Error('Verified RequireJS did not initialize.'));
			return;
		}
		requirejs([moduleName], resolve, reject);
	});
}

function waitForWacl(wacl) {
	return new Promise((resolve) => {
		wacl.onReady((interp) => resolve(interp));
	});
}

function tclUtf8Expression(value) {
	const bytes = encoder.encode(value);
	const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
	return `[::encoding convertfrom utf-8 [::binary decode hex {${hex}}]]`;
}

function configureTclArguments(interp, activePath, args) {
	const argv = args.map(tclUtf8Expression);
	interp.Eval(
		`::set ::argv0 ${tclUtf8Expression(activePath)}; ::set ::argc ${args.length}; ::set ::argv [::list${argv.length ? ` ${argv.join(' ')}` : ''}]`
	);
}

async function createVerifiedWaclRuntime(
	baseUrl,
	manifestUrl,
	manifestFingerprint,
	requestedMaxAssetBytes,
	initialArguments
) {
	if (!Number.isSafeInteger(requestedMaxAssetBytes) || requestedMaxAssetBytes <= 0) {
		throw new Error('Wacl Tcl runtime asset byte limit is invalid.');
	}
	const maxAssetBytes = Math.min(requestedMaxAssetBytes, hardMaxAssetBytes);
	const identity = `${baseUrl}\n${manifestUrl}\n${manifestFingerprint}\n${maxAssetBytes}`;
	if (verifiedRuntimePromise) {
		if (verifiedRuntimeIdentity !== identity) {
			throw new Error('Wacl Tcl worker cannot replace an initialized runtime profile.');
		}
		return await verifiedRuntimePromise;
	}
	verifiedRuntimeIdentity = identity;
	verifiedRuntimePromise = (async () => {
		const resolvedManifestUrl =
			manifestUrl || assetUrl(baseUrl, 'runtime-manifest.v2.json', manifestFingerprint);
		const manifestBytes = await fetchBoundedBytes(
			resolvedManifestUrl,
			'Wacl Tcl runtime manifest',
			Math.min(maxManifestBytes, maxAssetBytes),
			undefined,
			'no-store'
		);
		let parsed;
		try {
			parsed = JSON.parse(fatalDecoder.decode(manifestBytes));
		} catch {
			throw new Error('Wacl Tcl runtime manifest is not valid UTF-8 JSON.');
		}
		const manifest = await normalizeManifest(parsed, manifestFingerprint, maxAssetBytes);
		const logicalBytesByPath = new Map();
		for (const storagePath of Object.keys(expectedStorage).sort()) {
			const storageReceipt = manifest.storageByPath.get(storagePath);
			const logicalReceipt = manifest.assetByPath.get(storageReceipt.logicalPath);
			const transportedBytes = await fetchBoundedBytes(
				assetUrl(baseUrl, storagePath, manifestFingerprint),
				`Wacl Tcl runtime storage ${storagePath}`,
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
								`Wacl Tcl runtime asset ${logicalReceipt.path}`
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
					`Wacl Tcl runtime storage ${storagePath} failed SHA-256 verification.`
				);
			}
			await verifyReceiptBytes(
				logicalReceipt,
				logicalBytes,
				`Wacl Tcl runtime asset ${logicalReceipt.path}`
			);
			logicalBytesByPath.set(logicalReceipt.path, logicalBytes);
		}

		const requireBytes = logicalBytesByPath.get('require.js');
		const glueBytes = logicalBytesByPath.get('tcl/wacl.js');
		let glueSource;
		try {
			glueSource = fatalDecoder.decode(glueBytes);
		} catch {
			throw new Error('Wacl Tcl runtime glue is not valid UTF-8 JavaScript.');
		}
		if (
			!glueSource.startsWith('define("tcl/wacl",') ||
			!glueSource.includes(verifiedWasmGluePatch)
		) {
			throw new Error('Wacl Tcl runtime glue is missing the verified Wasm bootstrap patch.');
		}
		const packageBytes = new Map([
			['wacl-custom.data', logicalBytesByPath.get('tcl/wacl-custom.data')],
			['wacl-library.data', logicalBytesByPath.get('tcl/wacl-library.data')]
		]);
		globalThis.Module = {
			arguments: [...initialArguments],
			noExitRuntime: true,
			wasmBinary: logicalBytesByPath.get('tcl/wacl.wasm'),
			stdin() {
				return activeStdinReader();
			},
			stdout(codePoint) {
				activeOutputWriter(codePoint);
			},
			stderr(codePoint) {
				activeOutputWriter(codePoint);
			},
			print(text) {
				postOutput(normalizeOutput(String(text)));
			},
			printErr(text) {
				postOutput(normalizeOutput(String(text)));
			},
			locateFile(path) {
				if (!packageBytes.has(path)) {
					throw new Error(`Wacl Tcl requested an undeclared runtime asset: ${path}`);
				}
				return `wasm-idle-verified:tcl/${path}`;
			},
			getPreloadedPackage(packageName, packageSize) {
				const prefix = 'wasm-idle-verified:tcl/';
				const path =
					typeof packageName === 'string' && packageName.startsWith(prefix)
						? packageName.slice(prefix.length)
						: '';
				const bytes = packageBytes.get(path);
				if (!bytes || packageSize !== bytes.byteLength) {
					throw new Error('Wacl Tcl requested an unexpected preloaded package.');
				}
				return bytes.slice().buffer;
			}
		};
		importVerifiedScript(requireBytes, 'Wacl Tcl RequireJS');
		const requirejs = self.requirejs || self.require;
		if (!requirejs || typeof requirejs.config !== 'function') {
			throw new Error('Verified RequireJS did not expose its configuration API.');
		}
		requirejs.config({ baseUrl, enforceDefine: true });
		requirejs.load = () => {
			throw new Error('Wacl Tcl runtime refused an undeclared RequireJS module load.');
		};
		importVerifiedScript(glueBytes, 'Wacl Tcl runtime glue');
		const wacl = await createRequireModule('tcl/wacl');
		return await waitForWacl(wacl);
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
		throw new Error('Invalid Wacl Tcl streaming stdin channel.');
	}

	const control = new Int32Array(channel.buffer, 0, 4);
	const bytes = new Uint8Array(channel.buffer, channel.controlBytes, channel.capacity);
	return () => {
		while (true) {
			if (Atomics.load(control, 3) === 1) {
				throw new Error('Wacl Tcl streaming stdin was cancelled.');
			}
			const write = Atomics.load(control, 0);
			const read = Atomics.load(control, 1);
			const available = write - read;
			if (available < 0 || available > bytes.byteLength) {
				throw new Error('Wacl Tcl streaming stdin counters are invalid.');
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
	return () => {
		if (offset >= bytes.byteLength) return null;
		const value = bytes[offset];
		offset += 1;
		return value;
	};
}

function createOutputWriter(postOutput) {
	let buffer = '';
	return (codePoint) => {
		if (codePoint === null || codePoint === 10) {
			if (codePoint === 10) buffer += '\n';
			if (buffer) {
				postOutput(buffer);
				buffer = '';
			}
			return;
		}
		buffer += String.fromCharCode(codePoint);
	};
}

function normalizeOutput(text) {
	if (!text) return '';
	return text.endsWith('\n') ? text : `${text}\n`;
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
		activePath = 'main.tcl',
		log
	} = event.data || {};
	const output = (text) => postOutput(text);
	try {
		if (log) console.log(`[wasm-idle:tcl-worker] run start baseUrl=${baseUrl}`);
		if (
			typeof activePath !== 'string' ||
			!Array.isArray(args) ||
			args.some((argument) => typeof argument !== 'string')
		) {
			throw new Error('Wacl Tcl run path and arguments must be strings.');
		}
		activeStdinReader = createStdinReader(stdin, stdinChannel);
		activeOutputWriter = createOutputWriter(output);
		const interp = await createVerifiedWaclRuntime(
			baseUrl,
			manifestUrl,
			manifestFingerprint,
			maxAssetBytes,
			[activePath, ...args]
		);
		globalThis.Module.arguments = [activePath, ...args];
		configureTclArguments(interp, activePath, args);
		interp.stdout = (text) => output(normalizeOutput(String(text)));
		interp.stderr = (text) => output(normalizeOutput(String(text)));
		try {
			const result = interp.Eval(code);
			if (result) output(normalizeOutput(String(result)));
		} catch (error) {
			const tclMessage = error?.errorInfo || error?.message || String(error);
			throw new Error(tclMessage);
		}
		if (log) console.log('[wasm-idle:tcl-worker] run settled');
		self.postMessage({ results: true });
	} catch (error) {
		if (log) console.error('[wasm-idle:tcl-worker] failed', error);
		self.postMessage({ error: error?.message || String(error) });
	} finally {
		activeStdinReader = () => null;
		activeOutputWriter = () => undefined;
	}
};
