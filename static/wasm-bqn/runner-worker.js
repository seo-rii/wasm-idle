const manifestFormat = 'wasm-bqn-runtime-manifest-v2';
const fingerprintDomain = 'wasm-idle:bqn-runtime-manifest:v2';
const hardMaxAssetBytes = 128 * 1024 * 1024;
const maxManifestBytes = 64 * 1024;
const buildOptions = ['ENVIRONMENT=worker', 'MODULARIZE=1', 'EXPORT_ES6=1', 'FORCE_FILESYSTEM=1'];
const fatalTextDecoder = new TextDecoder('utf-8', { fatal: true });
const textEncoder = new TextEncoder();

function assetUrl(baseUrl, path) {
	return new URL(path, baseUrl).href;
}

function versionedAssetUrl(baseUrl, path, fingerprint) {
	const url = new URL(path, baseUrl);
	url.searchParams.set('v', fingerprint);
	return url.href;
}

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

function cancelResponseBody(response, reason) {
	try {
		void Promise.resolve(response.body?.cancel(reason)).catch(() => undefined);
	} catch {
		// Preserve the trust-boundary failure that caused cancellation.
	}
}

async function fetchBoundedBytes(urlValue, label, maxBytes, expectedBytes, cache) {
	if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
		throw new Error(`${label} byte limit is invalid.`);
	}
	if (
		expectedBytes !== undefined &&
		(!Number.isSafeInteger(expectedBytes) || expectedBytes <= 0 || expectedBytes > maxBytes)
	) {
		throw new Error(`${label} expected byte size is invalid.`);
	}
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
		if (!response.ok) {
			throw new Error(`${label} request failed with status ${response.status}.`);
		}
		const contentLength = response.headers.get('content-length');
		if (contentLength !== null) {
			const normalized = contentLength.trim();
			const parsed = Number(normalized);
			if (!/^\d+$/u.test(normalized) || !Number.isSafeInteger(parsed)) {
				throw new Error(`${label} has an invalid Content-Length.`);
			}
			if (expectedBytes !== undefined && parsed !== expectedBytes) {
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
	const output = expectedBytes === undefined ? null : new Uint8Array(expectedBytes);
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
			if (expectedBytes !== undefined && nextLoaded > expectedBytes) {
				throw new Error(`${label} exceeds its receipt size.`);
			}
			if (!Number.isSafeInteger(nextLoaded) || nextLoaded > maxBytes) {
				throw new Error(`${label} exceeds its byte limit.`);
			}
			if (output) output.set(value, loaded);
			else chunks.push(value.slice());
			loaded = nextLoaded;
		}
		if (expectedBytes !== undefined && loaded !== expectedBytes) {
			throw new Error(`${label} is truncated.`);
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
	if (output) return output;
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

async function normalizeManifest(value, expectedFingerprint, maxAssetBytes) {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error('CBQN runtime manifest must be an object.');
	}
	if (value.format !== manifestFormat || value.runtime !== 'dzaima-cbqn') {
		throw new Error('CBQN runtime manifest format is unsupported.');
	}
	if (
		typeof value.profileId !== 'string' ||
		!/^dzaima-cbqn-[A-Za-z0-9._-]+$/u.test(value.profileId) ||
		!value.source ||
		typeof value.source !== 'object' ||
		Array.isArray(value.source) ||
		value.source.repository !== 'https://github.com/dzaima/CBQN' ||
		value.source.path !== 'dist' ||
		typeof value.source.revision !== 'string' ||
		!/^[A-Za-z0-9:;._-]+$/u.test(value.source.revision) ||
		!value.build ||
		typeof value.build !== 'object' ||
		Array.isArray(value.build) ||
		value.build.emscripten !== '3.1.8' ||
		!Array.isArray(value.build.options) ||
		JSON.stringify(value.build.options) !== JSON.stringify(buildOptions)
	) {
		throw new Error('CBQN runtime manifest profile, source, or build metadata is invalid.');
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
			value.storage.find((asset) => asset?.path === 'BQN.wasm.gz'),
			{ path: 'BQN.wasm.gz', logicalPath: 'BQN.wasm', encoding: 'gzip' },
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

function createBqnRunner(module) {
	const runLine = module.cwrap('cbqn_runLine', null, ['array', 'int']);
	const encoder = new TextEncoder();
	return (source) => {
		const bytes = encoder.encode(`${source}\0`);
		runLine(bytes, bytes.length - 1);
	};
}

async function createBqnRuntime(
	baseUrl,
	manifestUrl,
	manifestFingerprint,
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
	const resolvedManifestUrl = manifestUrl || assetUrl(baseUrl, 'runtime-manifest.v2.json');
	const manifestBytes = await fetchBoundedBytes(
		resolvedManifestUrl,
		'CBQN runtime manifest',
		Math.min(maxManifestBytes, maxAssetBytes),
		undefined,
		'no-store'
	);
	let parsed;
	try {
		parsed = JSON.parse(fatalTextDecoder.decode(manifestBytes));
	} catch {
		throw new Error('CBQN runtime manifest is not valid UTF-8 JSON.');
	}
	const manifest = await normalizeManifest(parsed, manifestFingerprint, maxAssetBytes);
	const runtimeBytes = {};
	for (const receipt of manifest.assets) {
		const bytes = await fetchBoundedBytes(
			versionedAssetUrl(baseUrl, receipt.path, manifestFingerprint),
			`CBQN runtime asset ${receipt.path}`,
			receipt.size,
			receipt.size
		);
		await verifyReceiptBytes(receipt, bytes);
		runtimeBytes[receipt.path] = bytes;
	}
	const runtimeModule = await importVerifiedRuntime(runtimeBytes['BQN.js']);
	const createModule = runtimeModule.default || runtimeModule;
	if (typeof createModule !== 'function') {
		throw new Error('CBQN runtime module did not export an Emscripten module factory.');
	}
	const module = await createModule({
		locateFile: (path) => {
			if (path !== 'BQN.wasm') throw new Error(`CBQN requested an undeclared asset: ${path}`);
			return assetUrl(baseUrl, path);
		},
		print: (message) => onStdout(String(message)),
		printErr: (message) => stderr.push(String(message)),
		stdin: inputReader,
		wasmBinary: runtimeBytes['BQN.wasm']
	});
	return createBqnRunner(module);
}

function postOutput(lines) {
	const output = lines.filter(Boolean).join('\n');
	if (output) self.postMessage({ output: output.endsWith('\n') ? output : `${output}\n` });
}

self.onmessage = async (event) => {
	const {
		baseUrl,
		manifestUrl,
		manifestFingerprint,
		maxAssetBytes,
		code,
		stdin,
		stdinChannel,
		log
	} = event.data || {};
	const stderr = [];
	try {
		if (log) console.log(`[wasm-idle:bqn-worker] run start baseUrl=${baseUrl}`);
		const source = String(code || '');
		if (source.trim()) {
			const runBqn = await createBqnRuntime(
				baseUrl,
				manifestUrl,
				manifestFingerprint,
				maxAssetBytes,
				stdin,
				stdinChannel,
				(message) => postOutput([message]),
				stderr
			);
			runBqn(source);
		}
		if (stderr.length > 0) throw new Error(stderr.join('\n'));
		if (log) console.log('[wasm-idle:bqn-worker] run settled');
		self.postMessage({ results: true });
	} catch (error) {
		const message = stderr.length > 0 ? stderr.join('\n') : error?.message || String(error);
		if (log) console.error('[wasm-idle:bqn-worker] failed', error);
		self.postMessage({ error: message });
	}
};
