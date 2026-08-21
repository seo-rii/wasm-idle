const encoder = new TextEncoder();
const fatalDecoder = new TextDecoder('utf-8', { fatal: true });
const preflightProtocol = 'wasm-idle-janet-preflight';
const preflightProtocolVersion = 1;
const manifestFormat = 'wasm-janet-runtime-manifest-v2';
const fingerprintDomain = 'wasm-idle:janet-runtime-manifest:v2';
const hardMaxAssetBytes = 8 * 1024 * 1024;
const hardMaxTotalLogicalBytes = 16 * 1024 * 1024;
const maxManifestBytes = 64 * 1024;
const expectedIdentity = Object.freeze({
	profileId: 'janet-1.41.3-dev-emscripten-3.1.8-wasm-idle-d647850c',
	artifactRevision: 'd647850cd6448b457f778d01c304358aefa5244b',
	janetVersion: '1.41.3-dev',
	emscriptenVersion: '3.1.8',
	manifestFingerprint: 'a7d89c155be6d2acc930f2d4fc535ce4a67857e3bd32bb42cb005aafcc6c014f'
});
const expectedLicenseExpression = 'MIT';
const expectedArtifact = Object.freeze({
	kind: 'opaque-vendored',
	repository: 'https://github.com/seo-rii/wasm-idle.git',
	revision: expectedIdentity.artifactRevision,
	path: 'static/wasm-janet',
	provenance: 'legacy-import-unrecorded',
	verifiedBuildInput: false
});
const expectedComponents = Object.freeze({
	janet: Object.freeze({
		version: expectedIdentity.janetVersion,
		repository: 'https://github.com/janet-lang/janet.git',
		revision: 'unrecorded',
		verifiedBuildInput: false,
		evidence: 'embedded runtime version string'
	}),
	emscripten: Object.freeze({
		version: expectedIdentity.emscriptenVersion,
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
	'janet.wasm.gz.bin': Object.freeze({ logicalPath: 'janet.wasm', encoding: 'gzip' })
});
const preflightKeys = Object.freeze(
	[
		'artifactRevision',
		'emscriptenVersion',
		'janetVersion',
		'javascriptBytes',
		'manifestBytes',
		'manifestFingerprint',
		'profileId',
		'protocol',
		'protocolVersion',
		'wasmBytes'
	].sort()
);
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

let requestConsumed = false;

function isObject(value) {
	return !!value && typeof value === 'object' && !Array.isArray(value);
}

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
		throw new Error('Janet runtime asset byte limit is invalid.');
	}
	const maxAssetBytes = Math.min(requestedMaxAssetBytes, hardMaxAssetBytes);
	if (!isObject(runtimePreflight) || !hasExactKeys(runtimePreflight, preflightKeys)) {
		throw new Error('Janet runtime preflight payload has an invalid shape.');
	}
	if (
		runtimePreflight.protocol !== preflightProtocol ||
		runtimePreflight.protocolVersion !== preflightProtocolVersion ||
		runtimePreflight.profileId !== expectedIdentity.profileId ||
		runtimePreflight.artifactRevision !== expectedIdentity.artifactRevision ||
		runtimePreflight.janetVersion !== expectedIdentity.janetVersion ||
		runtimePreflight.emscriptenVersion !== expectedIdentity.emscriptenVersion ||
		runtimePreflight.manifestFingerprint !== expectedIdentity.manifestFingerprint ||
		!isUint8Array(runtimePreflight.manifestBytes) ||
		!isUint8Array(runtimePreflight.javascriptBytes) ||
		!isUint8Array(runtimePreflight.wasmBytes)
	) {
		throw new Error('Janet runtime preflight payload is invalid.');
	}
	for (const [label, bytes, limit] of [
		[
			'Janet runtime manifest',
			runtimePreflight.manifestBytes,
			Math.min(maxManifestBytes, maxAssetBytes)
		],
		['Janet runtime JavaScript', runtimePreflight.javascriptBytes, maxAssetBytes],
		['Janet runtime Wasm', runtimePreflight.wasmBytes, maxAssetBytes]
	]) {
		if (bytes.byteLength <= 0 || bytes.byteLength > limit) {
			throw new Error(`${label} exceeds its byte limit.`);
		}
	}
	const totalLogicalBytes =
		runtimePreflight.javascriptBytes.byteLength + runtimePreflight.wasmBytes.byteLength;
	if (!Number.isSafeInteger(totalLogicalBytes) || totalLogicalBytes > hardMaxTotalLogicalBytes) {
		throw new Error('Janet runtime logical payload exceeds its aggregate byte limit.');
	}
	return { runtimePreflight, maxAssetBytes };
}

