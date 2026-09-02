const preflightProtocol = 'wasm-idle-j-preflight';
const preflightProtocolVersion = 1;
const manifestFormat = 'wasm-j-runtime-manifest-v2';
const fingerprintDomain = 'wasm-idle:j-runtime-manifest:v2';
const hardMaxAssetBytes = 128 * 1024 * 1024;
const maxManifestBytes = 64 * 1024;
const verifiedWasmStoragePath = 'jamalgam.wasm.gz.bin';
const fatalTextDecoder = new TextDecoder('utf-8', { fatal: true });
const textEncoder = new TextEncoder();

async function sha256Hex(bytes) {
	if (!globalThis.crypto?.subtle?.digest) {
		throw new Error('J runtime integrity verification requires Web Crypto.');
	}
	const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes));
	return [...digest].map((value) => value.toString(16).padStart(2, '0')).join('');
}

async function computeFingerprint(profileId, source, assets, storage) {
	const sortedAssets = [...assets].sort((left, right) =>
		left.path < right.path ? -1 : left.path > right.path ? 1 : 0
	);
	const sortedStorage = [...storage].sort((left, right) =>
		left.path < right.path ? -1 : left.path > right.path ? 1 : 0
	);
	let canonical = `${fingerprintDomain}\nformat\0${manifestFormat}\nruntime\0jsoftware-j-playground\nprofileId\0${profileId}\n`;
	canonical += `source\0${source.repository}\0${source.path}\0${source.revision}\n`;
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
			`J runtime asset receipt ${expected.path} is invalid or exceeds its byte limit.`
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
			`J runtime storage receipt ${expected.path} is invalid or exceeds its byte limit.`
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

async function normalizeManifest(
	value,
	expectedFingerprint,
	expectedProfileId,
	expectedSourceRevision,
	maxAssetBytes
) {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error('J runtime manifest must be an object.');
	}
	if (value.format !== manifestFormat || value.runtime !== 'jsoftware-j-playground') {
		throw new Error('J runtime manifest format is unsupported.');
	}
	if (
		typeof value.profileId !== 'string' ||
		!/^jsoftware-j-playground-[A-Za-z0-9._-]+$/u.test(value.profileId) ||
		value.profileId !== expectedProfileId ||
		!value.source ||
		typeof value.source !== 'object' ||
		Array.isArray(value.source) ||
		value.source.repository !== 'https://github.com/jsoftware/j-playground' ||
		value.source.path !== 'bin/html2' ||
		typeof value.source.revision !== 'string' ||
		!/^[A-Za-z0-9:;._-]+$/u.test(value.source.revision) ||
		value.source.revision !== expectedSourceRevision
	) {
		throw new Error('J runtime manifest profile or source metadata is invalid or mismatched.');
	}
	if (typeof expectedFingerprint !== 'string' || !/^[a-f0-9]{64}$/u.test(expectedFingerprint)) {
		throw new Error('J runtime expected fingerprint is invalid.');
	}
	if (value.fingerprint !== expectedFingerprint) {
		throw new Error('J runtime manifest fingerprint does not match the pinned runtime.');
	}
	if (!Array.isArray(value.assets) || value.assets.length !== 2) {
		throw new Error('J runtime manifest must declare exactly two logical assets.');
	}
	if (!Array.isArray(value.storage) || value.storage.length !== 2) {
		throw new Error('J runtime manifest must declare exactly two storage assets.');
	}
	const assets = [
		normalizeReceipt(
			value.assets.find((asset) => asset?.path === 'jamalgam.js'),
			{ path: 'jamalgam.js', mediaType: 'text/javascript' },
			maxAssetBytes
		),
		normalizeReceipt(
			value.assets.find((asset) => asset?.path === 'jamalgam.wasm'),
			{ path: 'jamalgam.wasm', mediaType: 'application/wasm' },
			maxAssetBytes
		)
	];
	const storage = [
		normalizeStorageReceipt(
			value.storage.find((asset) => asset?.path === 'jamalgam.js'),
			{ path: 'jamalgam.js', logicalPath: 'jamalgam.js', encoding: 'identity' },
			maxAssetBytes
		),
		normalizeStorageReceipt(
			value.storage.find((asset) => asset?.path === verifiedWasmStoragePath),
			{
				path: verifiedWasmStoragePath,
				logicalPath: 'jamalgam.wasm',
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
	if (
		(await computeFingerprint(value.profileId, source, assets, storage)) !== expectedFingerprint
	) {
		throw new Error('J runtime receipt graph failed fingerprint verification.');
	}
	return { assets };
}

async function verifyReceiptBytes(receipt, bytes) {
	if (bytes.byteLength !== receipt.size) {
		throw new Error(`J runtime asset ${receipt.path} has an unexpected byte size.`);
	}
	if ((await sha256Hex(bytes)) !== receipt.sha256) {
		throw new Error(`J runtime asset ${receipt.path} failed SHA-256 verification.`);
	}
}

async function importVerifiedRuntime(bytes) {
	try {
		fatalTextDecoder.decode(bytes);
	} catch {
		throw new Error('J runtime JavaScript is not valid UTF-8.');
	}
	if (
		typeof Blob !== 'function' ||
		typeof URL.createObjectURL !== 'function' ||
		typeof URL.revokeObjectURL !== 'function'
	) {
		throw new Error('J verified runtime module evaluation is unavailable.');
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
		throw new Error('Invalid J streaming stdin channel.');
	}

	const control = new Int32Array(channel.buffer, 0, 4);
	const bytes = new Uint8Array(channel.buffer, channel.controlBytes, channel.capacity);
	return () => {
		while (true) {
			if (Atomics.load(control, 3) === 1) {
				throw new Error('J streaming stdin was cancelled.');
			}
			const write = Atomics.load(control, 0);
			const read = Atomics.load(control, 1);
			const available = write - read;
			if (available < 0 || available > bytes.byteLength) {
				throw new Error('J streaming stdin counters are invalid.');
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
	const bytes = Array.from(new TextEncoder().encode(typeof stdin === 'string' ? stdin : ''));
	let index = 0;
	return () => {
		if (index >= bytes.length) return null;
		const value = bytes[index];
		index += 1;
		return value;
	};
}

async function createJRuntime(
	runtimePreflight,
	expectedFingerprint,
	requestedMaxAssetBytes,
	stdin,
	stdinChannel
) {
	const inputReader = createInputReader(stdin, stdinChannel);
	if (!Number.isSafeInteger(requestedMaxAssetBytes) || requestedMaxAssetBytes <= 0) {
		throw new Error('J runtime asset byte limit is invalid.');
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
		!/^jsoftware-j-playground-[A-Za-z0-9._-]+$/u.test(runtimePreflight.profileId) ||
		typeof runtimePreflight.sourceRevision !== 'string' ||
		!/^[A-Za-z0-9:;._-]+$/u.test(runtimePreflight.sourceRevision) ||
		runtimePreflight.manifestFingerprint !== expectedFingerprint ||
		Object.prototype.toString.call(runtimePreflight.manifestBytes) !== '[object Uint8Array]' ||
		Object.prototype.toString.call(runtimePreflight.moduleBytes) !== '[object Uint8Array]' ||
		Object.prototype.toString.call(runtimePreflight.wasmBytes) !== '[object Uint8Array]'
	) {
		throw new Error('J runtime requires a valid host-preflighted asset payload.');
	}
	if (
		runtimePreflight.manifestBytes.byteLength <= 0 ||
		runtimePreflight.manifestBytes.byteLength > Math.min(maxManifestBytes, maxAssetBytes) ||
		runtimePreflight.moduleBytes.byteLength <= 0 ||
		runtimePreflight.moduleBytes.byteLength > maxAssetBytes ||
		runtimePreflight.wasmBytes.byteLength <= 0 ||
		runtimePreflight.wasmBytes.byteLength > maxAssetBytes
	) {
		throw new Error('J host-preflighted assets exceed their active byte limits.');
	}

	let parsed;
	try {
		parsed = JSON.parse(fatalTextDecoder.decode(runtimePreflight.manifestBytes));
	} catch {
		throw new Error('J runtime manifest is not valid UTF-8 JSON.');
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
		throw new Error('J runtime module did not export an Emscripten module factory.');
	}
	const module = await createModule({
		locateFile(path) {
			if (path !== 'jamalgam.wasm') {
				throw new Error(`J runtime requested an unexpected local asset: ${path}`);
			}
			return 'wasm-idle-preflight://j/jamalgam.wasm';
		},
		print() {},
		printErr() {},
		stdin: inputReader,
		wasmBinary: runtimePreflight.wasmBytes
	});
	const jinit = module.cwrap('em_jinit', 'number', []);
	const rc = jinit();
	if (rc !== 0) throw new Error(`J runtime initialization failed with code ${rc}.`);
	const jdo = module.cwrap('em_jdo', 'string', ['string']);
	const jsetstr = module.cwrap('em_jsetstr', 'void', ['string', 'string']);
	jdo("(0!:0) <'/jlibrary/system/main/stdlib.ijs'");
	return { jdo, jsetstr };
}

function postOutput(text) {
	if (text) self.postMessage({ output: text.endsWith('\n') ? text : `${text}\n` });
}

function isJError(output) {
	return /^\|/mu.test(output || '');
}

function normalizeChunk(output) {
	return String(output || '')
		.replace(/Module initialized!\n?/gu, '')
		.replace(/^warning: unsupported syscall: \d+\n?/gmu, '');
}

function runJLineByLine(jdo, code, onOutput) {
	for (const line of String(code || '')
		.replace(/\r\n?/gu, '\n')
		.split('\n')) {
		if (!line.trim()) continue;
		const chunk = normalizeChunk(jdo(line));
		if (isJError(chunk)) throw new Error(chunk);
		if (chunk) onOutput(chunk);
	}
}

function runJScript(jdo, jsetstr, code) {
	const source = String(code || '');
	if (!source.trim()) return '';
	jsetstr('CODE_jrx_', source);
	const output = normalizeChunk(jdo('(0!:101) CODE_jrx_'));
	if (isJError(output)) throw new Error(output);
	return output;
}

function readsStdin(code) {
	return /1!:\s*1|\/dev\/stdin|\bstdin\b/iu.test(code);
}

self.onmessage = async (event) => {
	const { runtimePreflight, manifestFingerprint, maxAssetBytes, code, stdin, stdinChannel, log } =
		event.data || {};
	try {
		if (log) console.log('[wasm-idle:j-worker] run start with host-preflighted assets');
		const { jdo, jsetstr } = await createJRuntime(
			runtimePreflight,
			manifestFingerprint,
			maxAssetBytes,
			stdin,
			stdinChannel
		);
		if (readsStdin(String(code || ''))) runJLineByLine(jdo, code, postOutput);
		else postOutput(runJScript(jdo, jsetstr, code));
		if (log) console.log('[wasm-idle:j-worker] run settled');
		self.postMessage({ results: true });
	} catch (error) {
		if (log) console.error('[wasm-idle:j-worker] failed', error);
		self.postMessage({ error: error?.message || String(error) });
	}
};
