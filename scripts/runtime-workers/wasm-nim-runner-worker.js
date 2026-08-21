const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
const fatalDecoder = new TextDecoder('utf-8', { fatal: true });
const preflightProtocol = 'wasm-idle-nim-preflight';
const preflightProtocolVersion = 1;
const manifestFormat = 'wasm-nim-runtime-manifest-v2';
const fingerprintDomain = 'wasm-idle:nim-runtime-manifest:v2';
const expectedRuntime = 'benagastov-nim-wasm-compiler';
const hardMaxAssetBytes = 40 * 1024 * 1024;
const hardMaxTotalLogicalBytes = 96 * 1024 * 1024;
const maxManifestBytes = 64 * 1024;
const expectedIdentity = Object.freeze({
	profileId: '__WASM_IDLE_NIM_PROFILE_ID__',
	artifactRevision: '__WASM_IDLE_NIM_ARTIFACT_REVISION__',
	nimRevision: '__WASM_IDLE_NIM_NIM_REVISION__',
	llvmRevision: '__WASM_IDLE_NIM_LLVM_REVISION__',
	memfsRevision: '__WASM_IDLE_NIM_MEMFS_REVISION__',
	emscriptenRevision: '__WASM_IDLE_NIM_EMSCRIPTEN_REVISION__',
	manifestFingerprint: '__WASM_IDLE_NIM_MANIFEST_FINGERPRINT__'
});
const expectedLicenseExpression =
	'MIT AND Apache-2.0 AND Apache-2.0 WITH LLVM-exception AND LicenseRef-WASI-Sysroot-Third-Party';
