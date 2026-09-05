const preflightProtocol = 'wasm-idle-bqn-preflight';
const preflightProtocolVersion = 1;
const manifestFormat = 'wasm-bqn-runtime-manifest-v2';
const fingerprintDomain = 'wasm-idle:bqn-runtime-manifest:v2';
const hardMaxAssetBytes = 128 * 1024 * 1024;
const maxManifestBytes = 64 * 1024;
const verifiedWasmStoragePath = 'BQN.wasm.gz.bin';
const buildOptions = ['ENVIRONMENT=worker', 'MODULARIZE=1', 'EXPORT_ES6=1', 'FORCE_FILESYSTEM=1'];
const fatalTextDecoder = new TextDecoder('utf-8', { fatal: true });
const textEncoder = new TextEncoder();

async function sha256Hex(bytes) {
	if (!globalThis.crypto?.subtle?.digest) {
		throw new Error('CBQN runtime integrity verification requires Web Crypto.');
	}
	const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes));
	return [...digest].map((value) => value.toString(16).padStart(2, '0')).join('');
}

async function computeFingerprint(profileId, source, build, license, assets, storage) {
	const sortedAssets = [...assets].sort((left, right) =>
		left.path < right.path ? -1 : left.path > right.path ? 1 : 0
	);
	const sortedStorage = [...storage].sort((left, right) =>
		left.path < right.path ? -1 : left.path > right.path ? 1 : 0
	);
	let canonical = `${fingerprintDomain}\nformat\0${manifestFormat}\nruntime\0dzaima-cbqn\nprofileId\0${profileId}\n`;
	canonical += `source\0${source.repository}\0${source.path}\0${source.revision}\n`;
	canonical += `build\0emscripten\0${build.emscripten}\n`;
	for (const option of build.options) canonical += `build-option\0${option}\n`;
	canonical += `license\0${license.path}\0${license.spdx}\0${license.size}\0${license.sha256}\n`;
	for (const asset of sortedAssets) {
		canonical += `asset\0${asset.path}\0${asset.mediaType}\0${asset.size}\0${asset.sha256}\n`;
	}
	for (const asset of sortedStorage) {
		canonical += `storage\0${asset.path}\0${asset.logicalPath}\0${asset.encoding}\0${asset.size}\0${asset.sha256}\n`;
	}
	return await sha256Hex(textEncoder.encode(canonical));
}

function normalizeReceipt(candidate, expected, maxAssetBytes) {
	if (
		!candidate ||
		typeof candidate !== 'object' ||
		Array.isArray(candidate) ||
		candidate.path !== expected.path ||
		candidate.mediaType !== expected.mediaType ||
		!Number.isSafeInteger(candidate.size) ||
		candidate.size <= 0 ||
		candidate.size > maxAssetBytes ||
		typeof candidate.sha256 !== 'string' ||
		!/^[a-f0-9]{64}$/u.test(candidate.sha256)
	) {
		throw new Error(
			`CBQN runtime asset receipt ${expected.path} is invalid or exceeds its byte limit.`
		);
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
		candidate.path !== expected.path ||
		candidate.logicalPath !== expected.logicalPath ||
		candidate.encoding !== expected.encoding ||
		!Number.isSafeInteger(candidate.size) ||
		candidate.size <= 0 ||
		candidate.size > maxAssetBytes ||
		typeof candidate.sha256 !== 'string' ||
		!/^[a-f0-9]{64}$/u.test(candidate.sha256)
	) {
		throw new Error(
			`CBQN runtime storage receipt ${expected.path} is invalid or exceeds its byte limit.`
		);
	}
	return {
		path: expected.path,
		logicalPath: expected.logicalPath,
		encoding: expected.encoding,
		size: candidate.size,
		sha256: candidate.sha256
	};
}

