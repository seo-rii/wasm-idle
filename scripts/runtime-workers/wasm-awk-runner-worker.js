const textEncoder = new TextEncoder();
const runtimePreflightKeys = ['goShimBytes', 'protocol', 'wasmBytes'];
const appRunKeys = [
	'activePath',
	'args',
	'baseUrl',
	'code',
	'log',
	'manifestFingerprint',
	'manifestUrl',
	'maxAssetBytes',
	'run',
	'runId',
	'runtimePreflight',
	'stdin',
	'stdinEof',
	'workspaceFiles'
];
const appStreamingRunKeys = [...appRunKeys, 'stdinChannel'].sort();
const lspRunKeys = [
	'activePath',
	'args',
	'code',
	'diagnose',
	'log',
	'run',
	'runtimePreflight',
	'stdin'
];
const pinnedRuntimeProfile = Object.freeze({
	profileId: '__WASM_IDLE_AWK_PROFILE_ID__',
	goShimReceipt: Object.freeze({
		bytes: Number('__WASM_IDLE_AWK_GO_SHIM_BYTES__'),
		sha256: '__WASM_IDLE_AWK_GO_SHIM_SHA256__'
	}),
	logicalWasmReceipt: Object.freeze({
		bytes: Number('__WASM_IDLE_AWK_LOGICAL_WASM_BYTES__'),
		sha256: '__WASM_IDLE_AWK_LOGICAL_WASM_SHA256__'
	})
});
const deniedNetworkGlobals = [
	'Cache',
	'CacheStorage',
	'EventSource',
	'RTCPeerConnection',
	'SharedWorker',
	'WebSocket',
	'WebSocketStream',
	'WebTransport',
	'Worker',
	'XMLHttpRequest',
	'fetch'
];
const deniedCacheStorageMethods = ['delete', 'has', 'keys', 'match', 'open'];
let runState = 'idle';

function postOutput(text) {
	if (text) self.postMessage({ output: text });
}

