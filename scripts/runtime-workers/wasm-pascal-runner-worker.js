const encoder = new TextEncoder();
const fatalDecoder = new TextDecoder('utf-8', { fatal: true });
const preflightProtocol = 'wasm-idle-pascal-preflight';
const preflightProtocolVersion = 1;
const manifestFormat = 'wasm-pascal-runtime-manifest-v2';
const fingerprintDomain = 'wasm-idle:pascal-runtime-manifest:v2';
const maxManifestBytes = 64 * 1024;
const hardMaxAssetBytes = 8 * 1024 * 1024;
const hardMaxDeliveryBytes = 8 * 1024 * 1024;
const hardMaxTotalLogicalBytes = 16 * 1024 * 1024;
const expectedIdentity = Object.freeze({
	profileId: '__WASM_IDLE_PASCAL_PROFILE_ID__',
	artifactRevision: '__WASM_IDLE_PASCAL_ARTIFACT_REVISION__',
	pas2jsVersion: '__WASM_IDLE_PASCAL_VERSION__',
	pas2jsRevision: '__WASM_IDLE_PASCAL_REVISION__',
	manifestFingerprint: '__WASM_IDLE_PASCAL_MANIFEST_FINGERPRINT__'
});
const expectedLicenseExpression = 'LGPL-2.1-only WITH Independent-modules-exception';
const expectedArtifact = Object.freeze({
	kind: 'opaque-vendored',
	repository: 'https://github.com/seo-rii/wasm-idle.git',
	revision: expectedIdentity.artifactRevision,
	path: 'static/wasm-pascal',
	provenance: 'legacy-import',
	verifiedBuildInput: false
});
const expectedComponents = Object.freeze({
	pas2js: Object.freeze({
		version: expectedIdentity.pas2jsVersion,
		repository: 'https://gitlab.com/freepascal.org/fpc/pas2js.git',
		revision: expectedIdentity.pas2jsRevision,
		revisionKind: 'recorded-abbreviated',
		verifiedBuildInput: false,
		evidence: 'runtime-build.json; full upstream commit was not recorded'
	})
});
const expectedBuild = Object.freeze({
	target: 'browser',
	compiler: 'native pas2js',
	entrypoint: 'runtimes/wasm-pascal/src/wasm_idle_pascal_compiler.pas',
	integrationSources: Object.freeze([
		'runtimes/wasm-pascal/src/system.pas',
		'runtimes/wasm-pascal/src/wasm_idle_pascal_compiler.pas',
		'runtimes/wasm-pascal/src/webfilecache.pp'
	]),
	transformations: Object.freeze([
		'strip trailing horizontal whitespace and normalize final newline',
		'gzip compiler.js with Node zlib level 9'
	]),
	verifiedBuildInput: false
});
const expectedLicense = Object.freeze({
	spdx: expectedLicenseExpression,
	sourceUrl: 'https://gitlab.com/freepascal.org/fpc/pas2js/-/raw/release_3_2_0/COPYING.txt',
	exceptionSourceUrl: 'https://gitlab.com/freepascal.org/fpc/pas2js/-/raw/release_3_2_0/LICENSE',
	verifiedBuildInput: false,
	evidence: 'upstream license URLs recorded; texts were not vendored with the legacy generation'
});
const expectedAssets = Object.freeze({
	'compiler.js': Object.freeze({ mediaType: 'text/javascript' }),
	'rtl.js': Object.freeze({ mediaType: 'text/javascript' }),
	'system.pas': Object.freeze({ mediaType: 'text/plain' })
});
const expectedStorage = Object.freeze({
	'compiler.js.gz.bin': Object.freeze({ logicalPath: 'compiler.js', encoding: 'gzip' }),
	'rtl.js.bin': Object.freeze({ logicalPath: 'rtl.js', encoding: 'identity' }),
	'system.pas.bin': Object.freeze({ logicalPath: 'system.pas', encoding: 'identity' })
});
const preflightKeys = Object.freeze(
	[
		'artifactRevision',
		'compilerJavaScriptBytes',
		'manifestBytes',
		'manifestFingerprint',
		'pas2jsRevision',
		'pas2jsVersion',
		'profileId',
		'protocol',
		'protocolVersion',
		'rtlJavaScriptBytes',
		'systemPascalBytes'
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
const globalNames = Object.freeze(['rtl', 'pas', '__wasmIdlePascalCompiler']);

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

function canonicalJson(value) {
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
	if (isObject(value)) {
		return `{${Object.keys(value)
			.sort()
			.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
			.join(',')}}`;
	}
	const primitive = JSON.stringify(value);
	if (primitive === undefined) throw new Error('Pascal manifest contains a non-JSON value.');
	return primitive;
}

async function sha256Hex(bytes) {
	if (!globalThis.crypto?.subtle?.digest) {
		throw new Error('Pascal runtime integrity verification requires Web Crypto.');
	}
	const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes));
	return [...digest].map((value) => value.toString(16).padStart(2, '0')).join('');
}