const expectedArtifact = Object.freeze({
	kind: 'content-locked-git-archive-prebuilt',
	repository: 'https://github.com/benagastov/Nim-WASM-Compiler.git',
	revision: 'ca3471ae124b40b51268da6e202753dfa061731c',
	archiveUrl:
		'https://codeload.github.com/benagastov/Nim-WASM-Compiler/tar.gz/ca3471ae124b40b51268da6e202753dfa061731c',
	archiveRoot: 'Nim-WASM-Compiler-ca3471ae124b40b51268da6e202753dfa061731c',
	verifiedBuildInput: false,
	bytes: 45276618,
	sha256: '699745b3784ed544988b1524f4d718c16b8eb85de4af4809b48d3c3b299df101'
});
const expectedComponents = Object.freeze({
	distribution: Object.freeze({
		version: 'ca3471ae124b40b51268da6e202753dfa061731c',
		repository: 'https://github.com/benagastov/Nim-WASM-Compiler.git',
		revision: 'ca3471ae124b40b51268da6e202753dfa061731c',
		verifiedBuildInput: false,
		evidence: 'content-locked repository archive containing opaque prebuilt compiler assets'
	}),
	nim: Object.freeze({
		version: '2.2.4',
		repository: 'https://github.com/nim-lang/Nim.git',
		revision: 'f7145dd26efeeeb6eeae6fff649db244d81b212d',
		verifiedBuildInput: false,
		evidence:
			'nimbase.h is byte-exact to the v2.2.4 tag; compiler JavaScript/Wasm binary-to-source attestation is unavailable'
	}),
	llvm: Object.freeze({
		version: '8.0.1',
		repository: 'https://github.com/binji/wasm-clang.git',
		revision: '8e78cdb9caa80f75ed86d6632cb4e9310b22748c',
		archiveUrl:
			'https://codeload.github.com/binji/wasm-clang/tar.gz/8e78cdb9caa80f75ed86d6632cb4e9310b22748c',
		archiveBytes: 19376593,
		archiveSha256: '37ab5be0c68d1459a7e3e70d6214300858f7e53628efcbc0058953421f394fca',
		verifiedBuildInput: false,
		evidence:
			'clang, lld, memfs, and sysroot blobs are byte-exact to the pinned wasm-clang commit; compiler build inputs remain unattested'
	}),
	memfs: Object.freeze({
		version: 'clang-9.0.0-custom-producers-section',
		repository: 'https://github.com/llvm/llvm-project.git',
		revision: '0399d5a9682b3cef71c653373e38890c63c4c365',
		verifiedBuildInput: false,
		evidence: 'embedded producers-section identity only; binary build recipe is unavailable'
	}),
	emscripten: Object.freeze({
		version: 'unrecorded',
		repository: 'https://github.com/emscripten-core/emscripten.git',
		revision: 'unrecorded',
		verifiedBuildInput: false,
		evidence: 'opaque prebuilt Nim compiler loader without a recorded Emscripten revision'
	})
});
const expectedLicense = Object.freeze({
	path: 'LICENSE',
	spdx: expectedLicenseExpression
});
const expectedNotices = Object.freeze({
	path: 'THIRD_PARTY_NOTICES.md',
	mediaType: 'text/markdown'
});
const expectedDocumentation = Object.freeze({
	path: 'README.md',
	mediaType: 'text/markdown'
});
const expectedAssets = Object.freeze({
	'clang/clang.js': Object.freeze({ mediaType: 'text/javascript' }),
	'clang/clang.wasm': Object.freeze({ mediaType: 'application/wasm' }),
	'clang/lld.wasm': Object.freeze({ mediaType: 'application/wasm' }),
	'clang/memfs.wasm': Object.freeze({ mediaType: 'application/wasm' }),
	'clang/sysroot.tar': Object.freeze({ mediaType: 'application/x-tar' }),
	'nim/nim-bundle.js': Object.freeze({ mediaType: 'text/javascript' }),
	'nim/nim.wasm': Object.freeze({ mediaType: 'application/wasm' }),
	'nim/nimbase.h': Object.freeze({ mediaType: 'text/x-c-header' })
});
const expectedStorage = Object.freeze({
	'clang/clang.js.bin': Object.freeze({
		logicalPath: 'clang/clang.js',
		encoding: 'identity'
	}),
	'clang/clang.wasm.gz.bin': Object.freeze({
		logicalPath: 'clang/clang.wasm',
		encoding: 'gzip'
	}),
	'clang/lld.wasm.gz.bin': Object.freeze({
		logicalPath: 'clang/lld.wasm',
		encoding: 'gzip'
	}),
	'clang/memfs.wasm.gz.bin': Object.freeze({
		logicalPath: 'clang/memfs.wasm',
		encoding: 'gzip'
	}),
	'clang/sysroot.tar.gz.bin': Object.freeze({
		logicalPath: 'clang/sysroot.tar',
		encoding: 'gzip'
	}),
	'nim/nim-bundle.js.gz.bin': Object.freeze({
		logicalPath: 'nim/nim-bundle.js',
		encoding: 'gzip'
	}),
	'nim/nim.wasm.gz.bin': Object.freeze({
		logicalPath: 'nim/nim.wasm',
		encoding: 'gzip'
	}),
	'nim/nimbase.h.bin': Object.freeze({
		logicalPath: 'nim/nimbase.h',
		encoding: 'identity'
	})
});
const preflightKeys = Object.freeze(
	[
		'artifactRevision',
		'clangJavaScriptBytes',
		'clangWasmBytes',
		'emscriptenRevision',
		'lldWasmBytes',
		'manifestBytes',
		'manifestFingerprint',
		'memfsRevision',
		'memfsWasmBytes',
		'nimJavaScriptBytes',
		'nimRevision',
		'nimWasmBytes',
		'nimbaseBytes',
		'profileId',
		'protocol',
		'protocolVersion',
		'sysrootBytes',
		'llvmRevision'
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
		'notices',
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
	if (primitive === undefined) throw new Error('Nim manifest contains a non-JSON value.');
	return primitive;
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
		throw new Error('Nim runtime asset byte limit is invalid.');
	}
	const maxAssetBytes = Math.min(requestedMaxAssetBytes, hardMaxAssetBytes);
	if (!isObject(runtimePreflight) || !hasExactKeys(runtimePreflight, preflightKeys)) {
		throw new Error('Nim runtime preflight payload has an invalid shape.');
	}
	if (
		runtimePreflight.protocol !== preflightProtocol ||
		runtimePreflight.protocolVersion !== preflightProtocolVersion ||
		runtimePreflight.profileId !== expectedIdentity.profileId ||
		runtimePreflight.artifactRevision !== expectedIdentity.artifactRevision ||
		runtimePreflight.nimRevision !== expectedIdentity.nimRevision ||
		runtimePreflight.llvmRevision !== expectedIdentity.llvmRevision ||
		runtimePreflight.memfsRevision !== expectedIdentity.memfsRevision ||
		runtimePreflight.emscriptenRevision !== expectedIdentity.emscriptenRevision ||
		runtimePreflight.manifestFingerprint !== expectedIdentity.manifestFingerprint ||
		!isUint8Array(runtimePreflight.manifestBytes) ||
		!isUint8Array(runtimePreflight.nimJavaScriptBytes) ||
		!isUint8Array(runtimePreflight.nimWasmBytes) ||
		!isUint8Array(runtimePreflight.nimbaseBytes) ||
		!isUint8Array(runtimePreflight.clangJavaScriptBytes) ||
		!isUint8Array(runtimePreflight.clangWasmBytes) ||
		!isUint8Array(runtimePreflight.lldWasmBytes) ||
		!isUint8Array(runtimePreflight.memfsWasmBytes) ||
		!isUint8Array(runtimePreflight.sysrootBytes)
	) {
		throw new Error('Nim runtime preflight payload is invalid.');
	}
	for (const [label, bytes, limit] of [
		[
			'Nim runtime manifest',
			runtimePreflight.manifestBytes,
			Math.min(maxManifestBytes, maxAssetBytes)
		],
		['Nim runtime JavaScript', runtimePreflight.nimJavaScriptBytes, maxAssetBytes],
		['Nim runtime Wasm', runtimePreflight.nimWasmBytes, maxAssetBytes],
		['Nim runtime header', runtimePreflight.nimbaseBytes, maxAssetBytes],
		['Nim clang JavaScript', runtimePreflight.clangJavaScriptBytes, maxAssetBytes],
		['Nim clang Wasm', runtimePreflight.clangWasmBytes, maxAssetBytes],
		['Nim lld Wasm', runtimePreflight.lldWasmBytes, maxAssetBytes],
		['Nim memfs Wasm', runtimePreflight.memfsWasmBytes, maxAssetBytes],
		['Nim sysroot', runtimePreflight.sysrootBytes, maxAssetBytes]
	]) {
		if (bytes.byteLength <= 0 || bytes.byteLength > limit) {
			throw new Error(`${label} exceeds its byte limit.`);
		}
	}
	const totalLogicalBytes = [
		runtimePreflight.nimJavaScriptBytes,
		runtimePreflight.nimWasmBytes,
		runtimePreflight.nimbaseBytes,
		runtimePreflight.clangJavaScriptBytes,
		runtimePreflight.clangWasmBytes,
		runtimePreflight.lldWasmBytes,
		runtimePreflight.memfsWasmBytes,
		runtimePreflight.sysrootBytes
	].reduce((total, bytes) => total + bytes.byteLength, 0);
	if (totalLogicalBytes > hardMaxTotalLogicalBytes) {
		throw new Error('Nim runtime logical payload exceeds its aggregate byte limit.');
	}
	return { runtimePreflight, maxAssetBytes };
}

