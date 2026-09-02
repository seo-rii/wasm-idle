const textEncoder = new TextEncoder();
const fatalTextDecoder = new TextDecoder('utf-8', { fatal: true });
const preflightProtocol = 'wasm-idle-clojurescript-preflight';
const preflightProtocolVersion = 1;
const manifestFormat = 'wasm-clojurescript-runtime-manifest-v2';
const fingerprintDomain = 'wasm-idle:clojurescript-runtime-manifest:v2';
const hardMaxAssetBytes = 16 * 1024 * 1024;
const maxManifestBytes = 64 * 1024;
const verifiedCompilerStoragePath = 'compiler.js.gz.bin';
const expectedBuild = Object.freeze({
	clojureScriptVersion: '1.12.134',
	clojureToolsArchiveSha256: '13769da6d63a98deb2024378ae1a64e4ee211ac1035340dfca7a6944c41cde21',
	clojureToolsVersion: '1.12.4.1618',
	jdkArchiveSha256: '4b2220e232a97997b436ca6ab15cbf70171ecff52958a46159dfa5a8c44ca4de',
	jdkVersion: '21.0.11+10',
	optimizations: 'simple',
	target: 'webworker'
});

async function sha256Hex(bytes) {
	if (!globalThis.crypto?.subtle?.digest) {
		throw new Error('ClojureScript runtime integrity verification requires Web Crypto.');
	}
	const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes));
	return [...digest].map((value) => value.toString(16).padStart(2, '0')).join('');
}

async function computeFingerprint(profileId, source, build, license, metadata, assets, storage) {
	let canonical = `${fingerprintDomain}\nformat\0${manifestFormat}\nruntime\0cljs.js\nprofileId\0${profileId}\n`;
	canonical += `source\0${source.repository}\0${source.revision}\0${source.integrationRepository}\0${source.integrationRevision}\n`;
	for (const [name, value] of Object.entries(build).sort(([left], [right]) =>
		left < right ? -1 : left > right ? 1 : 0
	)) {
		canonical += `build\0${name}\0${value}\n`;
	}
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
	return await sha256Hex(textEncoder.encode(canonical));
}

function normalizeReceipt(candidate, expected, maxAssetBytes, label) {
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
		throw new Error(`${label} receipt is invalid or exceeds its byte limit.`);
	}
	return {
		path: expected.path,
		mediaType: expected.mediaType,
		size: candidate.size,
		sha256: candidate.sha256
	};
}

function normalizeStorageReceipt(candidate, maxAssetBytes) {
	if (
		!candidate ||
		typeof candidate !== 'object' ||
		Array.isArray(candidate) ||
		candidate.path !== verifiedCompilerStoragePath ||
		candidate.logicalPath !== 'compiler.js' ||
		candidate.encoding !== 'gzip' ||
		!Number.isSafeInteger(candidate.size) ||
		candidate.size <= 0 ||
		candidate.size > maxAssetBytes ||
		typeof candidate.sha256 !== 'string' ||
		!/^[a-f0-9]{64}$/u.test(candidate.sha256)
	) {
		throw new Error(
			'ClojureScript runtime storage receipt is invalid or exceeds its byte limit.'
		);
	}
	return {
		path: verifiedCompilerStoragePath,
		logicalPath: 'compiler.js',
		encoding: 'gzip',
		size: candidate.size,
		sha256: candidate.sha256
	};
}

function normalizeLicense(candidate, maxAssetBytes) {
	if (
		!candidate ||
		typeof candidate !== 'object' ||
		Array.isArray(candidate) ||
		candidate.path !== 'LICENSE.txt' ||
		candidate.spdx !== 'EPL-1.0' ||
		!Number.isSafeInteger(candidate.size) ||
		candidate.size <= 0 ||
		candidate.size > maxAssetBytes ||
		typeof candidate.sha256 !== 'string' ||
		!/^[a-f0-9]{64}$/u.test(candidate.sha256)
	) {
		throw new Error('ClojureScript runtime license receipt is invalid.');
	}
	return {
		path: 'LICENSE.txt',
		spdx: 'EPL-1.0',
		size: candidate.size,
		sha256: candidate.sha256
	};
}

