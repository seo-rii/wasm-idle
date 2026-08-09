let runtimeIdentity = '';
let runtimePromise = null;

const manifestFormat = 'wasm-forth-runtime-manifest-v2';
const fingerprintDomain = 'wasm-idle:forth-runtime-manifest:v2';
const hardMaxAssetBytes = 128 * 1024 * 1024;
const maxManifestBytes = 64 * 1024;
const textEncoder = new TextEncoder();
const fatalTextDecoder = new TextDecoder('utf-8', { fatal: true });

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
		throw new Error('WAForth runtime integrity verification requires Web Crypto.');
	}
	const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes));
	return [...digest].map((value) => value.toString(16).padStart(2, '0')).join('');
}

async function computeFingerprint(profileId, waforthVersion, receipt) {
	const canonical = `${fingerprintDomain}\nformat\0${manifestFormat}\nprofileId\0${profileId}\nwaforthVersion\0${waforthVersion}\n${receipt.path}\0${receipt.size}\0${receipt.sha256}\n`;
	return await sha256Hex(textEncoder.encode(canonical));
}

async function normalizeManifest(value, expectedFingerprint, maxAssetBytes) {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error('WAForth runtime manifest must be an object.');
	}
	if (value.format !== manifestFormat || value.runtime !== 'waforth') {
		throw new Error('WAForth runtime manifest format is unsupported.');
	}
	if (
		typeof value.profileId !== 'string' ||
		!/^waforth-[A-Za-z0-9._-]+$/u.test(value.profileId) ||
		typeof value.waforthVersion !== 'string' ||
		!/^[A-Za-z0-9._-]+$/u.test(value.waforthVersion) ||
		value.profileId !== `waforth-${value.waforthVersion}`
	) {
		throw new Error('WAForth runtime manifest profile is invalid.');
	}
	if (typeof expectedFingerprint !== 'string' || !/^[a-f0-9]{64}$/u.test(expectedFingerprint)) {
		throw new Error('WAForth runtime expected fingerprint is invalid.');
	}
	if (value.fingerprint !== expectedFingerprint) {
		throw new Error('WAForth runtime manifest fingerprint does not match the pinned runtime.');
	}
	if (!Array.isArray(value.assets) || value.assets.length !== 1) {
		throw new Error('WAForth runtime manifest must declare exactly one asset.');
	}
	const candidate = value.assets[0];
	if (
		!candidate ||
		typeof candidate !== 'object' ||
		Array.isArray(candidate) ||
		candidate.path !== 'waforth.js' ||
		!Number.isSafeInteger(candidate.size) ||
		candidate.size <= 0 ||
		candidate.size > maxAssetBytes ||
		typeof candidate.sha256 !== 'string' ||
		!/^[a-f0-9]{64}$/u.test(candidate.sha256)
	) {
		throw new Error('WAForth runtime asset receipt is invalid or exceeds its byte limit.');
	}
	const receipt = {
		path: 'waforth.js',
		size: candidate.size,
		sha256: candidate.sha256
	};
	if (
		(await computeFingerprint(value.profileId, value.waforthVersion, receipt)) !==
		expectedFingerprint
	) {
		throw new Error('WAForth runtime receipt graph failed fingerprint verification.');
	}
	return { ...value, assets: [receipt] };
}

async function verifyReceiptBytes(receipt, bytes) {
	if (bytes.byteLength !== receipt.size) {
		throw new Error(`WAForth runtime asset ${receipt.path} has an unexpected byte size.`);
	}
	if ((await sha256Hex(bytes)) !== receipt.sha256) {
		throw new Error(`WAForth runtime asset ${receipt.path} failed SHA-256 verification.`);
	}
}

async function evaluateRuntime(bytes) {
	try {
		fatalTextDecoder.decode(bytes);
	} catch {
		throw new Error('WAForth runtime asset is not valid UTF-8 JavaScript.');
	}
	if (
		typeof Blob !== 'function' ||
		typeof URL.createObjectURL !== 'function' ||
		typeof URL.revokeObjectURL !== 'function' ||
		typeof importScripts !== 'function'
	) {
		throw new Error('WAForth verified runtime evaluation is unavailable.');
	}
	delete globalThis.WAForthPackage;
	const runtimeUrl = URL.createObjectURL(new Blob([bytes], { type: 'text/javascript' }));
	try {
		importScripts(runtimeUrl);
	} catch (error) {
		delete globalThis.WAForthPackage;
		throw error;
	} finally {
		try {
			URL.revokeObjectURL(runtimeUrl);
		} catch {
			// Blob URL cleanup must not replace the verified evaluation outcome.
		}
	}
	const runtimePackage = globalThis.WAForthPackage;
	const WAForth = runtimePackage?.default || runtimePackage;
	if (typeof WAForth !== 'function') {
		delete globalThis.WAForthPackage;
		throw new Error('WAForth runtime did not initialize.');
	}
	return { runtimePackage, WAForth };
}