function normalizeLicense(candidate, maxAssetBytes) {
	if (
		!candidate ||
		typeof candidate !== 'object' ||
		Array.isArray(candidate) ||
		candidate.path !== 'LICENSE-GPLv3.txt' ||
		candidate.spdx !== 'GPL-3.0-or-later' ||
		!Number.isSafeInteger(candidate.size) ||
		candidate.size <= 0 ||
		candidate.size > maxAssetBytes ||
		typeof candidate.sha256 !== 'string' ||
		!/^[a-f0-9]{64}$/u.test(candidate.sha256)
	) {
		throw new Error('CBQN runtime license receipt is invalid or exceeds its byte limit.');
	}
	return {
		path: candidate.path,
		spdx: candidate.spdx,
		size: candidate.size,
		sha256: candidate.sha256
	};
}

async function normalizeManifest(
	value,
	expectedFingerprint,
	expectedProfileId,
	expectedSourceRevision,
	maxAssetBytes
) {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error('CBQN runtime manifest must be an object.');
	}
	if (value.format !== manifestFormat || value.runtime !== 'dzaima-cbqn') {
		throw new Error('CBQN runtime manifest format is unsupported.');
	}
	if (
		typeof value.profileId !== 'string' ||
		!/^dzaima-cbqn-[A-Za-z0-9._-]+$/u.test(value.profileId) ||
		value.profileId !== expectedProfileId ||
		!value.source ||
		typeof value.source !== 'object' ||
		Array.isArray(value.source) ||
		value.source.repository !== 'https://github.com/dzaima/CBQN' ||
		value.source.path !== 'dist' ||
		typeof value.source.revision !== 'string' ||
		!/^[A-Za-z0-9:;._-]+$/u.test(value.source.revision) ||
		value.source.revision !== expectedSourceRevision ||
		!value.build ||
		typeof value.build !== 'object' ||
		Array.isArray(value.build) ||
		value.build.emscripten !== '3.1.8' ||
		!Array.isArray(value.build.options) ||
		JSON.stringify(value.build.options) !== JSON.stringify(buildOptions)
	) {
		throw new Error(
			'CBQN runtime manifest profile, source, or build metadata is invalid or mismatched.'
		);
	}
	if (typeof expectedFingerprint !== 'string' || !/^[a-f0-9]{64}$/u.test(expectedFingerprint)) {
		throw new Error('CBQN runtime expected fingerprint is invalid.');
	}
	if (value.fingerprint !== expectedFingerprint) {
		throw new Error('CBQN runtime manifest fingerprint does not match the pinned runtime.');
	}
	if (!Array.isArray(value.assets) || value.assets.length !== 2) {
		throw new Error('CBQN runtime manifest must declare exactly two logical assets.');
	}
	if (!Array.isArray(value.storage) || value.storage.length !== 2) {
		throw new Error('CBQN runtime manifest must declare exactly two storage assets.');
	}
	const license = normalizeLicense(value.license, maxAssetBytes);
	const assets = [
		normalizeReceipt(
			value.assets.find((asset) => asset?.path === 'BQN.js'),
			{ path: 'BQN.js', mediaType: 'text/javascript' },
			maxAssetBytes
		),
		normalizeReceipt(
			value.assets.find((asset) => asset?.path === 'BQN.wasm'),
			{ path: 'BQN.wasm', mediaType: 'application/wasm' },
			maxAssetBytes
		)
	];
	const storage = [
		normalizeStorageReceipt(
			value.storage.find((asset) => asset?.path === 'BQN.js'),
			{ path: 'BQN.js', logicalPath: 'BQN.js', encoding: 'identity' },
			maxAssetBytes
		),
		normalizeStorageReceipt(
			value.storage.find((asset) => asset?.path === verifiedWasmStoragePath),
			{
				path: verifiedWasmStoragePath,
				logicalPath: 'BQN.wasm',
				encoding: 'gzip'
			},
			maxAssetBytes
		)
	];
	const source = {
		repository: value.source.repository,
		path: value.source.path,
		revision: value.source.revision
	};
	const build = { emscripten: value.build.emscripten, options: [...value.build.options] };
	if (
		(await computeFingerprint(value.profileId, source, build, license, assets, storage)) !==
		expectedFingerprint
	) {
		throw new Error('CBQN runtime receipt graph failed fingerprint verification.');
	}
	return { assets };
}

