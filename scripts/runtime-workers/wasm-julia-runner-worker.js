const textEncoder = new TextEncoder();
const fatalDecoder = new TextDecoder('utf-8', { fatal: true });
const preflightProtocol = 'wasm-idle-julia-preflight';
const preflightProtocolVersion = 1;
const manifestFormat = 'wasm-julia-runtime-manifest-v2';
const fingerprintDomain = 'wasm-idle:julia-runtime-manifest:v2';
const hardMaxAssetBytes = 64 * 1024 * 1024;
const hardMaxTotalLogicalBytes = 64 * 1024 * 1024;
const maxManifestBytes = 64 * 1024;
const expectedIdentity = Object.freeze({
	profileId: '__WASM_IDLE_JULIA_PROFILE_ID__',
	packageRevision: '__WASM_IDLE_JULIA_PACKAGE_REVISION__',
	importedByCommit: '__WASM_IDLE_JULIA_IMPORTED_BY_COMMIT__',
	juliaVersion: '__WASM_IDLE_JULIA_VERSION__',
	emscriptenVersion: '__WASM_IDLE_JULIA_EMSCRIPTEN_VERSION__',
	manifestFingerprint: '__WASM_IDLE_JULIA_MANIFEST_FINGERPRINT__'
});
const expectedLicenseExpression = 'MIT AND LicenseRef-Julia-Third-Party';
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
		version: '1.3.0-DEV.560',
		repository: 'https://github.com/JuliaLang/julia.git',
		revision: 'unrecorded',
		verifiedBuildInput: false,
		evidence:
			'exact VERSION observed in the real Chromium runtime; the binary embeds the matching 1.3.0-DEV family string; binary-to-source attestation is unavailable'
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
	'julia.data.gz.bin': Object.freeze({ logicalPath: 'julia.data', encoding: 'gzip' }),
	'julia.js.gz.bin': Object.freeze({ logicalPath: 'julia.js', encoding: 'gzip' }),
	'julia.wasm.gz.bin': Object.freeze({ logicalPath: 'julia.wasm', encoding: 'gzip' })
});
const preflightKeys = Object.freeze(
	[
		'dataBytes',
		'emscriptenVersion',
		'importedByCommit',
		'javascriptBytes',
		'juliaVersion',
		'manifestBytes',
		'manifestFingerprint',
		'packageRevision',
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
	if (primitive === undefined) throw new Error('Julia manifest contains a non-JSON value.');
	return primitive;
}

function requireRuntimePreflight(runtimePreflight, requestedMaxAssetBytes) {
	if (!Number.isSafeInteger(requestedMaxAssetBytes) || requestedMaxAssetBytes <= 0) {
		throw new Error('Julia runtime asset byte limit is invalid.');
	}
	const maxAssetBytes = Math.min(requestedMaxAssetBytes, hardMaxAssetBytes);
	if (!isObject(runtimePreflight) || !hasExactKeys(runtimePreflight, preflightKeys)) {
		throw new Error('Julia runtime preflight payload has an invalid shape.');
	}
	if (
		runtimePreflight.protocol !== preflightProtocol ||
		runtimePreflight.protocolVersion !== preflightProtocolVersion ||
		runtimePreflight.profileId !== expectedIdentity.profileId ||
		runtimePreflight.packageRevision !== expectedIdentity.packageRevision ||
		runtimePreflight.importedByCommit !== expectedIdentity.importedByCommit ||
		runtimePreflight.juliaVersion !== expectedIdentity.juliaVersion ||
		runtimePreflight.emscriptenVersion !== expectedIdentity.emscriptenVersion ||
		runtimePreflight.manifestFingerprint !== expectedIdentity.manifestFingerprint ||
		!isUint8Array(runtimePreflight.manifestBytes) ||
		!isUint8Array(runtimePreflight.javascriptBytes) ||
		!isUint8Array(runtimePreflight.wasmBytes) ||
		!isUint8Array(runtimePreflight.dataBytes)
	) {
		throw new Error('Julia runtime preflight payload is invalid.');
	}
	for (const [label, bytes, limit] of [
		[
			'Julia runtime manifest',
			runtimePreflight.manifestBytes,
			Math.min(maxManifestBytes, maxAssetBytes)
		],
		['Julia runtime JavaScript', runtimePreflight.javascriptBytes, maxAssetBytes],
		['Julia runtime Wasm', runtimePreflight.wasmBytes, maxAssetBytes],
		['Julia runtime data', runtimePreflight.dataBytes, maxAssetBytes]
	]) {
		if (bytes.byteLength <= 0 || bytes.byteLength > limit) {
			throw new Error(`${label} exceeds its byte limit.`);
		}
	}
	const totalLogicalBytes = [
		runtimePreflight.javascriptBytes,
		runtimePreflight.wasmBytes,
		runtimePreflight.dataBytes
	].reduce((total, bytes) => total + bytes.byteLength, 0);
	if (totalLogicalBytes > hardMaxTotalLogicalBytes) {
		throw new Error('Julia runtime logical payload exceeds its aggregate byte limit.');
	}
	return { runtimePreflight, maxAssetBytes };
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

async function normalizeManifest(value, runtimePreflight, maxAssetBytes) {
	if (!isObject(value)) throw new Error('Julia runtime manifest must be an object.');
	if (!hasExactKeys(value, expectedManifestKeys)) {
		throw new Error('Julia runtime manifest schema is invalid.');
	}
	if (value.format !== manifestFormat || value.runtime !== 'chriskoch-julia-wasm') {
		throw new Error('Julia runtime manifest format is unsupported.');
	}
	if (
		value.profileId !== expectedIdentity.profileId ||
		value.profileId !== runtimePreflight.profileId ||
		value.licenseExpression !== expectedLicenseExpression ||
		value.fingerprint !== runtimePreflight.manifestFingerprint
	) {
		throw new Error('Julia runtime profile or manifest fingerprint is invalid.');
	}
	const artifact = normalizeProvenanceObject(value.artifact, expectedArtifact, 'artifact');
	const components = normalizeProvenanceObject(value.components, expectedComponents, 'component');
	if (
		artifact.npmShasum !== runtimePreflight.packageRevision ||
		artifact.importedByCommit !== runtimePreflight.importedByCommit ||
		components.julia.version !== runtimePreflight.juliaVersion ||
		components.emscripten.version !== runtimePreflight.emscriptenVersion
	) {
		throw new Error('Julia runtime manifest identity is incoherent.');
	}
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
		)) !== runtimePreflight.manifestFingerprint
	) {
		throw new Error('Julia runtime receipt graph failed fingerprint verification.');
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
		throw new Error('Julia runtime JavaScript is not valid UTF-8.');
	}
	if (
		!source.includes('_jl_eval_string') ||
		!source.includes('WebAssembly.instantiate') ||
		!source.includes('getPreloadedPackage') ||
		!source.includes('julia-wasm/julia.wasm') ||
		!source.includes('/npm/@chriskoch/julia-wasm/julia.data')
	) {
		throw new Error(
			'Julia runtime JavaScript is missing its verified asset injection contract.'
		);
	}
	return source;
}