async function computeFingerprint(manifest) {
	let canonical = `${fingerprintDomain}\nformat\0${manifestFormat}\nruntime\0pas2js\nprofileId\0${manifest.profileId}\n`;
	canonical += `licenseExpression\0${manifest.licenseExpression}\n`;
	canonical += `artifact\0${canonicalJson(manifest.artifact)}\n`;
	canonical += `components\0${canonicalJson(manifest.components)}\n`;
	canonical += `build\0${canonicalJson(manifest.build)}\n`;
	canonical += `license\0${canonicalJson(manifest.license)}\n`;
	canonical += `metadata\0${manifest.metadata.path}\0${manifest.metadata.mediaType}\0${manifest.metadata.size}\0${manifest.metadata.sha256}\n`;
	for (const asset of [...manifest.assets].sort((left, right) =>
		left.path < right.path ? -1 : left.path > right.path ? 1 : 0
	)) {
		canonical += `asset\0${asset.path}\0${asset.mediaType}\0${asset.size}\0${asset.sha256}\n`;
	}
	for (const asset of [...manifest.storage].sort((left, right) =>
		left.path < right.path ? -1 : left.path > right.path ? 1 : 0
	)) {
		canonical += `storage\0${asset.path}\0${asset.logicalPath}\0${asset.encoding}\0${asset.size}\0${asset.sha256}\n`;
	}
	return sha256Hex(encoder.encode(canonical));
}

function requireRuntimePreflight(value, requestedMaxAssetBytes) {
	if (!Number.isSafeInteger(requestedMaxAssetBytes) || requestedMaxAssetBytes <= 0) {
		throw new Error('Pascal runtime asset byte limit is invalid.');
	}
	const maxAssetBytes = Math.min(requestedMaxAssetBytes, hardMaxAssetBytes);
	if (!isObject(value) || !hasExactKeys(value, preflightKeys)) {
		throw new Error('Pascal runtime preflight payload has an invalid shape.');
	}
	if (
		value.protocol !== preflightProtocol ||
		value.protocolVersion !== preflightProtocolVersion ||
		value.profileId !== expectedIdentity.profileId ||
		value.artifactRevision !== expectedIdentity.artifactRevision ||
		value.pas2jsVersion !== expectedIdentity.pas2jsVersion ||
		value.pas2jsRevision !== expectedIdentity.pas2jsRevision ||
		value.manifestFingerprint !== expectedIdentity.manifestFingerprint ||
		!isUint8Array(value.manifestBytes) ||
		!isUint8Array(value.compilerJavaScriptBytes) ||
		!isUint8Array(value.rtlJavaScriptBytes) ||
		!isUint8Array(value.systemPascalBytes)
	) {
		throw new Error('Pascal runtime preflight payload is invalid.');
	}
	if (value.manifestBytes.byteLength <= 0 || value.manifestBytes.byteLength > maxManifestBytes) {
		throw new Error('Pascal runtime manifest exceeds its byte limit.');
	}
	for (const [label, bytes] of [
		['Pascal compiler JavaScript', value.compilerJavaScriptBytes],
		['Pascal RTL JavaScript', value.rtlJavaScriptBytes],
		['Pascal System unit', value.systemPascalBytes]
	]) {
		if (bytes.byteLength <= 0 || bytes.byteLength > maxAssetBytes) {
			throw new Error(`${label} exceeds its byte limit.`);
		}
	}
	const totalLogicalBytes =
		value.compilerJavaScriptBytes.byteLength +
		value.rtlJavaScriptBytes.byteLength +
		value.systemPascalBytes.byteLength;
	if (!Number.isSafeInteger(totalLogicalBytes) || totalLogicalBytes > hardMaxTotalLogicalBytes) {
		throw new Error('Pascal runtime logical payload exceeds its aggregate byte limit.');
	}
	return { runtimePreflight: value, maxAssetBytes };
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
	return { ...candidate };
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
		throw new Error(`Pascal runtime storage receipt is invalid for ${expected.path}.`);
	}
	return { ...candidate };
}