async function verifyReceiptBytes(receipt, bytes) {
	if (bytes.byteLength !== receipt.size) {
		throw new Error(`CBQN runtime asset ${receipt.path} has an unexpected byte size.`);
	}
	if ((await sha256Hex(bytes)) !== receipt.sha256) {
		throw new Error(`CBQN runtime asset ${receipt.path} failed SHA-256 verification.`);
	}
}

async function importVerifiedRuntime(bytes) {
	try {
		fatalTextDecoder.decode(bytes);
	} catch {
		throw new Error('CBQN runtime JavaScript is not valid UTF-8.');
	}
	if (
		typeof Blob !== 'function' ||
		typeof URL.createObjectURL !== 'function' ||
		typeof URL.revokeObjectURL !== 'function'
	) {
		throw new Error('CBQN verified runtime module evaluation is unavailable.');
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
		throw new Error('Invalid CBQN streaming stdin channel.');
	}

	const control = new Int32Array(channel.buffer, 0, 4);
	const bytes = new Uint8Array(channel.buffer, channel.controlBytes, channel.capacity);
	return () => {
		while (true) {
			if (Atomics.load(control, 3) === 1) {
				throw new Error('CBQN streaming stdin was cancelled.');
			}
			const write = Atomics.load(control, 0);
			const read = Atomics.load(control, 1);
			const available = write - read;
			if (available < 0 || available > bytes.byteLength) {
				throw new Error('CBQN streaming stdin counters are invalid.');
			}
			if (available > 0) {
				const value = bytes[read % bytes.byteLength];
				Atomics.store(control, 1, read + 1);
				return value;
			}
			if (Atomics.load(control, 2) === 1) return null;
			self.postMessage({ type: 'stdin-request' });
			// EOF/cancel change separate flags, not the write index. A notification
			// between the checks above and wait is lost, so periodically recheck them.
			Atomics.wait(control, 0, write, 100);
		}
	};
}

function createInputReader(stdin, channel) {
	const sharedReader = createSharedInputReader(channel);
	if (sharedReader) return sharedReader;
	const bytes = Array.from(new TextEncoder().encode(typeof stdin === 'string' ? stdin : ''));
	let index = 0;
	return () => {
		if (index >= bytes.length) return null;
		const value = bytes[index];
		index += 1;
		return value;
	};
}

function createBqnRunner(module) {
	const runLine = module.cwrap('cbqn_runLine', null, ['array', 'int']);
	const encoder = new TextEncoder();
	return (source) => {
		const bytes = encoder.encode(`${source}\0`);
		runLine(bytes, bytes.length - 1);
	};
}