async function normalizeManifest(
	value,
	expectedFingerprint,
	expectedProfileId,
	expectedSourceRevision,
	expectedIntegrationRevision,
	maxAssetBytes
) {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error('ClojureScript runtime manifest must be an object.');
	}
	if (value.format !== manifestFormat || value.runtime !== 'cljs.js') {
		throw new Error('ClojureScript runtime manifest format is unsupported.');
	}
	if (
		typeof value.profileId !== 'string' ||
		!/^clojurescript-[A-Za-z0-9._+-]+$/u.test(value.profileId) ||
		value.profileId !== expectedProfileId ||
		!value.source ||
		typeof value.source !== 'object' ||
		Array.isArray(value.source) ||
		value.source.repository !== 'https://github.com/clojure/clojurescript' ||
		value.source.revision !== expectedSourceRevision ||
		value.source.integrationRepository !== 'https://github.com/seo-rii/wasm-idle' ||
		typeof value.source.integrationRevision !== 'string' ||
		!/^[a-f0-9]{40}$/u.test(value.source.integrationRevision) ||
		value.source.integrationRevision !== expectedIntegrationRevision ||
		!value.build ||
		typeof value.build !== 'object' ||
		Array.isArray(value.build) ||
		JSON.stringify(Object.keys(value.build).sort()) !==
			JSON.stringify(Object.keys(expectedBuild).sort()) ||
		Object.entries(expectedBuild).some(([name, expected]) => value.build[name] !== expected)
	) {
		throw new Error(
			'ClojureScript runtime manifest profile, source, or build metadata is invalid or mismatched.'
		);
	}
	if (typeof expectedFingerprint !== 'string' || !/^[a-f0-9]{64}$/u.test(expectedFingerprint)) {
		throw new Error('ClojureScript runtime expected fingerprint is invalid.');
	}
	if (value.fingerprint !== expectedFingerprint) {
		throw new Error(
			'ClojureScript runtime manifest fingerprint does not match the pinned runtime.'
		);
	}
	if (!Array.isArray(value.assets) || value.assets.length !== 1) {
		throw new Error('ClojureScript runtime manifest must declare exactly one logical asset.');
	}
	if (!Array.isArray(value.storage) || value.storage.length !== 1) {
		throw new Error('ClojureScript runtime manifest must declare exactly one storage asset.');
	}
	const source = {
		repository: value.source.repository,
		revision: value.source.revision,
		integrationRepository: value.source.integrationRepository,
		integrationRevision: value.source.integrationRevision
	};
	const build = { ...value.build };
	const license = normalizeLicense(value.license, maxAssetBytes);
	const metadata = normalizeReceipt(
		value.metadata,
		{ path: 'runtime-build.json', mediaType: 'application/json' },
		maxAssetBytes,
		'ClojureScript runtime metadata'
	);
	const assets = [
		normalizeReceipt(
			value.assets[0],
			{ path: 'compiler.js', mediaType: 'text/javascript' },
			maxAssetBytes,
			'ClojureScript runtime asset compiler.js'
		)
	];
	const storage = [normalizeStorageReceipt(value.storage[0], maxAssetBytes)];
	if (
		(await computeFingerprint(
			value.profileId,
			source,
			build,
			license,
			metadata,
			assets,
			storage
		)) !== expectedFingerprint
	) {
		throw new Error('ClojureScript runtime receipt graph failed fingerprint verification.');
	}
	return { asset: assets[0], storage: storage[0] };
}

async function verifyReceiptBytes(receipt, bytes, label) {
	if (bytes.byteLength !== receipt.size) {
		throw new Error(`${label} has an unexpected byte size.`);
	}
	if ((await sha256Hex(bytes)) !== receipt.sha256) {
		throw new Error(`${label} failed SHA-256 verification.`);
	}
}