function validateWasmHeader(bytes) {
	if (
		bytes.byteLength < 8 ||
		bytes[0] !== 0 ||
		bytes[1] !== 0x61 ||
		bytes[2] !== 0x73 ||
		bytes[3] !== 0x6d
	) {
		throw new Error('Julia runtime Wasm header is invalid.');
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
		throw new Error('Julia runtime manifest is not valid UTF-8 JSON.');
	}
	const manifest = await normalizeManifest(parsed, runtimePreflight, maxAssetBytes);
	for (const [path, bytes] of [
		['julia.js', runtimePreflight.javascriptBytes],
		['julia.wasm', runtimePreflight.wasmBytes],
		['julia.data', runtimePreflight.dataBytes]
	]) {
		await verifyReceiptBytes(
			manifest.assetByPath.get(path),
			bytes,
			`Julia runtime asset ${path}`
		);
	}
	validateUtf8JavaScript(runtimePreflight.javascriptBytes);
	validateWasmHeader(runtimePreflight.wasmBytes);
	return runtimePreflight;
}

function importVerifiedRuntimeScript(bytes) {
	validateUtf8JavaScript(bytes);
	if (
		typeof Blob !== 'function' ||
		typeof URL.createObjectURL !== 'function' ||
		typeof URL.revokeObjectURL !== 'function' ||
		typeof importScripts !== 'function'
	) {
		throw new Error('Julia verified runtime evaluation is unavailable.');
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

function snapshotModuleGlobal() {
	return {
		hadOwn: Object.prototype.hasOwnProperty.call(globalThis, 'Module'),
		descriptor: Object.getOwnPropertyDescriptor(globalThis, 'Module')
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
	const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'Module');
	if (descriptor?.configurable) {
		try {
			delete globalThis.Module;
		} catch {
			// The assignment below performs the final fail-closed check.
		}
	}
	assignModule(undefined, 'Julia runtime Module global could not be cleared');
}

function restoreModuleGlobal(snapshot) {
	const current = Object.getOwnPropertyDescriptor(globalThis, 'Module');
	if (current?.configurable) {
		try {
			delete globalThis.Module;
		} catch {
			// The descriptor restoration below performs the final check.
		}
	}
	if (snapshot.hadOwn && snapshot.descriptor) {
		try {
			Object.defineProperty(globalThis, 'Module', snapshot.descriptor);
		} catch (error) {
			throw new Error(
				`Julia runtime Module global could not be restored: ${errorMessage(error)}`
			);
		}
		return;
	}
	try {
		delete globalThis.Module;
	} catch {
		// importScripts var bindings may prevent deletion; reset them below.
	}
	if (Object.prototype.hasOwnProperty.call(globalThis, 'Module')) {
		assignModule(undefined, 'Julia runtime Module global could not be reset');
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
	const bytes = textEncoder.encode(`${text}\0`);
	const pointer = module._malloc(bytes.length);
	module.HEAPU8.set(bytes, pointer);
	return pointer;
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

async function initializeJuliaRuntime(verified, stdinReader, stdout, stderr) {
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
	assignModule(module, 'Julia host Module could not be installed');
	const initializedModule = await new Promise((resolve, reject) => {
		let evaluationComplete = false;
		let runtimeInitialized = false;
		module.onRuntimeInitialized = () => {
			try {
				module._jl_initialize();
				runtimeInitialized = true;
				if (evaluationComplete) resolve(module);
			} catch (error) {
				reject(error);
			}
		};
		module.onAbort = (reason) => reject(new Error(String(reason || 'Julia runtime aborted')));
		try {
			importVerifiedRuntimeScript(verified.javascriptBytes);
			if (globalThis.Module !== module) {
				throw new Error('Julia runtime Module changed during verified evaluation.');
			}
			evaluationComplete = true;
			if (runtimeInitialized) resolve(module);
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

async function runVerifiedJulia(
	verified,
	code,
	stdin,
	stdinChannel,
	activePath,
	stdinReader,
	stdout,
	stderr
) {
	const previousModule = snapshotModuleGlobal();
	let finishOutput = () => {};
	let failure;
	try {
		clearModuleGlobal();
		const runtime = await initializeJuliaRuntime(verified, stdinReader, stdout, stderr);
		const { module } = runtime;
		finishOutput = runtime.finishOutput;
		const runnerSource = buildRunnerSource(code, stdin, activePath, stdinChannel !== undefined);
		const sourcePointer = cString(module, runnerSource);
		try {
			module._jl_eval_string(sourcePointer);
		} finally {
			module._free(sourcePointer);
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
	} catch (error) {
		failure = error;
	}
	try {
		finishOutput();
		restoreModuleGlobal(previousModule);
	} catch (cleanupError) {
		throw new AggregateError(
			failure ? [failure, cleanupError] : [cleanupError],
			failure
				? `${errorMessage(failure)}; Julia runtime Module cleanup failed.`
				: 'Julia runtime Module cleanup failed.'
		);
	}
	if (failure) throw failure;
}

self.onmessage = async (event) => {
	if (requestConsumed) {
		self.postMessage({ error: 'Julia worker accepts exactly one run.' });
		return;
	}
	requestConsumed = true;
	const {
		runtimePreflight,
		maxAssetBytes,
		code,
		stdin,
		stdinChannel,
		activePath = 'main.jl',
		log
	} = event.data || {};
	const stdout = [];
	const stderr = [];
	try {
		if (
			typeof code !== 'string' ||
			typeof activePath !== 'string' ||
			(stdin !== undefined && typeof stdin !== 'string')
		) {
			throw new Error('Julia code, run path, and buffered stdin are invalid.');
		}
		if (log) console.log('[wasm-idle:julia-worker] run start');
		const stdinReader = createStdinReader(stdin, stdinChannel);
		const verified = await verifyRuntimePreflight(runtimePreflight, maxAssetBytes);
		await runVerifiedJulia(
			verified,
			code,
			stdin || '',
			stdinChannel,
			activePath,
			stdinReader,
			stdout,
			stderr
		);
		if (log) console.log('[wasm-idle:julia-worker] run settled');
		self.postMessage({ results: true });
	} catch (error) {
		const message = stderr.length > 0 ? stderr.join('\n') : errorMessage(error);
		if (log) console.error('[wasm-idle:julia-worker] failed', error);
		self.postMessage({ error: message });
	} finally {
		self.close();
	}
};