async function normalizeManifest(value, runtimePreflight, maxAssetBytes) {
	if (!isObject(value) || !hasExactKeys(value, expectedManifestKeys)) {
		throw new Error('Pascal runtime manifest schema is invalid.');
	}
	if (
		value.format !== manifestFormat ||
		value.runtime !== 'pas2js' ||
		value.profileId !== runtimePreflight.profileId ||
		value.fingerprint !== runtimePreflight.manifestFingerprint ||
		value.licenseExpression !== expectedLicenseExpression ||
		canonicalJson(value.artifact) !== canonicalJson(expectedArtifact) ||
		canonicalJson(value.components) !== canonicalJson(expectedComponents) ||
		canonicalJson(value.build) !== canonicalJson(expectedBuild) ||
		canonicalJson(value.license) !== canonicalJson(expectedLicense)
	) {
		throw new Error('Pascal runtime manifest identity or provenance is invalid.');
	}
	const metadata = normalizeReceipt(
		value.metadata,
		{ path: 'runtime-build.json', mediaType: 'application/json' },
		maxAssetBytes,
		'Pascal runtime metadata'
	);
	if (!Array.isArray(value.assets) || value.assets.length !== 3) {
		throw new Error('Pascal runtime manifest must declare exactly three logical assets.');
	}
	if (!Array.isArray(value.storage) || value.storage.length !== 3) {
		throw new Error('Pascal runtime manifest must declare exactly three storage assets.');
	}
	const assetByPath = new Map();
	for (const candidate of value.assets) {
		const expected = expectedAssets[candidate?.path];
		if (!expected || assetByPath.has(candidate.path)) {
			throw new Error(
				'Pascal runtime manifest has an unexpected or duplicate logical asset.'
			);
		}
		assetByPath.set(
			candidate.path,
			normalizeReceipt(
				candidate,
				{ path: candidate.path, mediaType: expected.mediaType },
				maxAssetBytes,
				`Pascal runtime asset ${candidate.path}`
			)
		);
	}
	const storageByPath = new Map();
	let deliveryBytes = 0;
	for (const candidate of value.storage) {
		const expected = expectedStorage[candidate?.path];
		if (!expected || storageByPath.has(candidate.path)) {
			throw new Error(
				'Pascal runtime manifest has an unexpected or duplicate storage asset.'
			);
		}
		const receipt = normalizeStorageReceipt(
			candidate,
			{ path: candidate.path, ...expected },
			maxAssetBytes
		);
		storageByPath.set(candidate.path, receipt);
		deliveryBytes += receipt.size;
	}
	if (!Number.isSafeInteger(deliveryBytes) || deliveryBytes > hardMaxDeliveryBytes) {
		throw new Error('Pascal runtime delivery graph exceeds its aggregate byte limit.');
	}
	if (
		Object.keys(expectedAssets).some((path) => !assetByPath.has(path)) ||
		Object.keys(expectedStorage).some((path) => !storageByPath.has(path))
	) {
		throw new Error('Pascal runtime manifest is missing a required receipt.');
	}
	const normalized = {
		...value,
		metadata,
		assets: [...assetByPath.values()],
		storage: [...storageByPath.values()]
	};
	if ((await computeFingerprint(normalized)) !== runtimePreflight.manifestFingerprint) {
		throw new Error('Pascal runtime receipt graph failed fingerprint verification.');
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

function decodeUtf8(bytes, label) {
	try {
		return fatalDecoder.decode(bytes);
	} catch {
		throw new Error(`${label} is not valid UTF-8.`);
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
		throw new Error('Pascal runtime manifest is not valid UTF-8 JSON.');
	}
	const manifest = await normalizeManifest(parsed, runtimePreflight, maxAssetBytes);
	for (const [assetPath, bytes] of [
		['compiler.js', runtimePreflight.compilerJavaScriptBytes],
		['rtl.js', runtimePreflight.rtlJavaScriptBytes],
		['system.pas', runtimePreflight.systemPascalBytes]
	]) {
		await verifyReceiptBytes(
			manifest.assetByPath.get(assetPath),
			bytes,
			`Pascal runtime asset ${assetPath}`
		);
	}
	const compilerSource = decodeUtf8(
		runtimePreflight.compilerJavaScriptBytes,
		'Pascal compiler JavaScript'
	);
	const rtlSource = decodeUtf8(runtimePreflight.rtlJavaScriptBytes, 'Pascal RTL JavaScript');
	const systemSource = decodeUtf8(runtimePreflight.systemPascalBytes, 'Pascal System unit');
	if (!compilerSource.includes('__wasmIdlePascalCompiler')) {
		throw new Error('Pascal compiler JavaScript is missing its verified compiler contract.');
	}
	if (!/\bprocedure\s+ReadLn\b/iu.test(systemSource)) {
		throw new Error('Pascal System unit is missing its verified stdin contract.');
	}
	return { compilerSource, rtlSource, systemSource };
}

function snapshotRuntimeGlobals() {
	return new Map(
		globalNames.map((name) => [
			name,
			{
				hadOwn: Object.prototype.hasOwnProperty.call(globalThis, name),
				descriptor: Object.getOwnPropertyDescriptor(globalThis, name)
			}
		])
	);
}

function clearRuntimeGlobals() {
	for (const name of globalNames) {
		try {
			delete globalThis[name];
		} catch {
			// The verification below is authoritative.
		}
		if (globalThis[name] !== undefined) {
			try {
				globalThis[name] = undefined;
			} catch {
				// The verification below is authoritative.
			}
		}
		if (globalThis[name] !== undefined) {
			throw new Error(`Pascal runtime global ${name} could not be cleared.`);
		}
	}
}

function restoreRuntimeGlobals(snapshot) {
	for (const name of globalNames) {
		const saved = snapshot.get(name);
		if (saved?.hadOwn && saved.descriptor) {
			Object.defineProperty(globalThis, name, saved.descriptor);
			continue;
		}
		try {
			delete globalThis[name];
		} catch {
			// A best-effort cleanup must not replace the verified execution outcome.
		}
	}
}

function postOutput(text) {
	if (text) self.postMessage({ output: text });
}

function createSharedByteReader(channel) {
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
		throw new Error('Invalid pas2js streaming stdin channel.');
	}
	const control = new Int32Array(channel.buffer, 0, 4);
	const bytes = new Uint8Array(channel.buffer, channel.controlBytes, channel.capacity);
	return () => {
		while (true) {
			if (Atomics.load(control, 3) === 1) {
				throw new Error('pas2js streaming stdin was cancelled.');
			}
			const write = Atomics.load(control, 0);
			const read = Atomics.load(control, 1);
			const available = write - read;
			if (available < 0 || available > bytes.byteLength) {
				throw new Error('pas2js streaming stdin counters are invalid.');
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

function createSharedLineReader(channel) {
	const readByte = createSharedByteReader(channel);
	if (!readByte) return null;
	const decoder = new TextDecoder();
	let skipLineFeed = false;
	return () => {
		const bytes = [];
		while (true) {
			const value = readByte();
			if (value === null) return decoder.decode(Uint8Array.from(bytes));
			if (skipLineFeed) {
				skipLineFeed = false;
				if (value === 10) continue;
			}
			if (value === 10) break;
			if (value === 13) {
				skipLineFeed = true;
				break;
			}
			bytes.push(value);
		}
		return decoder.decode(Uint8Array.from(bytes));
	};
}

function createLineReader(stdin, channel) {
	const sharedReader = createSharedLineReader(channel);
	if (sharedReader) return sharedReader;
	const source = typeof stdin === 'string' ? stdin : '';
	const lines = source.length ? source.split(/\r\n|\n|\r/u) : [];
	let index = 0;
	return () => (index >= lines.length ? '' : lines[index++]);
}

function runGeneratedJavaScript(source, stdin, stdinChannel) {
	const readLine = createLineReader(stdin, stdinChannel);
	const previousConsole = globalThis.console;
	const hadRead = Object.prototype.hasOwnProperty.call(globalThis, '__wasm_idle_pascal_read');
	const previousRead = globalThis.__wasm_idle_pascal_read;
	globalThis.console = {
		...previousConsole,
		log: (...args) => postOutput(`${args.join(' ')}\n`),
		error: (...args) => postOutput(`${args.join(' ')}\n`)
	};
	globalThis.__wasm_idle_pascal_read = readLine;
	try {
		const run = new Function(`${source}\nrtl.run("program");`);
		run();
	} finally {
		globalThis.console = previousConsole;
		if (hadRead) globalThis.__wasm_idle_pascal_read = previousRead;
		else delete globalThis.__wasm_idle_pascal_read;
	}
}

async function executePascalRequest(data) {
	const { runtimePreflight, maxAssetBytes, code, stdin, stdinChannel, log } = data || {};
	if (log) console.log('[wasm-idle:pascal-worker] run start');
	const verified = await verifyRuntimePreflight(runtimePreflight, maxAssetBytes);
	const snapshot = snapshotRuntimeGlobals();
	try {
		clearRuntimeGlobals();
		(0, eval)(verified.compilerSource);
		const runtime = globalThis.rtl;
		if (typeof runtime?.run !== 'function') {
			throw new Error('Pascal compiler runtime did not initialize.');
		}
		runtime.run('program');
		const compiler = globalThis.__wasmIdlePascalCompiler;
		if (typeof compiler?.setFile !== 'function' || typeof compiler?.compile !== 'function') {
			throw new Error('Pascal compiler export did not initialize.');
		}
		compiler.setFile('system.pas', verified.systemSource);
		compiler.setFile('rtl.js', verified.rtlSource);
		const generated = compiler.compile(String(code || ''));
		runGeneratedJavaScript(generated, stdin, stdinChannel);
		if (log) console.log('[wasm-idle:pascal-worker] run settled');
	} finally {
		restoreRuntimeGlobals(snapshot);
	}
}

self.onmessage = async (event) => {
	if (requestConsumed) {
		self.postMessage({ error: 'Pascal runner accepts exactly one run request.' });
		return;
	}
	requestConsumed = true;
	const log = event.data?.log;
	try {
		await executePascalRequest(event.data);
		self.postMessage({ results: true });
	} catch (error) {
		if (log) console.error('[wasm-idle:pascal-worker] failed', error);
		self.postMessage({ error: errorMessage(error) });
	} finally {
		try {
			self.close();
		} catch {
			// The terminal result has already been delivered.
		}
	}
};