async function createBqnRuntime(
	runtimePreflight,
	expectedFingerprint,
	requestedMaxAssetBytes,
	stdin,
	stdinChannel,
	onStdout,
	stderr
) {
	const inputReader = createInputReader(stdin, stdinChannel);
	if (!Number.isSafeInteger(requestedMaxAssetBytes) || requestedMaxAssetBytes <= 0) {
		throw new Error('CBQN runtime asset byte limit is invalid.');
	}
	const maxAssetBytes = Math.min(requestedMaxAssetBytes, hardMaxAssetBytes);
	const expectedKeys = [
		'manifestBytes',
		'manifestFingerprint',
		'moduleBytes',
		'profileId',
		'protocol',
		'protocolVersion',
		'sourceRevision',
		'wasmBytes'
	];
	const actualKeys =
		runtimePreflight && typeof runtimePreflight === 'object' && !Array.isArray(runtimePreflight)
			? Object.keys(runtimePreflight).sort()
			: [];
	if (
		!runtimePreflight ||
		typeof runtimePreflight !== 'object' ||
		Array.isArray(runtimePreflight) ||
		actualKeys.length !== expectedKeys.length ||
		actualKeys.some((key, index) => key !== expectedKeys[index]) ||
		runtimePreflight.protocol !== preflightProtocol ||
		runtimePreflight.protocolVersion !== preflightProtocolVersion ||
		typeof runtimePreflight.profileId !== 'string' ||
		!/^dzaima-cbqn-[A-Za-z0-9._-]+$/u.test(runtimePreflight.profileId) ||
		typeof runtimePreflight.sourceRevision !== 'string' ||
		!/^[A-Za-z0-9:;._-]+$/u.test(runtimePreflight.sourceRevision) ||
		runtimePreflight.manifestFingerprint !== expectedFingerprint ||
		Object.prototype.toString.call(runtimePreflight.manifestBytes) !== '[object Uint8Array]' ||
		Object.prototype.toString.call(runtimePreflight.moduleBytes) !== '[object Uint8Array]' ||
		Object.prototype.toString.call(runtimePreflight.wasmBytes) !== '[object Uint8Array]'
	) {
		throw new Error('CBQN runtime requires a valid host-preflighted asset payload.');
	}
	if (
		runtimePreflight.manifestBytes.byteLength <= 0 ||
		runtimePreflight.manifestBytes.byteLength > Math.min(maxManifestBytes, maxAssetBytes) ||
		runtimePreflight.moduleBytes.byteLength <= 0 ||
		runtimePreflight.moduleBytes.byteLength > maxAssetBytes ||
		runtimePreflight.wasmBytes.byteLength <= 0 ||
		runtimePreflight.wasmBytes.byteLength > maxAssetBytes
	) {
		throw new Error('CBQN host-preflighted assets exceed their active byte limits.');
	}

	let parsed;
	try {
		parsed = JSON.parse(fatalTextDecoder.decode(runtimePreflight.manifestBytes));
	} catch {
		throw new Error('CBQN runtime manifest is not valid UTF-8 JSON.');
	}
	const manifest = await normalizeManifest(
		parsed,
		runtimePreflight.manifestFingerprint,
		runtimePreflight.profileId,
		runtimePreflight.sourceRevision,
		maxAssetBytes
	);
	await verifyReceiptBytes(manifest.assets[0], runtimePreflight.moduleBytes);
	await verifyReceiptBytes(manifest.assets[1], runtimePreflight.wasmBytes);

	const runtimeModule = await importVerifiedRuntime(runtimePreflight.moduleBytes);
	const createModule = runtimeModule.default || runtimeModule;
	if (typeof createModule !== 'function') {
		throw new Error('CBQN runtime module did not export an Emscripten module factory.');
	}
	const module = await createModule({
		locateFile(path) {
			if (path !== 'BQN.wasm') {
				throw new Error(`CBQN runtime requested an unexpected local asset: ${path}`);
			}
			return 'wasm-idle-preflight://bqn/BQN.wasm';
		},
		print: (message) => onStdout(String(message)),
		printErr: (message) => stderr.push(String(message)),
		stdin: inputReader,
		wasmBinary: runtimePreflight.wasmBytes
	});
	return createBqnRunner(module);
}

function postOutput(lines) {
	const output = lines.filter(Boolean).join('\n');
	if (output) self.postMessage({ output: output.endsWith('\n') ? output : `${output}\n` });
}

self.onmessage = async (event) => {
	const { runtimePreflight, manifestFingerprint, maxAssetBytes, code, stdin, stdinChannel, log } =
		event.data || {};
	const stderr = [];
	try {
		if (log) console.log('[wasm-idle:bqn-worker] run start with host-preflighted assets');
		const source = String(code || '');
		const runBqn = await createBqnRuntime(
			runtimePreflight,
			manifestFingerprint,
			maxAssetBytes,
			stdin,
			stdinChannel,
			(message) => postOutput([message]),
			stderr
		);
		if (source.trim()) runBqn(source);
		if (stderr.length > 0) throw new Error(stderr.join('\n'));
		if (log) console.log('[wasm-idle:bqn-worker] run settled');
		self.postMessage({ results: true });
	} catch (error) {
		const message = stderr.length > 0 ? stderr.join('\n') : error?.message || String(error);
		if (log) console.error('[wasm-idle:bqn-worker] failed', error);
		self.postMessage({ error: message });
	}
};