function createStdinReader(stdin, channel) {
	if (channel === undefined) {
		const bytes = textEncoder.encode(typeof stdin === 'string' ? stdin : '');
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
		throw new Error('Invalid GoAWK streaming stdin channel.');
	}

	const control = new Int32Array(channel.buffer, 0, 4);
	const bytes = new Uint8Array(channel.buffer, channel.controlBytes, channel.capacity);
	return {
		read(maxLength) {
			if (!Number.isSafeInteger(maxLength) || maxLength <= 0) return new Uint8Array();
			while (true) {
				if (Atomics.load(control, 3) === 1) {
					throw new Error('GoAWK streaming stdin was cancelled.');
				}
				const write = Atomics.load(control, 0);
				const read = Atomics.load(control, 1);
				const available = write - read;
				if (available < 0 || available > bytes.byteLength) {
					throw new Error('GoAWK streaming stdin counters are invalid.');
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

function createOutputSink(onText) {
	const decoder = new TextDecoder();
	let finished = false;
	return {
		write(chunk) {
			if (!(chunk instanceof Uint8Array)) {
				throw new Error('GoAWK output sink requires a Uint8Array.');
			}
			const text = decoder.decode(chunk, { stream: true });
			if (text) onText(text);
		},
		finish() {
			if (finished) return;
			finished = true;
			const text = decoder.decode();
			if (text) onText(text);
		}
	};
}

function waitForRunFunction() {
	return new Promise((resolve, reject) => {
		let attempts = 0;
		const tick = () => {
			if (typeof globalThis.wasmIdleRunAwk === 'function') {
				resolve(globalThis.wasmIdleRunAwk);
				return;
			}
			attempts += 1;
			if (attempts > 100) {
				reject(new Error('GoAWK wasm runtime did not initialize.'));
				return;
			}
			setTimeout(tick, 0);
		};
		tick();
	});
}

function validateOwnedBytes(value, label) {
	if (
		!(value instanceof Uint8Array) ||
		!(value.buffer instanceof ArrayBuffer) ||
		value.byteOffset !== 0 ||
		value.byteLength === 0 ||
		value.byteLength !== value.buffer.byteLength
	) {
		throw new Error(`GoAWK ${label} must be an exclusively owned Uint8Array.`);
	}
	return value;
}

function isPlainRecord(value) {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) return false;
	if (Object.getOwnPropertySymbols(value).length) return false;
	return Object.values(Object.getOwnPropertyDescriptors(value)).every(
		(descriptor) => !descriptor.get && !descriptor.set
	);
}

function hasExactKeys(value, expectedKeys) {
	const keys = Object.keys(value).sort();
	return (
		keys.length === expectedKeys.length &&
		keys.every((key, index) => key === expectedKeys[index])
	);
}

function isWorkspaceFile(value) {
	return (
		isPlainRecord(value) &&
		hasExactKeys(value, ['content', 'path']) &&
		typeof value.path === 'string' &&
		value.path.length > 0 &&
		typeof value.content === 'string'
	);
}

function validateRunEnvelope(value) {
	if (!isPlainRecord(value)) throw new Error('Invalid GoAWK run request envelope.');
	const isLsp = hasExactKeys(value, lspRunKeys);
	const expectedAppKeys = value.stdinChannel === undefined ? appRunKeys : appStreamingRunKeys;
	const isApp = hasExactKeys(value, expectedAppKeys);
	if (!isLsp && !isApp) throw new Error('Invalid GoAWK run request envelope.');
	if (
		value.run !== true ||
		typeof value.code !== 'string' ||
		!Array.isArray(value.args) ||
		value.args.some((argument) => typeof argument !== 'string') ||
		typeof value.activePath !== 'string' ||
		!value.activePath ||
		typeof value.log !== 'boolean'
	) {
		throw new Error('Invalid GoAWK run request envelope.');
	}
	if (isLsp) {
		if (value.diagnose !== true || typeof value.stdin !== 'string') {
			throw new Error('Invalid GoAWK language-server request envelope.');
		}
	} else if (
		typeof value.runId !== 'string' ||
		!/^static-\d+$/u.test(value.runId) ||
		typeof value.baseUrl !== 'string' ||
		typeof value.manifestUrl !== 'string' ||
		!value.manifestUrl ||
		typeof value.manifestFingerprint !== 'string' ||
		!/^[a-f0-9]{64}$/u.test(value.manifestFingerprint) ||
		!Number.isSafeInteger(value.maxAssetBytes) ||
		value.maxAssetBytes <= 0 ||
		(value.stdin !== undefined && typeof value.stdin !== 'string') ||
		typeof value.stdinEof !== 'boolean' ||
		!Array.isArray(value.workspaceFiles) ||
		value.workspaceFiles.some((file) => !isWorkspaceFile(file)) ||
		(value.stdinChannel !== undefined && !isPlainRecord(value.stdinChannel))
	) {
		throw new Error('Invalid GoAWK application request envelope.');
	}
	return value;
}

function validatePinnedReceipt(value, label) {
	if (
		!isPlainRecord(value) ||
		!hasExactKeys(value, ['bytes', 'sha256']) ||
		!Number.isSafeInteger(value.bytes) ||
		value.bytes <= 0 ||
		typeof value.sha256 !== 'string' ||
		!/^[a-f0-9]{64}$/u.test(value.sha256)
	) {
		throw new Error(`GoAWK runner has an invalid baked ${label} receipt.`);
	}
	return value;
}

function validatePinnedRuntimeProfile() {
	if (
		!isPlainRecord(pinnedRuntimeProfile) ||
		!hasExactKeys(pinnedRuntimeProfile, ['goShimReceipt', 'logicalWasmReceipt', 'profileId']) ||
		typeof pinnedRuntimeProfile.profileId !== 'string' ||
		!/^goawk-[A-Za-z0-9._-]+$/u.test(pinnedRuntimeProfile.profileId)
	) {
		throw new Error('GoAWK runner does not contain a valid baked runtime profile.');
	}
	return {
		goShimReceipt: validatePinnedReceipt(pinnedRuntimeProfile.goShimReceipt, 'Go shim'),
		logicalWasmReceipt: validatePinnedReceipt(
			pinnedRuntimeProfile.logicalWasmReceipt,
			'logical Wasm'
		)
	};
}

function validateRuntimePreflight(value) {
	if (!isPlainRecord(value)) {
		throw new Error('Invalid GoAWK runtime preflight payload.');
	}
	if (
		!hasExactKeys(value, runtimePreflightKeys) ||
		value.protocol !== 'wasm-idle-awk-runtime-v2'
	) {
		throw new Error('Invalid GoAWK runtime preflight payload.');
	}
	const goShimBytes = validateOwnedBytes(value.goShimBytes, 'Go shim');
	const wasmBytes = validateOwnedBytes(value.wasmBytes, 'Wasm');
	if (
		wasmBytes.byteLength < 8 ||
		wasmBytes[0] !== 0x00 ||
		wasmBytes[1] !== 0x61 ||
		wasmBytes[2] !== 0x73 ||
		wasmBytes[3] !== 0x6d
	) {
		throw new Error('GoAWK Wasm payload does not have a WebAssembly module header.');
	}
	return { goShimBytes, wasmBytes };
}

async function sha256Hex(bytes) {
	if (!globalThis.crypto?.subtle) {
		throw new Error('GoAWK runtime verification requires Web Crypto SHA-256.');
	}
	const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes.buffer));
	return Array.from(digest, (value) => value.toString(16).padStart(2, '0')).join('');
}

async function verifyPinnedAsset(bytes, receipt, label) {
	if (bytes.byteLength !== receipt.bytes) {
		throw new Error(`GoAWK ${label} does not match the baked byte receipt.`);
	}
	if ((await sha256Hex(bytes)) !== receipt.sha256) {
		throw new Error(`GoAWK ${label} does not match the baked SHA-256 receipt.`);
	}
}

async function verifyRuntimePreflight(runtimePreflight) {
	const receipts = validatePinnedRuntimeProfile();
	await verifyPinnedAsset(runtimePreflight.goShimBytes, receipts.goShimReceipt, 'Go shim');
	await verifyPinnedAsset(
		runtimePreflight.wasmBytes,
		receipts.logicalWasmReceipt,
		'logical Wasm'
	);
}

function installNetworkGuard(shimUrl) {
	if (typeof globalThis.importScripts !== 'function') {
		throw new Error('GoAWK runtime requires classic worker importScripts.');
	}
	const nativeImportScripts = globalThis.importScripts.bind(globalThis);
	const denyNetwork = () => {
		throw new Error('GoAWK runner network access is disabled.');
	};
	for (const name of deniedNetworkGlobals) {
		Object.defineProperty(globalThis, name, {
			value: denyNetwork,
			writable: false,
			configurable: false
		});
	}
	Object.defineProperty(globalThis, 'caches', {
		value: Object.freeze(
			Object.fromEntries(deniedCacheStorageMethods.map((name) => [name, denyNetwork]))
		),
		writable: false,
		configurable: false
	});
	if (typeof globalThis.navigator?.sendBeacon === 'function') {
		Object.defineProperty(globalThis.navigator, 'sendBeacon', {
			value: denyNetwork,
			writable: false,
			configurable: false
		});
	}
	let shimImportAvailable = true;
	Object.defineProperty(globalThis, 'importScripts', {
		value: (...urls) => {
			if (!shimImportAvailable || urls.length !== 1 || urls[0] !== shimUrl) {
				throw new Error('GoAWK runner rejected a non-pinned script import.');
			}
			shimImportAvailable = false;
			return nativeImportScripts(shimUrl);
		},
		writable: false,
		configurable: false
	});
}

function loadGoShim(goShimBytes) {
	if (
		typeof Blob !== 'function' ||
		typeof URL !== 'function' ||
		typeof URL.createObjectURL !== 'function' ||
		typeof URL.revokeObjectURL !== 'function'
	) {
		throw new Error('GoAWK runtime requires Blob-backed classic worker scripts.');
	}
	const shimUrl = URL.createObjectURL(
		new Blob([goShimBytes], { type: 'text/javascript;charset=utf-8' })
	);
	try {
		installNetworkGuard(shimUrl);
		globalThis.importScripts(shimUrl);
	} finally {
		URL.revokeObjectURL(shimUrl);
	}
	if (typeof globalThis.Go !== 'function') {
		throw new Error('GoAWK Go shim did not install the Go runtime.');
	}
}

async function loadRuntime(runtimePreflight) {
	const { goShimBytes, wasmBytes } = runtimePreflight;
	loadGoShim(goShimBytes);
	const go = new globalThis.Go();
	const { instance } = await WebAssembly.instantiate(wasmBytes, go.importObject);
	void go.run(instance).catch((error) => {
		console.error('[wasm-idle:awk-worker] Go runtime stopped', error);
	});
	return waitForRunFunction();
}

self.onmessage = async (event) => {
	if (runState !== 'idle') {
		self.postMessage({ error: 'Invalid or repeated GoAWK run request.' });
		return;
	}
	runState = 'validating';
	let stdoutSink;
	let stderrSink;
	let log = false;
	try {
		const request = validateRunEnvelope(event.data);
		log = request.log;
		const runtimePreflight = validateRuntimePreflight(request.runtimePreflight);
		runState = 'verifying';
		await verifyRuntimePreflight(runtimePreflight);
		runState = 'verified';
		if (log) {
			console.log('[wasm-idle:awk-worker] run start');
		}
		runState = 'loading-runtime';
		const runAwk = await loadRuntime(runtimePreflight);
		runState = 'running';
		let result;
		if (request.stdinChannel === undefined) {
			result = runAwk(
				request.code,
				typeof request.stdin === 'string' ? request.stdin : '',
				request.args
			);
			postOutput(String(result.stdout || ''));
			postOutput(String(result.stderr || ''));
		} else {
			stdoutSink = createOutputSink(postOutput);
			stderrSink = createOutputSink(postOutput);
			result = runAwk(
				request.code,
				createStdinReader(request.stdin, request.stdinChannel),
				request.args,
				{
					stdout: (chunk) => stdoutSink.write(chunk),
					stderr: (chunk) => stderrSink.write(chunk)
				}
			);
			stdoutSink.finish();
			stderrSink.finish();
		}
		if (result.error) {
			throw new Error(String(result.error));
		}
		if (Number(result.status || 0) !== 0) {
			throw new Error(`AWK exited with status ${result.status}.`);
		}
		if (log) {
			console.log('[wasm-idle:awk-worker] run settled');
		}
		runState = 'settled';
		self.postMessage({ results: true });
	} catch (error) {
		const failedAfterVerification = !['idle', 'validating', 'verifying'].includes(runState);
		runState = 'failed';
		if (log && failedAfterVerification) {
			console.error('[wasm-idle:awk-worker] failed', error);
		}
		self.postMessage({ error: error?.message || String(error) });
	} finally {
		stdoutSink?.finish();
		stderrSink?.finish();
	}
};