async function sha256Hex(bytes) {
	if (!globalThis.crypto?.subtle?.digest) {
		throw new Error('Nim runtime integrity verification requires Web Crypto.');
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
	notices,
	documentation,
	metadata,
	assets,
	storage
) {
	let canonical = `${fingerprintDomain}\nformat\0${manifestFormat}\nruntime\0${expectedRuntime}\nprofileId\0${profileId}\n`;
	canonical += `licenseExpression\0${licenseExpression}\n`;
	canonical += `artifact\0${canonicalJson(artifact)}\n`;
	canonical += `components\0${canonicalJson(components)}\n`;
	canonical += `license\0${license.path}\0${license.spdx}\0${license.size}\0${license.sha256}\n`;
	canonical += `notices\0${notices.path}\0${notices.mediaType}\0${notices.size}\0${notices.sha256}\n`;
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
		throw new Error(`Nim runtime ${label} metadata is invalid.`);
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
		throw new Error(`Nim runtime storage receipt is invalid for ${expected.path}.`);
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
	if (!isObject(value)) throw new Error('Nim runtime manifest must be an object.');
	if (!hasExactKeys(value, expectedManifestKeys)) {
		throw new Error('Nim runtime manifest schema is invalid.');
	}
	if (value.format !== manifestFormat || value.runtime !== expectedRuntime) {
		throw new Error('Nim runtime manifest format is unsupported.');
	}
	if (
		value.profileId !== expectedIdentity.profileId ||
		value.profileId !== runtimePreflight.profileId ||
		value.licenseExpression !== expectedLicenseExpression ||
		value.fingerprint !== expectedIdentity.manifestFingerprint ||
		value.fingerprint !== runtimePreflight.manifestFingerprint
	) {
		throw new Error('Nim runtime profile or manifest fingerprint is invalid.');
	}
	const artifact = normalizeProvenanceObject(value.artifact, expectedArtifact, 'artifact');
	const components = normalizeProvenanceObject(value.components, expectedComponents, 'component');
	if (
		artifact.revision !== runtimePreflight.artifactRevision ||
		components.distribution.revision !== runtimePreflight.artifactRevision ||
		components.nim.revision !== runtimePreflight.nimRevision ||
		components.llvm.revision !== runtimePreflight.llvmRevision ||
		components.memfs.revision !== runtimePreflight.memfsRevision ||
		components.emscripten.revision !== runtimePreflight.emscriptenRevision
	) {
		throw new Error('Nim runtime manifest identity is incoherent.');
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
		throw new Error('Nim runtime license receipt is invalid.');
	}
	const license = {
		path: expectedLicense.path,
		spdx: expectedLicense.spdx,
		size: value.license.size,
		sha256: value.license.sha256
	};
	const notices = normalizeReceipt(
		value.notices,
		expectedNotices,
		maxAssetBytes,
		'Nim runtime third-party notices'
	);
	const documentation = normalizeReceipt(
		value.documentation,
		expectedDocumentation,
		maxAssetBytes,
		'Nim runtime documentation'
	);
	const metadata = normalizeReceipt(
		value.metadata,
		{ path: 'runtime-build.json', mediaType: 'application/json' },
		maxAssetBytes,
		'Nim runtime metadata'
	);
	if (!Array.isArray(value.assets) || value.assets.length !== 8) {
		throw new Error('Nim runtime manifest must declare exactly eight logical assets.');
	}
	if (!Array.isArray(value.storage) || value.storage.length !== 8) {
		throw new Error('Nim runtime manifest must declare exactly eight storage assets.');
	}
	const assetByPath = new Map();
	for (const candidate of value.assets) {
		const expected = expectedAssets[candidate?.path];
		if (!expected || assetByPath.has(candidate.path)) {
			throw new Error('Nim runtime manifest has an unexpected or duplicate logical asset.');
		}
		assetByPath.set(
			candidate.path,
			normalizeReceipt(
				candidate,
				{ path: candidate.path, mediaType: expected.mediaType },
				maxAssetBytes,
				`Nim runtime asset ${candidate.path}`
			)
		);
	}
	const storageByPath = new Map();
	const storageByLogicalPath = new Map();
	for (const candidate of value.storage) {
		const expected = expectedStorage[candidate?.path];
		if (
			!expected ||
			storageByPath.has(candidate.path) ||
			storageByLogicalPath.has(expected.logicalPath)
		) {
			throw new Error('Nim runtime manifest has an unexpected or duplicate storage asset.');
		}
		const normalized = normalizeStorageReceipt(
			candidate,
			{ path: candidate.path, ...expected },
			maxAssetBytes
		);
		storageByPath.set(candidate.path, normalized);
		storageByLogicalPath.set(normalized.logicalPath, normalized);
	}
	if (
		Object.keys(expectedAssets).some((path) => !assetByPath.has(path)) ||
		Object.keys(expectedStorage).some((path) => !storageByPath.has(path))
	) {
		throw new Error('Nim runtime manifest is missing a required receipt.');
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
			notices,
			documentation,
			metadata,
			assets,
			storage
		)) !== runtimePreflight.manifestFingerprint
	) {
		throw new Error('Nim runtime receipt graph failed fingerprint verification.');
	}
	return { assetByPath };
}

