const encoder = new TextEncoder();
const fatalDecoder = new TextDecoder('utf-8', { fatal: true });
const preflightProtocol = 'wasm-idle-tcl-preflight';
const preflightProtocolVersion = 1;
const manifestFormat = 'wasm-tcl-runtime-manifest-v2';
const fingerprintDomain = 'wasm-idle:tcl-runtime-manifest:v2';
const hardMaxAssetBytes = 16 * 1024 * 1024;
const hardMaxTotalLogicalBytes = 32 * 1024 * 1024;
const maxManifestBytes = 64 * 1024;
const verifiedRequireBaseUrl = 'wasm-idle-verified:tcl/';
const expectedIdentity = Object.freeze({
	profileId: 'wacl-pages-045aa904-tcl-8.6.6',
	artifactRevision: '045aa904c2073eeded1be803cf5416901f6ce8ee',
	waclRevision: '9daacabb0102a9986f33263261350edfeebdd83b',
	tclRevision: '27696b490b9b339a869a8f6fe3113d05ebcbf565',
	requireJsRevision: 'f2335026867afd80c394247bfe5278d2bd8f32ee',
	emscriptenRevision: 'f1222cc8c315e47ba3541a42ab391bd3b1d9be14',
	manifestFingerprint: '4687ad97c5bb5e96d4354a24e9faffeb9dc9eb1ee7e8c9b0c0ea289c5d9a2baa'
});
const expectedArtifact = Object.freeze({
	kind: 'opaque-prebuilt',
	path: 'wacl/releases/wacl.zip',
	repository: 'https://github.com/ecky-l/ecky-l.github.io.git',
	revision: expectedIdentity.artifactRevision,
	sha256: '50d4ecb40c4db0448942332f9562c3cedc8bea38fa89d95ca5e5b9afcc5afb23',
	size: 1350907,
	url: 'https://raw.githubusercontent.com/ecky-l/ecky-l.github.io/045aa904c2073eeded1be803cf5416901f6ce8ee/wacl/releases/wacl.zip'
});
const expectedComponents = Object.freeze({
	emscripten: Object.freeze({
		revision: expectedIdentity.emscriptenRevision,
		verifiedBuildInput: false,
		version: '1.37.9'
	}),
	requirejs: Object.freeze({
		revision: expectedIdentity.requireJsRevision,
		verifiedBuildInput: false,
		version: '2.3.3'
	}),
	rlJson: Object.freeze({
		revision: '89ae2c67fc6023b3e0886ff5d2850dcde127a1c1',
		verifiedBuildInput: false,
		version: '0.9.7'
	}),
	tcl: Object.freeze({
		revision: expectedIdentity.tclRevision,
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
		revision: expectedIdentity.waclRevision,
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
	'licenses/REQUIREJS.txt': Object.freeze({ spdx: 'MIT' }),
	'licenses/TCL.txt': Object.freeze({ spdx: 'TCL' }),
	'licenses/WACL.txt': Object.freeze({ spdx: 'BSD-3-Clause' })
});
const expectedAssets = Object.freeze({
	'require.js': Object.freeze({ mediaType: 'text/javascript' }),
	'tcl/wacl-custom.data': Object.freeze({ mediaType: 'application/octet-stream' }),
	'tcl/wacl-library.data': Object.freeze({ mediaType: 'application/octet-stream' }),
	'tcl/wacl.js': Object.freeze({ mediaType: 'text/javascript' }),
	'tcl/wacl.wasm': Object.freeze({ mediaType: 'application/wasm' })
});
const expectedStorage = Object.freeze({
	'require.js': Object.freeze({ logicalPath: 'require.js', encoding: 'identity' }),
	'tcl/wacl-custom.data.bin': Object.freeze({
		logicalPath: 'tcl/wacl-custom.data',
		encoding: 'identity'
	}),
	'tcl/wacl-library.data.gz.bin': Object.freeze({
		logicalPath: 'tcl/wacl-library.data',
		encoding: 'gzip'
	}),
	'tcl/wacl.js': Object.freeze({ logicalPath: 'tcl/wacl.js', encoding: 'identity' }),
	'tcl/wacl.wasm.gz.bin': Object.freeze({
		logicalPath: 'tcl/wacl.wasm',
		encoding: 'gzip'
	})
});
const preflightKeys = Object.freeze(
	[
		'artifactRevision',
		'customDataBytes',
		'emscriptenRevision',
		'glueBytes',
		'libraryDataBytes',
		'manifestBytes',
		'manifestFingerprint',
		'profileId',
		'protocol',
		'protocolVersion',
		'requireJsBytes',
		'requireJsRevision',
		'tclRevision',
		'waclRevision',
		'wasmBytes'
	].sort()
);
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
const managedGlobalNames = Object.freeze(['Module', 'define', 'require', 'requirejs']);
const verifiedWasmGluePatch =
	'var _wasmbly=Promise.resolve(typeof self!=="undefined"&&self.Module&&self.Module["wasmBinary"]||(function(){throw new Error("Verified Wacl Wasm was not provided.")})());';

let verifiedRuntimePromise = null;
let verifiedRuntimeIdentity = '';
let runtimePoisoned = false;
let requestConsumed = false;
let activeStdinReader = () => null;
let activeOutputWriter = () => undefined;

function hasExactKeys(value, expectedKeys) {
	const keys = Object.keys(value).sort();
	return (
		keys.length === expectedKeys.length &&
		keys.every((key, index) => key === expectedKeys[index])
	);
}

function isUint8Array(value) {
	return (
		ArrayBuffer.isView(value) &&
		value.buffer instanceof ArrayBuffer &&
		Object.prototype.toString.call(value) === '[object Uint8Array]'
	);
}

function errorMessage(error) {
	return error?.message || String(error);
}

function requireRuntimePreflight(runtimePreflight, requestedMaxAssetBytes) {
	if (!Number.isSafeInteger(requestedMaxAssetBytes) || requestedMaxAssetBytes <= 0) {
		throw new Error('Wacl Tcl runtime asset byte limit is invalid.');
	}
	const maxAssetBytes = Math.min(requestedMaxAssetBytes, hardMaxAssetBytes);
	if (
		!runtimePreflight ||
		typeof runtimePreflight !== 'object' ||
		Array.isArray(runtimePreflight) ||
		!hasExactKeys(runtimePreflight, preflightKeys)
	) {
		throw new Error('Wacl Tcl runtime preflight payload has an invalid shape.');
	}
	if (
		runtimePreflight.protocol !== preflightProtocol ||
		runtimePreflight.protocolVersion !== preflightProtocolVersion ||
		runtimePreflight.profileId !== expectedIdentity.profileId ||
		runtimePreflight.artifactRevision !== expectedIdentity.artifactRevision ||
		runtimePreflight.waclRevision !== expectedIdentity.waclRevision ||
		runtimePreflight.tclRevision !== expectedIdentity.tclRevision ||
		runtimePreflight.requireJsRevision !== expectedIdentity.requireJsRevision ||
		runtimePreflight.emscriptenRevision !== expectedIdentity.emscriptenRevision ||
		runtimePreflight.manifestFingerprint !== expectedIdentity.manifestFingerprint ||
		!isUint8Array(runtimePreflight.manifestBytes) ||
		!isUint8Array(runtimePreflight.requireJsBytes) ||
		!isUint8Array(runtimePreflight.customDataBytes) ||
		!isUint8Array(runtimePreflight.libraryDataBytes) ||
		!isUint8Array(runtimePreflight.glueBytes) ||
		!isUint8Array(runtimePreflight.wasmBytes)
	) {
		throw new Error('Wacl Tcl runtime preflight payload is invalid.');
	}
	for (const [label, bytes, limit] of [
		[
			'Wacl Tcl runtime manifest',
			runtimePreflight.manifestBytes,
			Math.min(maxManifestBytes, maxAssetBytes)
		],
		['Wacl Tcl RequireJS', runtimePreflight.requireJsBytes, maxAssetBytes],
		['Wacl Tcl custom data', runtimePreflight.customDataBytes, maxAssetBytes],
		['Wacl Tcl library data', runtimePreflight.libraryDataBytes, maxAssetBytes],
		['Wacl Tcl runtime glue', runtimePreflight.glueBytes, maxAssetBytes],
		['Wacl Tcl Wasm', runtimePreflight.wasmBytes, maxAssetBytes]
	]) {
		if (bytes.byteLength <= 0 || bytes.byteLength > limit) {
			throw new Error(`${label} exceeds its byte limit.`);
		}
	}
	const totalLogicalBytes = [
		runtimePreflight.requireJsBytes,
		runtimePreflight.customDataBytes,
		runtimePreflight.libraryDataBytes,
		runtimePreflight.glueBytes,
		runtimePreflight.wasmBytes
	].reduce((total, bytes) => total + bytes.byteLength, 0);
	if (totalLogicalBytes > hardMaxTotalLogicalBytes) {
		throw new Error('Wacl Tcl runtime logical payload exceeds its aggregate byte limit.');
	}
	return { runtimePreflight, maxAssetBytes };
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
			.sort((left, right) => {
				const leftValue = JSON.stringify(left);
				const rightValue = JSON.stringify(right);
				return leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0;
			})
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
		!hasExactKeys(candidate, Object.keys(expected).sort()) ||
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
		!hasExactKeys(candidate, Object.keys(expectedComponents).sort())
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
				!hasExactKeys(entry, ['id']) ||
				typeof entry.id !== 'string'
		) ||
		JSON.stringify([...candidate].sort((left, right) => (left.id < right.id ? -1 : 1))) !==
			JSON.stringify(
				[...expectedPatches].sort((left, right) => (left.id < right.id ? -1 : 1))
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
		!candidate ||
		typeof candidate !== 'object' ||
		Array.isArray(candidate) ||
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
			!hasExactKeys(entry, ['path', 'sha256', 'size', 'spdx']) ||
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

async function normalizeManifest(value, runtimePreflight, maxAssetBytes) {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error('Wacl Tcl runtime manifest must be an object.');
	}
	if (value.format !== manifestFormat || value.runtime !== 'wacl') {
		throw new Error('Wacl Tcl runtime manifest format is unsupported.');
	}
	if (!hasExactKeys(value, expectedManifestKeys)) {
		throw new Error('Wacl Tcl runtime manifest schema is invalid.');
	}
	if (
		value.profileId !== runtimePreflight.profileId ||
		value.fingerprint !== runtimePreflight.manifestFingerprint
	) {
		throw new Error('Wacl Tcl runtime manifest identity does not match its preflight payload.');
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
	for (const receipt of storageByPath.values()) {
		const logicalReceipt = assetByPath.get(receipt.logicalPath);
		if (
			receipt.encoding === 'identity' &&
			(receipt.size !== logicalReceipt.size || receipt.sha256 !== logicalReceipt.sha256)
		) {
			throw new Error(
				`Wacl Tcl runtime identity storage receipt does not match ${receipt.logicalPath}.`
			);
		}
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
		)) !== runtimePreflight.manifestFingerprint
	) {
		throw new Error('Wacl Tcl runtime receipt graph failed fingerprint verification.');
	}
	return { assetByPath };
}

async function verifyReceiptBytes(receipt, bytes, label) {
	if (bytes.byteLength !== receipt.size) {
		throw new Error(`${label} has an unexpected byte size.`);
	}
	if ((await sha256Hex(bytes)) !== receipt.sha256) {
		throw new Error(`${label} failed SHA-256 verification.`);
	}
}

function validateUtf8JavaScript(bytes, label) {
	try {
		return fatalDecoder.decode(bytes);
	} catch {
		throw new Error(`${label} is not valid UTF-8 JavaScript.`);
	}
}

function importVerifiedScript(bytes, label) {
	validateUtf8JavaScript(bytes, label);
	if (
		typeof Blob !== 'function' ||
		typeof URL.createObjectURL !== 'function' ||
		typeof URL.revokeObjectURL !== 'function' ||
		typeof importScripts !== 'function'
	) {
		throw new Error('Wacl Tcl verified runtime evaluation is unavailable.');
	}
	const scriptBytes = Uint8Array.from(bytes);
	const scriptUrl = URL.createObjectURL(
		new Blob([scriptBytes.buffer], { type: 'text/javascript' })
	);
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

function snapshotManagedGlobals() {
	return managedGlobalNames.map((name) => ({
		name,
		hadOwn: Object.prototype.hasOwnProperty.call(globalThis, name),
		value: globalThis[name]
	}));
}

function assignGlobal(name, value, label) {
	try {
		globalThis[name] = value;
	} catch (error) {
		throw new Error(`${label}: ${errorMessage(error)}`);
	}
	if (globalThis[name] !== value) throw new Error(label);
}

function clearManagedGlobals(snapshot) {
	for (const state of snapshot) {
		assignGlobal(
			state.name,
			undefined,
			`Wacl Tcl runtime global ${state.name} could not be cleared`
		);
	}
}

function restoreManagedGlobals(snapshot) {
	const failures = [];
	for (const state of snapshot) {
		try {
			if (state.hadOwn) {
				assignGlobal(
					state.name,
					state.value,
					`Wacl Tcl runtime global ${state.name} could not be restored`
				);
				continue;
			}
			try {
				delete globalThis[state.name];
			} catch {
				// importScripts top-level var bindings may be non-configurable.
			}
			if (globalThis[state.name] !== undefined) {
				assignGlobal(
					state.name,
					undefined,
					`Wacl Tcl runtime global ${state.name} could not be reset`
				);
			}
		} catch (error) {
			failures.push(error);
		}
	}
	return failures;
}

function captureVerifiedAmd() {
	const requireJs = globalThis.requirejs;
	const requireFunction = globalThis.require;
	const defineFunction = globalThis.define;
	if (
		typeof requireJs !== 'function' ||
		typeof requireJs.config !== 'function' ||
		typeof requireFunction !== 'function' ||
		typeof requireFunction.toUrl !== 'function' ||
		typeof defineFunction !== 'function' ||
		!defineFunction.amd ||
		typeof defineFunction.amd !== 'object'
	) {
		throw new Error('Verified RequireJS did not initialize its AMD globals.');
	}
	return Object.freeze({ requireJs, requireFunction, defineFunction });
}

function createRequireModule(requireJs, moduleName) {
	return new Promise((resolve, reject) => {
		try {
			requireJs([moduleName], resolve, reject);
		} catch (error) {
			reject(error);
		}
	});
}

function waitForWacl(wacl) {
	if (!wacl || typeof wacl.onReady !== 'function') {
		throw new Error('Verified Wacl AMD module did not initialize.');
	}
	return new Promise((resolve) => {
		wacl.onReady((interp) => resolve(interp));
	});
}

function createHostModule(runtimePreflight, initialArguments) {
	const packageBytes = new Map([
		['wacl-custom.data', runtimePreflight.customDataBytes],
		['wacl-library.data', runtimePreflight.libraryDataBytes]
	]);
	return {
		arguments: [...initialArguments],
		noExitRuntime: true,
		wasmBinary: runtimePreflight.wasmBytes,
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
}

async function initializeVerifiedWaclRuntime(
	runtimePreflight,
	initialArguments,
	markEvaluationStarted
) {
	const glueSource = validateUtf8JavaScript(runtimePreflight.glueBytes, 'Wacl Tcl runtime glue');
	validateUtf8JavaScript(runtimePreflight.requireJsBytes, 'Wacl Tcl RequireJS');
	if (
		!glueSource.startsWith('define("tcl/wacl",') ||
		!glueSource.includes(verifiedWasmGluePatch)
	) {
		throw new Error('Wacl Tcl runtime glue is missing the verified Wasm bootstrap patch.');
	}
	if (
		runtimePreflight.wasmBytes.byteLength < 8 ||
		runtimePreflight.wasmBytes[0] !== 0 ||
		runtimePreflight.wasmBytes[1] !== 0x61 ||
		runtimePreflight.wasmBytes[2] !== 0x73 ||
		runtimePreflight.wasmBytes[3] !== 0x6d
	) {
		throw new Error('Wacl Tcl runtime Wasm header is invalid.');
	}

	const previousGlobals = snapshotManagedGlobals();
	let result;
	let failure;
	try {
		clearManagedGlobals(previousGlobals);
		markEvaluationStarted();
		importVerifiedScript(runtimePreflight.requireJsBytes, 'Wacl Tcl RequireJS');
		const amd = captureVerifiedAmd();
		amd.requireJs.config({ baseUrl: verifiedRequireBaseUrl, enforceDefine: true });
		amd.requireJs.load = () => {
			throw new Error('Wacl Tcl runtime refused an undeclared RequireJS module load.');
		};
		const module = createHostModule(runtimePreflight, initialArguments);
		assignGlobal('Module', module, 'Wacl Tcl host Module could not be installed');
		assignGlobal('requirejs', amd.requireJs, 'Wacl Tcl RequireJS global changed unexpectedly');
		assignGlobal(
			'require',
			amd.requireFunction,
			'Wacl Tcl require global changed unexpectedly'
		);
		assignGlobal('define', amd.defineFunction, 'Wacl Tcl define global changed unexpectedly');
		importVerifiedScript(runtimePreflight.glueBytes, 'Wacl Tcl runtime glue');
		const wacl = await createRequireModule(amd.requireJs, 'tcl/wacl');
		const interp = await waitForWacl(wacl);
		if (!interp || typeof interp.Eval !== 'function') {
			throw new Error('Verified Wacl interpreter did not initialize.');
		}
		result = Object.freeze({ interp, module });
	} catch (error) {
		failure = error;
	}
	const cleanupFailures = restoreManagedGlobals(previousGlobals);
	if (cleanupFailures.length) {
		throw new AggregateError(
			failure ? [failure, ...cleanupFailures] : cleanupFailures,
			failure
				? `${errorMessage(failure)}; Wacl Tcl runtime global cleanup failed.`
				: 'Wacl Tcl runtime global cleanup failed.'
		);
	}
	if (failure) throw failure;
	return result;
}

async function createVerifiedWaclRuntime(
	runtimePreflightValue,
	requestedMaxAssetBytes,
	initialArguments
) {
	if (runtimePoisoned) {
		throw new Error('Wacl Tcl worker must be recreated after a failed runtime evaluation.');
	}
	const { runtimePreflight, maxAssetBytes } = requireRuntimePreflight(
		runtimePreflightValue,
		requestedMaxAssetBytes
	);
	const identity = [
		runtimePreflight.protocol,
		runtimePreflight.protocolVersion,
		runtimePreflight.profileId,
		runtimePreflight.artifactRevision,
		runtimePreflight.waclRevision,
		runtimePreflight.tclRevision,
		runtimePreflight.requireJsRevision,
		runtimePreflight.emscriptenRevision,
		runtimePreflight.manifestFingerprint
	].join('\n');
	if (verifiedRuntimePromise) {
		if (verifiedRuntimeIdentity !== identity) {
			throw new Error('Wacl Tcl worker cannot replace an initialized runtime profile.');
		}
		return await verifiedRuntimePromise;
	}
	verifiedRuntimeIdentity = identity;
	let evaluationStarted = false;
	verifiedRuntimePromise = (async () => {
		let parsed;
		try {
			parsed = JSON.parse(fatalDecoder.decode(runtimePreflight.manifestBytes));
		} catch {
			throw new Error('Wacl Tcl runtime manifest is not valid UTF-8 JSON.');
		}
		const manifest = await normalizeManifest(parsed, runtimePreflight, maxAssetBytes);
		for (const [path, bytes] of [
			['require.js', runtimePreflight.requireJsBytes],
			['tcl/wacl-custom.data', runtimePreflight.customDataBytes],
			['tcl/wacl-library.data', runtimePreflight.libraryDataBytes],
			['tcl/wacl.js', runtimePreflight.glueBytes],
			['tcl/wacl.wasm', runtimePreflight.wasmBytes]
		]) {
			await verifyReceiptBytes(
				manifest.assetByPath.get(path),
				bytes,
				`Wacl Tcl runtime asset ${path}`
			);
		}
		return await initializeVerifiedWaclRuntime(runtimePreflight, initialArguments, () => {
			evaluationStarted = true;
		});
	})();
	try {
		return await verifiedRuntimePromise;
	} catch (error) {
		verifiedRuntimePromise = null;
		verifiedRuntimeIdentity = '';
		if (evaluationStarted) runtimePoisoned = true;
		throw error;
	}
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
	if (requestConsumed) {
		self.postMessage({ error: 'Wacl Tcl worker accepts exactly one run.' });
		return;
	}
	requestConsumed = true;
	const {
		runtimePreflight,
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
		if (log) console.log('[wasm-idle:tcl-worker] run start');
		if (
			typeof code !== 'string' ||
			typeof activePath !== 'string' ||
			!Array.isArray(args) ||
			args.some((argument) => typeof argument !== 'string')
		) {
			throw new Error('Wacl Tcl code, run path, and arguments must be strings.');
		}
		activeStdinReader = createStdinReader(stdin, stdinChannel);
		activeOutputWriter = createOutputWriter(output);
		const runtime = await createVerifiedWaclRuntime(runtimePreflight, maxAssetBytes, [
			activePath,
			...args
		]);
		runtime.module.arguments = [activePath, ...args];
		configureTclArguments(runtime.interp, activePath, args);
		runtime.interp.stdout = (text) => output(normalizeOutput(String(text)));
		runtime.interp.stderr = (text) => output(normalizeOutput(String(text)));
		try {
			const result = runtime.interp.Eval(code);
			if (result) output(normalizeOutput(String(result)));
		} catch (error) {
			const tclMessage = error?.errorInfo || errorMessage(error);
			throw new Error(tclMessage);
		}
		if (log) console.log('[wasm-idle:tcl-worker] run settled');
		self.postMessage({ results: true });
	} catch (error) {
		if (log) console.error('[wasm-idle:tcl-worker] failed', error);
		self.postMessage({ error: errorMessage(error) });
	} finally {
		activeStdinReader = () => null;
		activeOutputWriter = () => undefined;
		self.close();
	}
};