function importVerifiedRuntimeScript(bytes) {
	try {
		fatalTextDecoder.decode(bytes);
	} catch {
		throw new Error('ClojureScript compiler JavaScript is not valid UTF-8.');
	}
	if (
		typeof Blob !== 'function' ||
		typeof URL.createObjectURL !== 'function' ||
		typeof URL.revokeObjectURL !== 'function' ||
		typeof importScripts !== 'function'
	) {
		throw new Error('ClojureScript verified compiler evaluation is unavailable.');
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

function postOutput(text) {
	if (text) self.postMessage({ output: text });
}

async function loadCompiler(runtimePreflight, manifestFingerprint, requestedMaxAssetBytes) {
	if (!Number.isSafeInteger(requestedMaxAssetBytes) || requestedMaxAssetBytes <= 0) {
		throw new Error('ClojureScript runtime asset byte limit is invalid.');
	}
	const maxAssetBytes = Math.min(requestedMaxAssetBytes, hardMaxAssetBytes);
	const expectedKeys = [
		'compilerBytes',
		'integrationRevision',
		'manifestBytes',
		'manifestFingerprint',
		'profileId',
		'protocol',
		'protocolVersion',
		'sourceRevision'
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
		!/^clojurescript-[A-Za-z0-9._+-]+$/u.test(runtimePreflight.profileId) ||
		typeof runtimePreflight.sourceRevision !== 'string' ||
		runtimePreflight.sourceRevision !== 'r1.12.134' ||
		typeof runtimePreflight.integrationRevision !== 'string' ||
		!/^[a-f0-9]{40}$/u.test(runtimePreflight.integrationRevision) ||
		runtimePreflight.manifestFingerprint !== manifestFingerprint ||
		Object.prototype.toString.call(runtimePreflight.manifestBytes) !== '[object Uint8Array]' ||
		Object.prototype.toString.call(runtimePreflight.compilerBytes) !== '[object Uint8Array]'
	) {
		throw new Error('ClojureScript runtime requires a valid host-preflighted asset payload.');
	}
	if (
		runtimePreflight.manifestBytes.byteLength <= 0 ||
		runtimePreflight.manifestBytes.byteLength > Math.min(maxManifestBytes, maxAssetBytes) ||
		runtimePreflight.compilerBytes.byteLength <= 0 ||
		runtimePreflight.compilerBytes.byteLength > maxAssetBytes
	) {
		throw new Error('ClojureScript host-preflighted assets exceed their active byte limits.');
	}

	let parsed;
	try {
		parsed = JSON.parse(fatalTextDecoder.decode(runtimePreflight.manifestBytes));
	} catch {
		throw new Error('ClojureScript runtime manifest is not valid UTF-8 JSON.');
	}
	const manifest = await normalizeManifest(
		parsed,
		runtimePreflight.manifestFingerprint,
		runtimePreflight.profileId,
		runtimePreflight.sourceRevision,
		runtimePreflight.integrationRevision,
		maxAssetBytes
	);
	await verifyReceiptBytes(
		manifest.asset,
		runtimePreflight.compilerBytes,
		'ClojureScript runtime asset compiler.js'
	);
	importVerifiedRuntimeScript(runtimePreflight.compilerBytes);
	const execute = globalThis.wasm_idle?.runner?.execute;
	if (typeof execute !== 'function') {
		throw new Error('ClojureScript compiler runtime did not initialize.');
	}
	return execute;
}

function normalizePath(value) {
	return String(value || '')
		.replace(/\\/g, '/')
		.replace(/^\.\//, '')
		.replace(/^\/+/, '');
}

function buildWorkspaceFiles(code, activePath, workspaceFiles) {
	const files = Object.create(null);
	for (const file of workspaceFiles || []) {
		if (!file || typeof file.content !== 'string') continue;
		const path = normalizePath(file.path);
		if (path) files[path] = file.content;
	}
	const sourcePath = normalizePath(activePath) || 'main.cljs';
	files[sourcePath] = String(code || '');
	return files;
}

function splitStdinLines(stdin) {
	const source = typeof stdin === 'string' ? stdin : '';
	if (!source) return [];
	const lines = source.split(/\r\n|\n|\r/);
	if (lines.at(-1) === '') lines.pop();
	return lines;
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
		throw new Error('Invalid ClojureScript streaming stdin channel.');
	}

	const control = new Int32Array(channel.buffer, 0, 4);
	const bytes = new Uint8Array(channel.buffer, channel.controlBytes, channel.capacity);
	return () => {
		while (true) {
			if (Atomics.load(control, 3) === 1) {
				throw new Error('ClojureScript streaming stdin was cancelled.');
			}
			const write = Atomics.load(control, 0);
			const read = Atomics.load(control, 1);
			const available = write - read;
			if (available < 0 || available > bytes.byteLength) {
				throw new Error('ClojureScript streaming stdin counters are invalid.');
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

function createSharedStdin(channel) {
	const readByte = createSharedByteReader(channel);
	if (!readByte) return null;
	const decoder = new TextDecoder();
	let skipLineFeed = false;
	return {
		readLine() {
			const bytes = [];
			while (true) {
				const value = readByte();
				if (value === null) {
					return bytes.length ? decoder.decode(Uint8Array.from(bytes)) : undefined;
				}
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
		},
		readRemaining() {
			const bytes = [];
			while (true) {
				const value = readByte();
				if (value === null) return decoder.decode(Uint8Array.from(bytes));
				if (skipLineFeed) {
					skipLineFeed = false;
					if (value === 10) continue;
				}
				bytes.push(value);
			}
		}
	};
}

function createStdinContext(stdin, channel) {
	const shared = createSharedStdin(channel);
	if (!shared) {
		const text = typeof stdin === 'string' ? stdin : '';
		return { stdin: text, stdinLines: splitStdinLines(text) };
	}
	const context = { stdinLines: { shift: () => shared.readLine() } };
	Object.defineProperty(context, 'stdin', {
		enumerable: true,
		get: () => shared.readRemaining()
	});
	return context;
}

function postBufferedRemainder(buffered, streamed) {
	const text = typeof buffered === 'string' ? buffered : '';
	if (!text) return;
	postOutput(streamed && text.startsWith(streamed) ? text.slice(streamed.length) : text);
}

function executeSource(execute, source, filename, context) {
	return new Promise((resolve) => execute(source, filename, context, resolve));
}

self.onmessage = async (event) => {
	const {
		runtimePreflight,
		manifestFingerprint,
		maxAssetBytes,
		code,
		args = [],
		stdin = '',
		stdinChannel,
		activePath = 'main.cljs',
		workspaceFiles = [],
		log
	} = event.data || {};
	try {
		const context = createStdinContext(stdin, stdinChannel);
		let streamedStdout = '';
		let streamedStderr = '';
		context.onStdout = (text) => {
			const chunk = String(text || '');
			streamedStdout += chunk;
			postOutput(chunk);
		};
		context.onStderr = (text) => {
			const chunk = String(text || '');
			streamedStderr += chunk;
			postOutput(chunk);
		};
		context.args = Array.isArray(args) ? args.map(String) : [];
		context.files = buildWorkspaceFiles(code, activePath, workspaceFiles);
		if (log) {
			console.log('[wasm-idle:clojurescript-worker] run start with host-preflighted assets');
		}
		self.postMessage({ progress: { percent: 5, stage: 'Loading ClojureScript compiler' } });
		const execute = await loadCompiler(runtimePreflight, manifestFingerprint, maxAssetBytes);
		self.postMessage({ progress: { percent: 35, stage: 'Compiling ClojureScript' } });
		const result = await executeSource(execute, String(code || ''), activePath, context);
		postBufferedRemainder(result?.stdout, streamedStdout);
		if (!result?.ok) {
			throw new Error(result?.stderr || 'ClojureScript evaluation failed.');
		}
		postBufferedRemainder(result?.stderr, streamedStderr);
		self.postMessage({ progress: { percent: 100, stage: 'Finished' } });
		if (log) console.log('[wasm-idle:clojurescript-worker] run settled');
		self.postMessage({ results: true });
	} catch (error) {
		if (log) console.error('[wasm-idle:clojurescript-worker] failed', error);
		self.postMessage({ error: error?.message || String(error) });
	}
};