async function verifyReceiptBytes(receipt, bytes, label) {
	if (bytes.byteLength !== receipt.size) throw new Error(`${label} has an unexpected byte size.`);
	if ((await sha256Hex(bytes)) !== receipt.sha256) {
		throw new Error(`${label} failed SHA-256 verification.`);
	}
}

function validateUtf8(bytes, label) {
	try {
		return fatalDecoder.decode(bytes);
	} catch {
		throw new Error(`${label} is not valid UTF-8.`);
	}
}

function validateWasmHeader(bytes, label) {
	if (
		bytes.byteLength < 8 ||
		bytes[0] !== 0 ||
		bytes[1] !== 0x61 ||
		bytes[2] !== 0x73 ||
		bytes[3] !== 0x6d
	) {
		throw new Error(`${label} header is invalid.`);
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
		throw new Error('Nim runtime manifest is not valid UTF-8 JSON.');
	}
	const manifest = await normalizeManifest(parsed, runtimePreflight, maxAssetBytes);
	const logicalBytes = new Map([
		['nim/nim-bundle.js', runtimePreflight.nimJavaScriptBytes],
		['nim/nim.wasm', runtimePreflight.nimWasmBytes],
		['nim/nimbase.h', runtimePreflight.nimbaseBytes],
		['clang/clang.js', runtimePreflight.clangJavaScriptBytes],
		['clang/clang.wasm', runtimePreflight.clangWasmBytes],
		['clang/lld.wasm', runtimePreflight.lldWasmBytes],
		['clang/memfs.wasm', runtimePreflight.memfsWasmBytes],
		['clang/sysroot.tar', runtimePreflight.sysrootBytes]
	]);
	for (const [path, bytes] of logicalBytes) {
		await verifyReceiptBytes(
			manifest.assetByPath.get(path),
			bytes,
			`Nim runtime asset ${path}`
		);
	}
	validateUtf8(runtimePreflight.nimJavaScriptBytes, 'Nim runtime JavaScript');
	validateUtf8(runtimePreflight.nimbaseBytes, 'Nim runtime nimbase.h');
	validateUtf8(runtimePreflight.clangJavaScriptBytes, 'Nim runtime clang/clang.js');
	for (const [label, bytes] of [
		['Nim runtime Wasm', runtimePreflight.nimWasmBytes],
		['Nim clang Wasm', runtimePreflight.clangWasmBytes],
		['Nim lld Wasm', runtimePreflight.lldWasmBytes],
		['Nim memfs Wasm', runtimePreflight.memfsWasmBytes]
	]) {
		validateWasmHeader(bytes, label);
	}
	const consumed = new Set();
	return Object.freeze({
		take(assetPath) {
			if (!logicalBytes.has(assetPath)) {
				throw new Error(`Nim requested an undeclared runtime asset: ${assetPath}`);
			}
			if (consumed.has(assetPath)) {
				throw new Error(`Nim runtime asset was already consumed: ${assetPath}`);
			}
			consumed.add(assetPath);
			return logicalBytes.get(assetPath);
		}
	});
}