async function loadWaforth(baseUrl, manifestUrl, manifestFingerprint, requestedMaxAssetBytes) {
	if (!Number.isSafeInteger(requestedMaxAssetBytes) || requestedMaxAssetBytes <= 0) {
		throw new Error('WAForth runtime asset byte limit is invalid.');
	}
	const maxAssetBytes = Math.min(requestedMaxAssetBytes, hardMaxAssetBytes);
	const resolvedManifestUrl = manifestUrl || assetUrl(baseUrl, 'runtime-manifest.v2.json');
	const identity = JSON.stringify([
		baseUrl,
		resolvedManifestUrl,
		manifestFingerprint,
		maxAssetBytes
	]);
	if (runtimeIdentity === identity && runtimePromise) return await runtimePromise;
	if (runtimeIdentity) {
		throw new Error('WAForth runtime profile cannot change inside a warm worker.');
	}
	runtimeIdentity = identity;
	const pending = (async () => {
		const manifestBytes = await fetchBoundedBytes(
			resolvedManifestUrl,
			'WAForth runtime manifest',
			Math.min(maxManifestBytes, maxAssetBytes),
			undefined,
			'no-store'
		);
		let parsed;
		try {
			parsed = JSON.parse(fatalTextDecoder.decode(manifestBytes));
		} catch {
			throw new Error('WAForth runtime manifest is not valid UTF-8 JSON.');
		}
		const manifest = await normalizeManifest(parsed, manifestFingerprint, maxAssetBytes);
		const receipt = manifest.assets[0];
		const runtimeBytes = await fetchBoundedBytes(
			versionedAssetUrl(baseUrl, receipt.path, manifestFingerprint),
			'WAForth runtime asset waforth.js',
			receipt.size,
			receipt.size
		);
		await verifyReceiptBytes(receipt, runtimeBytes);
		return await evaluateRuntime(runtimeBytes);
	})();
	runtimePromise = pending;
	try {
		return await pending;
	} catch (error) {
		if (runtimePromise === pending) {
			runtimePromise = null;
			runtimeIdentity = '';
			delete globalThis.WAForthPackage;
		}
		throw error;
	}
}

function postOutput(text) {
	if (text) self.postMessage({ output: text });
}

function createSharedKeyReader(channel) {
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
		throw new Error('Invalid WAForth streaming stdin channel.');
	}

	const control = new Int32Array(channel.buffer, 0, 4);
	const bytes = new Uint8Array(channel.buffer, channel.controlBytes, channel.capacity);
	return () => {
		while (true) {
			if (Atomics.load(control, 3) === 1) {
				throw new Error('WAForth streaming stdin was cancelled.');
			}
			const write = Atomics.load(control, 0);
			const read = Atomics.load(control, 1);
			const available = write - read;
			if (available < 0 || available > bytes.byteLength) {
				throw new Error('WAForth streaming stdin counters are invalid.');
			}
			if (available > 0) {
				const value = bytes[read % bytes.byteLength];
				Atomics.store(control, 1, read + 1);
				return value;
			}
			if (Atomics.load(control, 2) === 1) return -1;
			self.postMessage({ type: 'stdin-request' });
			Atomics.wait(control, 0, write);
		}
	};
}

function createKeyReader(stdin, channel) {
	const sharedReader = createSharedKeyReader(channel);
	if (sharedReader) return sharedReader;
	const source = typeof stdin === 'string' ? stdin : '';
	const bytes = Array.from(new TextEncoder().encode(source));
	let index = 0;
	return () => {
		if (index >= bytes.length) return -1;
		const value = bytes[index];
		index += 1;
		return value;
	};
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
	const decoder = new TextDecoder();
	try {
		const key = createKeyReader(stdin, stdinChannel);
		if (log) console.log(`[wasm-idle:forth-worker] run start baseUrl=${baseUrl}`);
		const { runtimePackage, WAForth } = await loadWaforth(
			baseUrl,
			manifestUrl,
			manifestFingerprint,
			maxAssetBytes
		);
		const forth = new WAForth();
		forth.key = key;
		forth.onEmit = (byte) => postOutput(decoder.decode(Uint8Array.of(byte), { stream: true }));
		await forth.load();
		const result = forth.interpret(String(code || ''), true);
		postOutput(decoder.decode());
		if (typeof runtimePackage.isSuccess === 'function' && !runtimePackage.isSuccess(result)) {
			const errorName = runtimePackage.ErrorCode?.[result] || result || 'unknown';
			throw new Error(`Forth exited with error code ${errorName}.`);
		}
		if (log) console.log('[wasm-idle:forth-worker] run settled');
		self.postMessage({ results: true });
	} catch (error) {
		if (log) console.error('[wasm-idle:forth-worker] failed', error);
		self.postMessage({ error: error?.message || String(error) });
	}
};
