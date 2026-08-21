const encoder = new TextEncoder();
const fatalDecoder = new TextDecoder('utf-8', { fatal: true });
const preflightProtocol = 'wasm-idle-perl-preflight';
const preflightProtocolVersion = 1;
const manifestFormat = 'wasm-perl-runtime-manifest-v2';
const fingerprintDomain = 'wasm-idle:perl-runtime-manifest:v2';
const hardMaxAssetBytes = 16 * 1024 * 1024;
const hardMaxTotalLogicalBytes = 32 * 1024 * 1024;
const maxManifestBytes = 64 * 1024;
const expectedIdentity = Object.freeze({
	profileId: 'webperl-v0.09-beta-perl-5.28.1-emscripten-1.38.28',
	artifactRevision: '6f2173d29a2c2e3536e1de75ff5d291ae96ab348',
	webperlRevision: '6f2173d29a2c2e3536e1de75ff5d291ae96ab348',
	perlRevision: 'e70d909feb796ec99d5e91de5d1635d4526ec131',
	emscriptenRevision: '69ab40586822209758165df170e9fc8b81e05608',
	manifestFingerprint: 'fd0dede426ef3ff3264e71e9d3583530eccd9529fe08632dc1574d9e13a7be3b'
});
const expectedLicenseExpression = 'Artistic-1.0-Perl OR GPL-1.0-or-later';
const expectedArtifact = Object.freeze({
	doi: '10.5281/zenodo.2582586',
	kind: 'opaque-prebuilt',
	path: 'webperl_prebuilt_v0.09-beta.zip',
	repository: 'https://github.com/haukex/webperl.git',
	revision: expectedIdentity.artifactRevision,
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
		revision: expectedIdentity.emscriptenRevision,
		verifiedBuildInput: false,
		version: '1.38.28'
	}),
	perl: Object.freeze({
		evidence: 'embedded runtime version string and versioned WebPerl build configuration',
		repository: 'https://github.com/haukex/emperl5.git',
		revision: expectedIdentity.perlRevision,
		verifiedBuildInput: false,
		version: '5.28.1'
	}),
	webperl: Object.freeze({
		evidence: 'release tag and opaque prebuilt archive',
		repository: 'https://github.com/haukex/webperl.git',
		revision: expectedIdentity.webperlRevision,
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
	'emperl.data.gz.bin': Object.freeze({ logicalPath: 'emperl.data', encoding: 'gzip' }),
	'emperl.js.gz.bin': Object.freeze({ logicalPath: 'emperl.js', encoding: 'gzip' }),
	'emperl.wasm.gz.bin': Object.freeze({ logicalPath: 'emperl.wasm', encoding: 'gzip' })
});
const preflightKeys = Object.freeze(
	[
		'artifactRevision',
		'dataBytes',
		'emscriptenRevision',
		'javascriptBytes',
		'manifestBytes',
		'manifestFingerprint',
		'perlRevision',
		'profileId',
		'protocol',
		'protocolVersion',
		'wasmBytes',
		'webperlRevision'
	].sort()
);
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
		throw new Error('WebPerl runtime asset byte limit is invalid.');
	}
	const maxAssetBytes = Math.min(requestedMaxAssetBytes, hardMaxAssetBytes);
	if (!isObject(runtimePreflight) || !hasExactKeys(runtimePreflight, preflightKeys)) {
		throw new Error('WebPerl runtime preflight payload has an invalid shape.');
	}
	if (
		runtimePreflight.protocol !== preflightProtocol ||
		runtimePreflight.protocolVersion !== preflightProtocolVersion ||
		runtimePreflight.profileId !== expectedIdentity.profileId ||
		runtimePreflight.artifactRevision !== expectedIdentity.artifactRevision ||
		runtimePreflight.webperlRevision !== expectedIdentity.webperlRevision ||
		runtimePreflight.perlRevision !== expectedIdentity.perlRevision ||
		runtimePreflight.emscriptenRevision !== expectedIdentity.emscriptenRevision ||
		runtimePreflight.manifestFingerprint !== expectedIdentity.manifestFingerprint ||
		!isUint8Array(runtimePreflight.manifestBytes) ||
		!isUint8Array(runtimePreflight.javascriptBytes) ||
		!isUint8Array(runtimePreflight.wasmBytes) ||
		!isUint8Array(runtimePreflight.dataBytes)
	) {
		throw new Error('WebPerl runtime preflight payload is invalid.');
	}
	for (const [label, bytes, limit] of [
		[
			'WebPerl runtime manifest',
			runtimePreflight.manifestBytes,
			Math.min(maxManifestBytes, maxAssetBytes)
		],
		['WebPerl runtime JavaScript', runtimePreflight.javascriptBytes, maxAssetBytes],
		['WebPerl runtime Wasm', runtimePreflight.wasmBytes, maxAssetBytes],
		['WebPerl runtime data', runtimePreflight.dataBytes, maxAssetBytes]
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
		throw new Error('WebPerl runtime logical payload exceeds its aggregate byte limit.');
	}
	return { runtimePreflight, maxAssetBytes };
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

function normalizeLicenses(candidate, maxAssetBytes) {
	if (!Array.isArray(candidate) || candidate.length !== Object.keys(expectedLicenses).length) {
		throw new Error('WebPerl runtime must declare exactly two license receipts.');
	}
	const paths = new Set();
	return candidate.map((entry) => {
		const expected = expectedLicenses[entry?.path];
		if (
			!isObject(entry) ||
			!expected ||
			!hasExactKeys(entry, expectedLicenseReceiptKeys) ||
			paths.has(entry.path) ||
			entry.spdx !== expected.spdx ||
			!Number.isSafeInteger(entry.size) ||
			entry.size <= 0 ||
			entry.size > maxAssetBytes ||
			typeof entry.sha256 !== 'string' ||
			!/^[a-f0-9]{64}$/u.test(entry.sha256)
		) {
			throw new Error('WebPerl runtime license receipt is invalid.');
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
	if (!isObject(value)) throw new Error('WebPerl runtime manifest must be an object.');
	if (!hasExactKeys(value, expectedManifestKeys)) {
		throw new Error('WebPerl runtime manifest schema is invalid.');
	}
	if (value.format !== manifestFormat || value.runtime !== 'webperl') {
		throw new Error('WebPerl runtime manifest format is unsupported.');
	}
	if (
		value.profileId !== runtimePreflight.profileId ||
		value.fingerprint !== runtimePreflight.manifestFingerprint ||
		value.licenseExpression !== expectedLicenseExpression
	) {
		throw new Error('WebPerl runtime manifest identity is invalid.');
	}
	const artifact = normalizeProvenanceObject(value.artifact, expectedArtifact, 'artifact');
	const components = normalizeProvenanceObject(value.components, expectedComponents, 'component');
	if (
		artifact.revision !== runtimePreflight.artifactRevision ||
		components.webperl.revision !== runtimePreflight.webperlRevision ||
		components.perl.revision !== runtimePreflight.perlRevision ||
		components.emscripten.revision !== runtimePreflight.emscriptenRevision
	) {
		throw new Error('WebPerl runtime provenance identity is invalid.');
	}
	const licenses = normalizeLicenses(value.licenses, maxAssetBytes);
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
		Object.keys(expectedAssets).some((path) => !assetByPath.has(path)) ||
		Object.keys(expectedStorage).some((path) => !storageByPath.has(path))
	) {
		throw new Error('WebPerl runtime manifest is missing a required asset.');
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
		)) !== runtimePreflight.manifestFingerprint
	) {
		throw new Error('WebPerl runtime receipt graph failed fingerprint verification.');
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
		throw new Error('WebPerl runtime JavaScript is not valid UTF-8.');
	}
	if (
		!source.includes('Module["getPreloadedPackage"]') ||
		!source.includes('Module["wasmBinary"]') ||
		!source.includes('var Module=typeof Module!=="undefined"?Module:{}')
	) {
		throw new Error(
			'WebPerl runtime JavaScript is missing its verified asset injection contract.'
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
		throw new Error('WebPerl runtime Wasm header is invalid.');
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
		throw new Error('WebPerl runtime manifest is not valid UTF-8 JSON.');
	}
	const manifest = await normalizeManifest(parsed, runtimePreflight, maxAssetBytes);
	for (const [path, bytes] of [
		['emperl.js', runtimePreflight.javascriptBytes],
		['emperl.wasm', runtimePreflight.wasmBytes],
		['emperl.data', runtimePreflight.dataBytes]
	]) {
		await verifyReceiptBytes(
			manifest.assetByPath.get(path),
			bytes,
			`WebPerl runtime asset ${path}`
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
		throw new Error('WebPerl verified runtime evaluation is unavailable.');
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
	assignModule(undefined, 'WebPerl runtime Module global could not be cleared');
}

function restoreModuleGlobal(snapshot) {
	if (snapshot.hadOwn) {
		assignModule(snapshot.value, 'WebPerl runtime Module global could not be restored');
		return;
	}
	try {
		delete globalThis.Module;
	} catch {
		// importScripts top-level var bindings may be non-configurable.
	}
	if (globalThis.Module !== undefined) {
		assignModule(undefined, 'WebPerl runtime Module global could not be reset');
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
	const bytes = encoder.encode(stdin || '');
	let offset = 0;
	return () => (offset >= bytes.byteLength ? null : bytes[offset++]);
}

function normalizeOutput(text) {
	if (!text) return '';
	return text.endsWith('\n') ? text : `${text}\n`;
}

function postOutput(text) {
	if (text) self.postMessage({ output: text });
}

function createHostModule(runtimePreflight, code, args, stdinReader, activePath, settle) {
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
	const dataBuffer = runtimePreflight.dataBytes.slice().buffer;
	const module = {
		noInitialRun: true,
		noExitRuntime: false,
		wasmBinary: runtimePreflight.wasmBytes,
		locateFile(path) {
			if (path !== 'emperl.wasm' && path !== 'emperl.data') {
				throw new Error(`WebPerl requested an undeclared runtime asset: ${path}`);
			}
			return `wasm-idle-verified:${path}`;
		},
		getPreloadedPackage(packageName, packageSize) {
			if (
				packageName !== 'wasm-idle-verified:emperl.data' ||
				packageSize !== runtimePreflight.dataBytes.byteLength
			) {
				throw new Error('WebPerl requested an unexpected preloaded package.');
			}
			return dataBuffer;
		},
		print(text) {
			postOutput(normalizeOutput(String(text)));
		},
		printErr(text) {
			postOutput(normalizeOutput(String(text)));
		},
		stdin: stdinReader,
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
			settle.reject(new Error(String(reason || 'Perl runtime aborted')));
		},
		onRuntimeInitialized() {
			try {
				const fileBaseName = activePath.split('/').pop() || 'main.pl';
				const fileName = `/tmp/${fileBaseName}`;
				try {
					module.FS_createPath('/', 'tmp', true, true);
				} catch {
					// Some WebPerl builds create /tmp during startup.
				}
				module.FS_createDataFile('/tmp', fileBaseName, encoder.encode(code), true, true);
				const status = module.callMain([fileName, ...args]);
				flushStdout();
				flushStderr();
				if (typeof status === 'number' && status !== 0) {
					settle.reject(new Error(`Perl exited with status ${status}.`));
					return;
				}
				settle.resolve();
			} catch (error) {
				flushStdout();
				flushStderr();
				settle.reject(error);
			}
		}
	};
	return module;
}

async function runVerifiedWebPerl(runtimePreflight, code, args, stdinReader, activePath) {
	const previousModule = snapshotModuleGlobal();
	let failure;
	try {
		clearModuleGlobal();
		let settle;
		const completion = new Promise((resolve, reject) => {
			settle = { resolve, reject };
		});
		const module = createHostModule(
			runtimePreflight,
			code,
			args,
			stdinReader,
			activePath,
			settle
		);
		assignModule(module, 'WebPerl host Module could not be installed');
		importVerifiedRuntimeScript(runtimePreflight.javascriptBytes);
		if (globalThis.Module !== module) {
			throw new Error('WebPerl runtime Module changed during verified evaluation.');
		}
		await completion;
	} catch (error) {
		failure = error;
	}
	try {
		restoreModuleGlobal(previousModule);
	} catch (cleanupError) {
		throw new AggregateError(
			failure ? [failure, cleanupError] : [cleanupError],
			failure
				? `${errorMessage(failure)}; WebPerl runtime Module cleanup failed.`
				: 'WebPerl runtime Module cleanup failed.'
		);
	}
	if (failure) throw failure;
}

self.onmessage = async (event) => {
	if (requestConsumed) {
		self.postMessage({ error: 'WebPerl worker accepts exactly one run.' });
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
		activePath = 'main.pl',
		log
	} = event.data || {};
	try {
		if (log) console.log('[wasm-idle:perl-worker] run start');
		if (
			typeof code !== 'string' ||
			typeof activePath !== 'string' ||
			!Array.isArray(args) ||
			args.some((argument) => typeof argument !== 'string') ||
			(stdin !== undefined && typeof stdin !== 'string')
		) {
			throw new Error('WebPerl code, run path, arguments, and buffered stdin are invalid.');
		}
		const stdinReader = createStdinReader(stdin, stdinChannel);
		const verified = await verifyRuntimePreflight(runtimePreflight, maxAssetBytes);
		await runVerifiedWebPerl(verified, code, args, stdinReader, activePath);
		if (log) console.log('[wasm-idle:perl-worker] run settled');
		self.postMessage({ results: true });
	} catch (error) {
		if (log) console.error('[wasm-idle:perl-worker] failed', error);
		self.postMessage({ error: errorMessage(error) });
	} finally {
		self.close();
	}
};