function importVerifiedRuntimeScript(bytes) {
	try {
		fatalDecoder.decode(bytes);
	} catch {
		throw new Error('Nim runtime JavaScript is not valid UTF-8.');
	}
	if (
		typeof Blob !== 'function' ||
		typeof URL.createObjectURL !== 'function' ||
		typeof URL.revokeObjectURL !== 'function' ||
		typeof importScripts !== 'function'
	) {
		throw new Error('Nim verified runtime evaluation is unavailable.');
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

function exactArrayBuffer(bytes) {
	if (bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength) {
		return bytes.buffer;
	}
	return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

function postProgress(percent, stage) {
	self.postMessage({ progress: { percent, stage } });
}

function splitLines(text) {
	return String(text || '')
		.replace(/\x1b\[[0-9;]*m/g, '')
		.split('\n')
		.map((line) => line.trimEnd())
		.filter(Boolean);
}

const runtimeGlobalNames = Object.freeze([
	'Nim',
	'Module',
	'FS',
	'callMain',
	'print',
	'printErr',
	'__NIM_USER_CODE__',
	'__NIM_USER_CODE_PENDING__',
	'__NIM_USER_PATH__',
	'__NIM_USER_CODE_WRITTEN__'
]);

function snapshotRuntimeGlobals() {
	return runtimeGlobalNames.map((name) => ({
		name,
		hadOwn: Object.prototype.hasOwnProperty.call(globalThis, name),
		descriptor: Object.getOwnPropertyDescriptor(globalThis, name)
	}));
}

function clearRuntimeGlobal(name, label) {
	const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
	if (!descriptor) return;
	if (descriptor.configurable) {
		delete globalThis[name];
	} else if ('writable' in descriptor && descriptor.writable) {
		globalThis[name] = undefined;
	} else {
		throw new Error(label);
	}
	if (globalThis[name] !== undefined) throw new Error(label);
}

function clearRuntimeGlobals() {
	for (const name of runtimeGlobalNames) {
		clearRuntimeGlobal(name, `Nim runtime global ${name} could not be cleared.`);
	}
}

function restoreRuntimeGlobals(snapshot) {
	const failures = [];
	for (const item of snapshot) {
		try {
			const current = Object.getOwnPropertyDescriptor(globalThis, item.name);
			if (current?.configurable) delete globalThis[item.name];
			else if (current && 'writable' in current && current.writable) {
				globalThis[item.name] = undefined;
			}
			if (item.hadOwn && item.descriptor) {
				const remaining = Object.getOwnPropertyDescriptor(globalThis, item.name);
				if (!remaining) Object.defineProperty(globalThis, item.name, item.descriptor);
				else if (
					'value' in item.descriptor &&
					'writable' in remaining &&
					remaining.writable
				) {
					globalThis[item.name] = item.descriptor.value;
				} else {
					throw new Error('descriptor is not restorable');
				}
			} else {
				clearRuntimeGlobal(
					item.name,
					`Nim runtime global ${item.name} could not be reset.`
				);
			}
		} catch (error) {
			failures.push(error);
		}
	}
	if (failures.length) {
		throw new AggregateError(failures, 'Nim runtime global cleanup failed.');
	}
}

async function installNimCompiler(verifiedRuntime, stdout, stderr) {
	const [wasmBytes, bundleBytes] = await Promise.all([
		verifiedRuntime.take('nim/nim.wasm'),
		verifiedRuntime.take('nim/nim-bundle.js')
	]);
	return new Promise((resolve, reject) => {
		const module = {
			noInitialRun: true,
			wasmBinary: exactArrayBuffer(wasmBytes),
			locateFile(path) {
				const value = String(path);
				if (value.endsWith('nim.wasm')) return 'wasm-idle-verified:nim.wasm';
				throw new Error(`Nim requested an undeclared compiler asset: ${value}`);
			},
			print: (text) => stdout.push(String(text)),
			printErr: (text) => stderr.push(String(text)),
			onRuntimeInitialized: () => resolve()
		};
		self.Nim = module;
		self.Module = module;
		try {
			importVerifiedRuntimeScript(bundleBytes);
		} catch (error) {
			reject(error);
		}
	});
}

async function loadNimCompiler(verifiedRuntime, stdout, stderr) {
	await installNimCompiler(verifiedRuntime, stdout, stderr);
	const started = Date.now();
	while (typeof self.FS === 'undefined' || typeof self.callMain !== 'function') {
		if (Date.now() - started > 30000) throw new Error('Nim compiler did not initialize.');
		await new Promise((resolve) => setTimeout(resolve, 25));
	}
	return { FS: self.FS, callMain: self.callMain };
}

function withCapturedConsole(stdout, stderr, callback) {
	const originalLog = console.log;
	const originalError = console.error;
	const originalPrint = self.print;
	const originalPrintErr = self.printErr;
	console.log = (...args) => stdout.push(args.map(String).join(' '));
	console.error = (...args) => stderr.push(args.map(String).join(' '));
	self.print = (text) => stdout.push(String(text));
	self.printErr = (text) => stderr.push(String(text));
	try {
		return callback();
	} finally {
		console.log = originalLog;
		console.error = originalError;
		self.print = originalPrint;
		self.printErr = originalPrintErr;
	}
}

function compileNimToC({ FS, callMain }, code, stdout, stderr) {
	self.__NIM_USER_CODE__ = code;
	self.__NIM_USER_CODE_PENDING__ = code;
	self.__NIM_USER_PATH__ = '/tmp/user.nim';
	self.__NIM_USER_CODE_WRITTEN__ = false;

	let returnCode = 0;
	try {
		returnCode = withCapturedConsole(stdout, stderr, () =>
			callMain([
				'c',
				'--hints:off',
				'-d:release',
				'-d:useMalloc',
				'--path:/lib/pure',
				'--path:/lib/pure/collections',
				'--path:/lib/core',
				'-o:/tmp/user',
				'/tmp/user.nim'
			])
		);
	} catch (error) {
		stderr.push(`[nim] callMain failed: ${error?.message || error}`);
		returnCode = -1;
	}

	const cacheDir = '/home/web_user/.cache/nim/user_r';
	let entries;
	try {
		entries = FS.readdir(cacheDir);
	} catch (error) {
		throw new Error(
			`Nim did not emit C files.${returnCode ? ` Exit code: ${returnCode}.` : ''}\n${stderr.join(
				'\n'
			)}`
		);
	}

	const cFiles = entries
		.filter((file) => file.endsWith('.nim.c') || file.endsWith('.nim.cpp'))
		.sort();
	if (cFiles.length === 0) {
		throw new Error(
			`Nim did not emit C files.${returnCode ? ` Exit code: ${returnCode}.` : ''}\n${stderr.join(
				'\n'
			)}`
		);
	}

	return { cacheDir, cFiles };
}

function prepareTranslationUnit(source, nimbaseContent) {
	const cleaned = source
		.split('\n')
		.filter((line) => !/^#include\s+["<](?:\/lib\/)?nimbase\.h[">]\s*$/.test(line))
		.filter((line) => !/^#include\s+<errno\.h>\s*$/.test(line))
		.filter((line) => !/^#define NIM_INTBITS/.test(line))
		.filter((line) => !/^#define NIM_EmulateOverflowChecks/.test(line))
		.filter(
			(line) =>
				!/^#undef (LANGUAGE_C|MIPSEB|MIPSEL|PPC|R3000|R4000|i386|linux|mips|near|far|powerpc|unix)\s*$/.test(
					line
				)
		)
		.join('\n')
		.replace(
			/int main\(int (\w+), char\*\* (\w+), char\*\* (\w+)\) \{/,
			'int main(int $1, char** $2) {\n\tchar** $3 = (char**)0;'
		);
	const header = `/* Combined Nim/WASI header. */
#define NIM_INTBITS 32
#define NIM_EmulateOverflowChecks
#include <signal.h>
#include <string.h>
typedef void (*__sighandler_t)(int);
#ifndef SIG_IGN
#define SIG_IGN ((__sighandler_t)1)
#endif
#ifndef SIG_DFL
#define SIG_DFL ((__sighandler_t)0)
#endif
#ifndef SIG_ERR
#define SIG_ERR ((__sighandler_t)-1)
#endif
static __sighandler_t signal(int sig, __sighandler_t handler) { (void)sig; (void)handler; return SIG_DFL; }
__attribute__((weak)) int raise(int sig) { (void)sig; return 0; }
typedef long int __jmp_buf[8];
typedef struct { __jmp_buf __jmpbuf; int __mask_was_saved; } __jmp_buf_tag;
typedef __jmp_buf_tag jmp_buf[1];
extern int setjmp(jmp_buf __env) __attribute__((__nothrow__));
_Noreturn void longjmp(jmp_buf __env, int __val) __attribute__((__nothrow__));
${nimbaseContent}
#include <errno.h>
#undef errno
static int wasm_idle_errno;
#define errno wasm_idle_errno
`;
	return `${header}\n${cleaned}\n`;
}

async function buildWasm({ verifiedRuntime, code, stdout, stderr }) {
	postProgress(5, 'Loading Nim compiler');
	const nim = await loadNimCompiler(verifiedRuntime, stdout, stderr);
	postProgress(20, 'Translating Nim to C');
	const { cacheDir, cFiles } = compileNimToC(nim, code, stdout, stderr);
	let nimbaseContent;
	try {
		nimbaseContent = fatalDecoder.decode(await verifiedRuntime.take('nim/nimbase.h'));
	} catch {
		throw new Error('Nim runtime nimbase.h is not valid UTF-8.');
	}
	const files = cFiles.map((file, index) => ({
		input: `w${index}.c`,
		code: prepareTranslationUnit(
			nim.FS.readFile(`${cacheDir}/${file}`, { encoding: 'utf8' }),
			nimbaseContent
		)
	}));
	postProgress(35, 'Preparing Nim C output');
	const clangSourceBytes = await verifiedRuntime.take('clang/clang.js');
	try {
		fatalDecoder.decode(clangSourceBytes);
	} catch {
		throw new Error('Nim runtime clang/clang.js is not valid UTF-8.');
	}
	if (
		typeof Blob !== 'function' ||
		typeof URL.createObjectURL !== 'function' ||
		typeof URL.revokeObjectURL !== 'function'
	) {
		throw new Error('Nim verified clang module evaluation is unavailable.');
	}
	const compilerAssets = {};
	for (const assetName of ['clang.wasm', 'lld.wasm', 'memfs.wasm', 'sysroot.tar']) {
		compilerAssets[assetName] = exactArrayBuffer(
			await verifiedRuntime.take(`clang/${assetName}`)
		);
	}
	const clangModuleUrl = URL.createObjectURL(
		new Blob([clangSourceBytes], { type: 'text/javascript' })
	);
	const clangLogs = [];
	const originalLog = console.log;
	let output;
	try {
		const clangModule = await import(clangModuleUrl);
		console.log = (...args) => clangLogs.push(args.map(String).join(' '));
		await clangModule.init({ assets: compilerAssets });
		postProgress(50, 'Compiling and linking Nim output');
		const result = await clangModule.compileEachLink(files, 'app.wasm');
		if (result && result.ok === false && result.error) {
			throw new Error(result.error);
		}
		postProgress(75, 'Loading Nim executable');
		output = await clangModule.getFile('app.wasm');
	} catch (error) {
		const logText = clangLogs.flatMap(splitLines).slice(-40).join('\n');
		throw new Error(
			`Nim clang/lld build failed: ${error?.message || error}${logText ? `\n${logText}` : ''}`
		);
	} finally {
		console.log = originalLog;
		try {
			URL.revokeObjectURL(clangModuleUrl);
		} catch {
			// Blob cleanup must not replace the compiler outcome.
		}
	}
	if (!output?.ok || !output.bytes) {
		throw new Error(output?.error || 'Nim build did not produce app.wasm.');
	}
	return output.bytes;
}

class ProcExit extends Error {
	constructor(code) {
		super(`exit ${code}`);
		this.code = code;
	}
}

function createStdinReader(stdin, channel) {
	if (channel === undefined) {
		const bytes = textEncoder.encode(stdin);
		let offset = 0;
		return {
			read(maxLength) {
				const count = Math.min(maxLength, bytes.length - offset);
				if (count <= 0) return new Uint8Array();
				const chunk = bytes.slice(offset, offset + count);
				offset += count;
				return chunk;
			}
		};
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
		throw new Error('Invalid Nim streaming stdin channel.');
	}

	const control = new Int32Array(channel.buffer, 0, 4);
	const bytes = new Uint8Array(channel.buffer, channel.controlBytes, channel.capacity);
	return {
		read(maxLength) {
			if (!Number.isSafeInteger(maxLength) || maxLength <= 0) return new Uint8Array();
			while (true) {
				if (Atomics.load(control, 3) === 1) {
					throw new Error('Nim streaming stdin was cancelled.');
				}
				const write = Atomics.load(control, 0);
				const read = Atomics.load(control, 1);
				const available = write - read;
				if (available < 0 || available > bytes.byteLength) {
					throw new Error('Nim streaming stdin counters are invalid.');
				}
				if (available > 0) {
					const count = Math.min(maxLength, available);
					const chunk = new Uint8Array(count);
					const start = read % bytes.byteLength;
					const first = Math.min(count, bytes.byteLength - start);
					chunk.set(bytes.subarray(start, start + first));
					if (first < count) chunk.set(bytes.subarray(0, count - first), first);
					Atomics.store(control, 1, read + count);
					self.postMessage({ type: 'stdin-request' });
					return chunk;
				}
				if (Atomics.load(control, 2) === 1) return new Uint8Array();
				self.postMessage({ type: 'stdin-request' });
				Atomics.wait(control, 0, write);
			}
		}
	};
}

function createOutputCollector(onChunk) {
	const chunks = [];
	const decoder = new TextDecoder();
	let finished = false;
	return {
		push(chunk) {
			chunks.push(chunk);
			const text = decoder.decode(chunk, { stream: true });
			if (text) onChunk(text);
		},
		finish() {
			if (finished) return;
			finished = true;
			const text = decoder.decode();
			if (text) onChunk(text);
		},
		text() {
			const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
			const all = new Uint8Array(total);
			let offset = 0;
			for (const chunk of chunks) {
				all.set(chunk, offset);
				offset += chunk.length;
			}
			return textDecoder.decode(all);
		}
	};
}

function createWasiRunner({
	stdinReader,
	args = [],
	activePath = 'main.nim',
	onStdout = () => {},
	onStderr = () => {}
}) {
	let memory = null;
	const stdout = createOutputCollector(onStdout);
	const stderr = createOutputCollector(onStderr);
	const u8 = () => new Uint8Array(memory.buffer);
	const dv = () => new DataView(memory.buffer);
	const errnoSuccess = 0;
	const errnoBadf = 8;

	function writeIovs(fd, iovsPtr, iovsLen, writtenPtr) {
		const view = dv();
		let total = 0;
		for (let index = 0; index < iovsLen; index += 1) {
			const ptr = view.getUint32(iovsPtr + index * 8, true);
			const length = view.getUint32(iovsPtr + index * 8 + 4, true);
			if (length > 0) {
				const chunk = u8().slice(ptr, ptr + length);
				(fd === 2 ? stderr : stdout).push(chunk);
				total += length;
			}
		}
		view.setUint32(writtenPtr, total, true);
		return errnoSuccess;
	}

	function readIovs(fd, iovsPtr, iovsLen, readPtr) {
		if (fd !== 0) return errnoBadf;
		const view = dv();
		const iovs = [];
		let requested = 0;
		for (let index = 0; index < iovsLen; index += 1) {
			const ptr = view.getUint32(iovsPtr + index * 8, true);
			const length = view.getUint32(iovsPtr + index * 8 + 4, true);
			iovs.push({ ptr, length });
			requested += length;
		}
		const chunk = stdinReader.read(requested);
		let offset = 0;
		for (const { ptr, length } of iovs) {
			const count = Math.min(length, chunk.length - offset);
			if (count <= 0) break;
			u8().set(chunk.subarray(offset, offset + count), ptr);
			offset += count;
		}
		view.setUint32(readPtr, offset, true);
		return errnoSuccess;
	}

	function writeStringTable(values, countPtr, sizePtr) {
		const encodedValues = values.map((value) => textEncoder.encode(`${value}\0`));
		const totalSize = encodedValues.reduce((total, value) => total + value.length, 0);
		const view = dv();
		view.setUint32(countPtr, encodedValues.length, true);
		view.setUint32(sizePtr, totalSize, true);
		return encodedValues;
	}

	function writeStringPointers(values, argvPtr, bufferPtr) {
		const encodedValues = values.map((value) => textEncoder.encode(`${value}\0`));
		const view = dv();
		let cursor = bufferPtr;
		for (let index = 0; index < encodedValues.length; index += 1) {
			view.setUint32(argvPtr + index * 4, cursor, true);
			u8().set(encodedValues[index], cursor);
			cursor += encodedValues[index].length;
		}
		return errnoSuccess;
	}

	const argv = [activePath, ...args];
	const env = [];
	const importsImpl = {
		proc_exit(code) {
			throw new ProcExit(code);
		},
		fd_write(fd, iovsPtr, iovsLen, writtenPtr) {
			return writeIovs(fd, iovsPtr, iovsLen, writtenPtr);
		},
		fd_read(fd, iovsPtr, iovsLen, readPtr) {
			return readIovs(fd, iovsPtr, iovsLen, readPtr);
		},
		fd_close() {
			return errnoSuccess;
		},
		fd_seek(_fd, _low, _high, _whence, newOffsetPtr) {
			if (typeof newOffsetPtr === 'number') {
				dv().setUint32(newOffsetPtr, 0, true);
				dv().setUint32(newOffsetPtr + 4, 0, true);
			}
			return errnoSuccess;
		},
		fd_fdstat_get(_fd, bufferPtr) {
			const view = dv();
			view.setUint8(bufferPtr, 2);
			view.setUint16(bufferPtr + 2, 0, true);
			view.setBigUint64(bufferPtr + 8, 0xffffffffffffffffn, true);
			view.setBigUint64(bufferPtr + 16, 0xffffffffffffffffn, true);
			return errnoSuccess;
		},
		fd_prestat_get() {
			return errnoBadf;
		},
		fd_prestat_dir_name() {
			return errnoBadf;
		},
		args_sizes_get(countPtr, sizePtr) {
			writeStringTable(argv, countPtr, sizePtr);
			return errnoSuccess;
		},
		args_get(argvPtr, bufferPtr) {
			return writeStringPointers(argv, argvPtr, bufferPtr);
		},
		environ_sizes_get(countPtr, sizePtr) {
			writeStringTable(env, countPtr, sizePtr);
			return errnoSuccess;
		},
		environ_get(argvPtr, bufferPtr) {
			return writeStringPointers(env, argvPtr, bufferPtr);
		},
		clock_time_get(_id, _precision, timePtr) {
			dv().setBigUint64(timePtr, BigInt(Date.now()) * 1000000n, true);
			return errnoSuccess;
		},
		clock_res_get(_id, resolutionPtr) {
			dv().setBigUint64(resolutionPtr, 1000000n, true);
			return errnoSuccess;
		},
		random_get(bufferPtr, length) {
			const target = u8().subarray(bufferPtr, bufferPtr + length);
			if (globalThis.crypto?.getRandomValues) {
				for (let offset = 0; offset < length; offset += 65536) {
					crypto.getRandomValues(
						target.subarray(offset, Math.min(offset + 65536, length))
					);
				}
			} else {
				for (let index = 0; index < length; index += 1) target[index] = Math.random() * 256;
			}
			return errnoSuccess;
		},
		poll_oneoff(_input, _output, _count, eventsPtr) {
			dv().setUint32(eventsPtr, 0, true);
			return errnoSuccess;
		},
		sched_yield() {
			return errnoSuccess;
		}
	};

	function importsFor(module) {
		const imports = {};
		for (const { module: moduleName, name, kind } of WebAssembly.Module.imports(module)) {
			imports[moduleName] = imports[moduleName] || {};
			if (kind === 'function')
				imports[moduleName][name] = importsImpl[name] || (() => errnoSuccess);
		}
		return imports;
	}

	async function run(bytes) {
		const module = await WebAssembly.compile(bytes);
		const instance = await WebAssembly.instantiate(module, importsFor(module));
		memory = instance.exports.memory;
		let code = 0;
		try {
			instance.exports._start();
		} catch (error) {
			if (error instanceof ProcExit) {
				code = error.code;
			} else {
				throw error;
			}
		} finally {
			stdout.finish();
			stderr.finish();
		}
		return { code, stdout: stdout.text(), stderr: stderr.text() };
	}

	return { run };
}

async function runVerifiedNim({
	verifiedRuntime,
	code,
	stdinReader,
	args,
	activePath,
	compilerStdout,
	compilerStderr
}) {
	const snapshot = snapshotRuntimeGlobals();
	let failure;
	let result;
	try {
		clearRuntimeGlobals();
		const wasmBytes = await buildWasm({
			verifiedRuntime,
			code,
			stdout: compilerStdout,
			stderr: compilerStderr
		});
		postProgress(85, 'Running Nim program');
		result = await createWasiRunner({
			stdinReader,
			args,
			activePath,
			onStdout: (output) => self.postMessage({ output }),
			onStderr: (output) => self.postMessage({ output })
		}).run(wasmBytes);
	} catch (error) {
		failure = error;
	}
	try {
		restoreRuntimeGlobals(snapshot);
	} catch (cleanupError) {
		throw new AggregateError(
			failure ? [failure, cleanupError] : [cleanupError],
			failure
				? `${errorMessage(failure)}; Nim runtime global cleanup failed.`
				: 'Nim runtime global cleanup failed.'
		);
	}
	if (failure) throw failure;
	return result;
}

self.onmessage = async (event) => {
	if (requestConsumed) {
		self.postMessage({ error: 'Nim worker accepts exactly one run.' });
		return;
	}
	requestConsumed = true;
	const {
		runtimePreflight,
		maxAssetBytes,
		code,
		stdin,
		stdinChannel,
		args,
		activePath = 'main.nim',
		log
	} = event.data || {};
	const compilerStdout = [];
	const compilerStderr = [];
	try {
		if (
			typeof code !== 'string' ||
			typeof activePath !== 'string' ||
			(stdin !== undefined && typeof stdin !== 'string') ||
			(args !== undefined &&
				(!Array.isArray(args) || args.some((argument) => typeof argument !== 'string')))
		) {
			throw new Error('Nim code, run path, arguments, and buffered stdin are invalid.');
		}
		const stdinReader = createStdinReader(stdin || '', stdinChannel);
		if (log) console.log('[wasm-idle:nim-worker] run start');
		const verifiedRuntime = await verifyRuntimePreflight(runtimePreflight, maxAssetBytes);
		const result = await runVerifiedNim({
			verifiedRuntime,
			code,
			stdinReader,
			args: args || [],
			activePath,
			compilerStdout,
			compilerStderr
		});
		if (result.code !== 0) {
			throw new Error(`Nim program exited with status ${result.code}.`);
		}
		postProgress(100, 'Nim run complete');
		if (log) console.log('[wasm-idle:nim-worker] run settled');
		self.postMessage({ results: true });
	} catch (error) {
		const compilerOutput = [
			...compilerStderr.flatMap(splitLines),
			...compilerStdout.flatMap(splitLines)
		]
			.slice(-60)
			.join('\n');
		const message = `${errorMessage(error)}${compilerOutput ? `\n${compilerOutput}` : ''}`;
		if (log) console.error('[wasm-idle:nim-worker] failed', error);
		self.postMessage({ error: message });
	} finally {
		self.close();
	}
};