async function sha256Hex(bytes) {
	if (!globalThis.crypto?.subtle?.digest) {
		throw new Error('Janet runtime integrity verification requires Web Crypto.');
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
	const primitive = JSON.stringify(value);
	if (primitive === undefined) throw new Error('Janet manifest contains a non-JSON value.');
	return primitive;
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
	return { ...candidate };
}

function normalizeReceipt(candidate, expected, maxAssetBytes, label) {
	if (
		!isObject(candidate) ||
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
		!isObject(candidate) ||
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

async function normalizeManifest(value, runtimePreflight, maxAssetBytes) {
	if (!isObject(value)) throw new Error('Janet runtime manifest must be an object.');
	if (!hasExactKeys(value, expectedManifestKeys)) {
		throw new Error('Janet runtime manifest schema is invalid.');
	}
	if (value.format !== manifestFormat || value.runtime !== 'janet-lang-janet') {
		throw new Error('Janet runtime manifest format is unsupported.');
	}
	if (
		value.profileId !== runtimePreflight.profileId ||
		value.fingerprint !== runtimePreflight.manifestFingerprint ||
		value.licenseExpression !== expectedLicenseExpression
	) {
		throw new Error('Janet runtime manifest identity is invalid.');
	}
	const artifact = normalizeProvenanceObject(value.artifact, expectedArtifact, 'artifact');
	const components = normalizeProvenanceObject(value.components, expectedComponents, 'component');
	const build = normalizeProvenanceObject(value.build, expectedBuild, 'build');
	if (
		artifact.revision !== runtimePreflight.artifactRevision ||
		components.janet.version !== runtimePreflight.janetVersion ||
		components.emscripten.version !== runtimePreflight.emscriptenVersion
	) {
		throw new Error('Janet runtime provenance identity is invalid.');
	}
	if (
		!isObject(value.license) ||
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
		)) !== runtimePreflight.manifestFingerprint
	) {
		throw new Error('Janet runtime receipt graph failed fingerprint verification.');
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

function validateUtf8JavaScript(bytes) {
	let source;
	try {
		source = fatalDecoder.decode(bytes);
	} catch {
		throw new Error('Janet runtime JavaScript is not valid UTF-8.');
	}
	if (
		!source.includes('export default Module') ||
		!source.includes('callMain') ||
		!source.includes('FS.init') ||
		!source.includes('Module["wasmBinary"]')
	) {
		throw new Error('Janet runtime JavaScript is missing its verified module contract.');
	}
	return source;
}

function validateWasmHeader(bytes) {
	if (
		bytes.byteLength < 8 ||
		bytes[0] !== 0 ||
		bytes[1] !== 0x61 ||
		bytes[2] !== 0x73 ||
		bytes[3] !== 0x6d ||
		bytes[4] !== 1 ||
		bytes[5] !== 0 ||
		bytes[6] !== 0 ||
		bytes[7] !== 0
	) {
		throw new Error('Janet runtime Wasm header is invalid.');
	}
}

async function verifyRuntimePreflight(runtimePreflightValue, requestedMaxAssetBytes) {
	const { runtimePreflight, maxAssetBytes } = requireRuntimePreflight(
		runtimePreflightValue,
		requestedMaxAssetBytes
	);
	let parsed;
	try {
		parsed = JSON.parse(fatalDecoder.decode(runtimePreflight.manifestBytes));
	} catch {
		throw new Error('Janet runtime manifest is not valid UTF-8 JSON.');
	}
	const manifest = await normalizeManifest(parsed, runtimePreflight, maxAssetBytes);
	for (const [path, bytes] of [
		['janet.js', runtimePreflight.javascriptBytes],
		['janet.wasm', runtimePreflight.wasmBytes]
	]) {
		await verifyReceiptBytes(
			manifest.assetByPath.get(path),
			bytes,
			`Janet runtime asset ${path}`
		);
	}
	validateUtf8JavaScript(runtimePreflight.javascriptBytes);
	validateWasmHeader(runtimePreflight.wasmBytes);
	return runtimePreflight;
}

async function importVerifiedRuntimeModule(bytes) {
	validateUtf8JavaScript(bytes);
	if (
		typeof Blob !== 'function' ||
		typeof URL.createObjectURL !== 'function' ||
		typeof URL.revokeObjectURL !== 'function'
	) {
		throw new Error('Janet verified runtime module evaluation is unavailable.');
	}
	const scriptBytes = Uint8Array.from(bytes);
	const moduleUrl = URL.createObjectURL(
		new Blob([scriptBytes.buffer], { type: 'text/javascript' })
	);
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

function snapshotModuleGlobal() {
	return {
		hadOwn: Object.prototype.hasOwnProperty.call(globalThis, 'Module'),
		value: globalThis.Module
	};
}

function assignModule(value, label) {
	try {
		globalThis.Module = value;
	} catch (error) {
		throw new Error(`${label}: ${errorMessage(error)}`);
	}
	if (globalThis.Module !== value) throw new Error(label);
}

function clearModuleGlobal() {
	assignModule(undefined, 'Janet runtime Module global could not be cleared');
}

function requireClearModuleGlobal() {
	if (globalThis.Module !== undefined) {
		throw new Error('Janet runtime Module changed during verified ESM evaluation.');
	}
}

function restoreModuleGlobal(snapshot) {
	if (snapshot.hadOwn) {
		assignModule(snapshot.value, 'Janet runtime Module global could not be restored');
		return;
	}
	try {
		delete globalThis.Module;
	} catch {
		// Preserve the verified execution result if the host made the binding non-configurable.
	}
	if (globalThis.Module !== undefined) {
		assignModule(undefined, 'Janet runtime Module global could not be reset');
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

async function executeJanetRequest(data, stderr) {
	const { runtimePreflight, maxAssetBytes, code, stdin, stdinChannel, activePath, log } =
		data || {};
	const readStdin = createInputReader(stdin, stdinChannel);
	if (log) console.log('[wasm-idle:janet-worker] run start');
	const verified = await verifyRuntimePreflight(runtimePreflight, maxAssetBytes);
	const moduleSnapshot = snapshotModuleGlobal();
	try {
		clearModuleGlobal();
		const runtimeModule = await importVerifiedRuntimeModule(verified.javascriptBytes);
		requireClearModuleGlobal();
		const createModule = runtimeModule?.default;
		if (typeof createModule !== 'function') {
			throw new Error('Janet runtime module did not export its verified default factory.');
		}
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
			wasmBinary: Uint8Array.from(verified.wasmBytes)
		});
		requireClearModuleGlobal();
		const sourcePath = `/${activePath || 'main.janet'}`;
		module.FS.writeFile(sourcePath, String(code || ''));
		const status = module.callMain([sourcePath]);
		if (stderr.length > 0 || status !== 0) {
			throw new Error(stderr.join('\n') || `Janet exited with status ${status}.`);
		}
		if (log) console.log('[wasm-idle:janet-worker] run settled');
	} finally {
		restoreModuleGlobal(moduleSnapshot);
	}
}

self.onmessage = async (event) => {
	if (requestConsumed) {
		self.postMessage({ error: 'Janet runner accepts exactly one run request.' });
		return;
	}
	requestConsumed = true;
	const stderr = [];
	const log = event.data?.log;
	try {
		await executeJanetRequest(event.data, stderr);
		self.postMessage({ results: true });
	} catch (error) {
		const message = stderr.length > 0 ? stderr.join('\n') : errorMessage(error);
		if (log) console.error('[wasm-idle:janet-worker] failed', error);
		self.postMessage({ error: message });
	} finally {
		try {
			self.close();
		} catch {
			// The terminal result has already been delivered.
		}
	}
};
