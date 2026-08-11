const textEncoder = new TextEncoder();
const fatalTextDecoder = new TextDecoder('utf-8', { fatal: true });
const manifestFormat = 'wasm-clojurescript-runtime-manifest-v2';
const fingerprintDomain = 'wasm-idle:clojurescript-runtime-manifest:v2';
const hardMaxAssetBytes = 16 * 1024 * 1024;
const maxManifestBytes = 64 * 1024;
const expectedBuild = Object.freeze({
	clojureScriptVersion: '1.12.134',
	clojureToolsArchiveSha256: '13769da6d63a98deb2024378ae1a64e4ee211ac1035340dfca7a6944c41cde21',
	clojureToolsVersion: '1.12.4.1618',
	jdkArchiveSha256: '4b2220e232a97997b436ca6ab15cbf70171ecff52958a46159dfa5a8c44ca4de',
	jdkVersion: '21.0.11+10',
	optimizations: 'simple',
	target: 'webworker'
});

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

function assetUrl(baseUrl, path, fingerprint) {
	const base = requireHttpUrl(baseUrl, 'ClojureScript runtime base');
	const url = new URL(path, base);
	if (fingerprint) url.searchParams.set('v', fingerprint);
	return url.href;
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
		candidate.path !== 'compiler.js.gz' ||
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
		path: 'compiler.js.gz',
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

async function normalizeManifest(value, expectedFingerprint, maxAssetBytes) {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error('ClojureScript runtime manifest must be an object.');
	}
	if (value.format !== manifestFormat || value.runtime !== 'cljs.js') {
		throw new Error('ClojureScript runtime manifest format is unsupported.');
	}
	if (
		typeof value.profileId !== 'string' ||
		!/^clojurescript-[A-Za-z0-9._+-]+$/u.test(value.profileId) ||
		!value.source ||
		typeof value.source !== 'object' ||
		Array.isArray(value.source) ||
		value.source.repository !== 'https://github.com/clojure/clojurescript' ||
		value.source.revision !== 'r1.12.134' ||
		value.source.integrationRepository !== 'https://github.com/seo-rii/wasm-idle' ||
		typeof value.source.integrationRevision !== 'string' ||
		!/^[a-f0-9]{40}$/u.test(value.source.integrationRevision) ||
		!value.build ||
		typeof value.build !== 'object' ||
		Array.isArray(value.build) ||
		JSON.stringify(Object.keys(value.build).sort()) !==
			JSON.stringify(Object.keys(expectedBuild).sort()) ||
		Object.entries(expectedBuild).some(([name, expected]) => value.build[name] !== expected)
	) {
		throw new Error(
			'ClojureScript runtime manifest profile, source, or build metadata is invalid.'
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

async function decompressGzipBounded(compressedBytes, expectedBytes, maxBytes) {
	if (typeof DecompressionStream !== 'function') {
		throw new Error('ClojureScript runtime gzip decompression is unavailable.');
	}
	if (!Number.isSafeInteger(expectedBytes) || expectedBytes <= 0 || expectedBytes > maxBytes) {
		throw new Error('ClojureScript compiler logical byte size is invalid.');
	}
	let reader;
	try {
		reader = new Blob([compressedBytes])
			.stream()
			.pipeThrough(new DecompressionStream('gzip'))
			.getReader();
	} catch {
		throw new Error('ClojureScript compiler gzip stream could not be opened.');
	}
	const output = new Uint8Array(expectedBytes);
	let loaded = 0;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			if (!(value instanceof Uint8Array)) {
				throw new Error('ClojureScript compiler gzip returned an invalid byte stream.');
			}
			const nextLoaded = loaded + value.byteLength;
			if (!Number.isSafeInteger(nextLoaded) || nextLoaded > expectedBytes) {
				throw new Error('ClojureScript compiler gzip exceeds its logical receipt size.');
			}
			output.set(value, loaded);
			loaded = nextLoaded;
		}
		if (loaded !== expectedBytes) throw new Error('ClojureScript compiler gzip is truncated.');
		return output;
	} catch (error) {
		try {
			void Promise.resolve(reader.cancel(error)).catch(() => undefined);
		} catch {
			// Preserve the decompression failure.
		}
		throw error;
	} finally {
		try {
			reader.releaseLock();
		} catch {
			// Preserve the decompression result.
		}
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

async function loadCompiler(baseUrl, manifestUrl, manifestFingerprint, requestedMaxAssetBytes) {
	if (typeof globalThis.wasm_idle?.runner?.execute !== 'function') {
		if (!Number.isSafeInteger(requestedMaxAssetBytes) || requestedMaxAssetBytes <= 0) {
			throw new Error('ClojureScript runtime asset byte limit is invalid.');
		}
		const maxAssetBytes = Math.min(requestedMaxAssetBytes, hardMaxAssetBytes);
		const resolvedManifestUrl =
			manifestUrl || assetUrl(baseUrl, 'runtime-manifest.v2.json', manifestFingerprint);
		const manifestBytes = await fetchBoundedBytes(
			resolvedManifestUrl,
			'ClojureScript runtime manifest',
			Math.min(maxManifestBytes, maxAssetBytes),
			undefined,
			'no-store'
		);
		let parsed;
		try {
			parsed = JSON.parse(fatalTextDecoder.decode(manifestBytes));
		} catch {
			throw new Error('ClojureScript runtime manifest is not valid UTF-8 JSON.');
		}
		const manifest = await normalizeManifest(parsed, manifestFingerprint, maxAssetBytes);
		const compressedBytes = await fetchBoundedBytes(
			assetUrl(baseUrl, manifest.storage.path, manifestFingerprint),
			'ClojureScript runtime storage compiler.js.gz',
			manifest.storage.size,
			manifest.storage.size
		);
		await verifyReceiptBytes(
			manifest.storage,
			compressedBytes,
			'ClojureScript runtime storage compiler.js.gz'
		);
		const compilerBytes = await decompressGzipBounded(
			compressedBytes,
			manifest.asset.size,
			maxAssetBytes
		);
		await verifyReceiptBytes(
			manifest.asset,
			compilerBytes,
			'ClojureScript runtime asset compiler.js'
		);
		importVerifiedRuntimeScript(compilerBytes);
	}
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
		baseUrl,
		manifestUrl,
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
		if (log) console.log(`[wasm-idle:clojurescript-worker] run start baseUrl=${baseUrl}`);
		self.postMessage({ progress: { percent: 5, stage: 'Loading ClojureScript compiler' } });
		const execute = await loadCompiler(
			baseUrl,
			manifestUrl,
			manifestFingerprint,
			maxAssetBytes
		);
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
