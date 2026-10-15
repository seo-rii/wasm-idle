import type { RuntimeAssetCache } from './session-asset-cache.js';

/** The pinned logical Wasm bytes, after transport decoding or decompression. */
export interface RuntimeWasmModuleReceipt {
	readonly bytes: number;
	readonly sha256: string;
}

export interface RuntimeWasmModuleServiceOptions {
	cache?: RuntimeAssetCache;
	receipt: RuntimeWasmModuleReceipt;
	/** Host authorization identity: trust, loader policy and verified executable profile. */
	identity: string;
	/**
	 * Identifies the deterministic compilation implementation, its version, options and
	 * memory caps. Hosts must change this key whenever a transform or option changes.
	 * Use `native-default-v1` for unmodified WebAssembly.compile without options.
	 */
	compileKey: string;
	maxAssetBytes: number;
	compile?: (ownedBytes: Uint8Array<ArrayBuffer>) => Promise<WebAssembly.Module>;
	signal?: AbortSignal;
}

export interface RuntimeWasmModuleService {
	readonly port: MessagePort;
	close(): void;
}

export interface RuntimeWasmModuleRequestOptions {
	signal?: AbortSignal;
	timeoutMs?: number;
}

const abortReason = (signal: AbortSignal) =>
	signal.reason ?? new DOMException('Runtime Wasm module request aborted', 'AbortError');

const nativeCompile = (bytes: Uint8Array<ArrayBuffer>) => WebAssembly.compile(bytes);

const closePort = (port: MessagePort) => {
	try {
		port.onmessage = null;
	} catch {
		// Cleanup cannot replace the compiler result or prevent a request settling.
	}
	try {
		port.onmessageerror = null;
	} catch {
		// Cleanup remains best effort after a peer or host has retired the endpoint.
	}
	try {
		port.close();
	} catch {
		// The endpoint is logically detached, even if native cleanup rejects it.
	}
};

/**
 * Serve one compiler request on an endpoint supplied by a runtime worker. Only the
 * host selects receipts, authorization identities and compilation configuration;
 * the peer supplies owned bytes, never a claimed hash, cache key or compiled module.
 */
export function serveRuntimeWasmModule(
	port: MessagePort,
	options: RuntimeWasmModuleServiceOptions
): Pick<RuntimeWasmModuleService, 'close'> {
	const receipt = { bytes: options.receipt.bytes, sha256: options.receipt.sha256 };
	const { cache, maxAssetBytes, identity, compileKey } = options;
	const compile = options.compile ?? nativeCompile;
	const parent = options.signal;
	if (
		!Number.isSafeInteger(maxAssetBytes) ||
		maxAssetBytes <= 0 ||
		!Number.isSafeInteger(receipt.bytes) ||
		receipt.bytes < 8 ||
		receipt.bytes > maxAssetBytes ||
		typeof receipt.sha256 !== 'string' ||
		!/^[a-f0-9]{64}$/u.test(receipt.sha256)
	) {
		throw new TypeError('Runtime Wasm module receipt exceeds the asset limit or is invalid');
	}
	if (
		typeof identity !== 'string' ||
		!identity ||
		typeof compileKey !== 'string' ||
		!compileKey
	) {
		throw new TypeError(
			'Runtime Wasm module service requires host authorization and compile keys'
		);
	}
	if (!globalThis.crypto?.subtle) {
		throw new Error('Runtime Wasm module verification requires Web Crypto');
	}
	const key = JSON.stringify([
		'runtime-wasm-module-v1',
		identity,
		receipt.bytes,
		receipt.sha256,
		compileKey,
		maxAssetBytes
	]);
	const controller = new AbortController();
	let closed = false;
	let received = false;
	const finish = () => {
		if (closed) return;
		closed = true;
		parent?.removeEventListener('abort', abort);
		closePort(port);
	};
	const close = () => {
		controller.abort(
			parent?.aborted
				? abortReason(parent)
				: new DOMException('Runtime Wasm module service closed', 'AbortError')
		);
		finish();
	};
	const abort = () => close();
	port.onmessageerror = close;
	port.onmessage = (event: MessageEvent<unknown>) => {
		if (closed) return;
		const message = event.data as { type?: unknown; bytes?: unknown } | null;
		if (message?.type === 'cancel') {
			close();
			return;
		}
		if (received) return;
		received = true;
		void (async () => {
			if (
				message?.type !== 'compile' ||
				!(message.bytes instanceof ArrayBuffer) ||
				message.bytes.byteLength !== receipt.bytes
			) {
				throw new Error('Invalid runtime Wasm module request');
			}
			const bytes = new Uint8Array(message.bytes);
			// MessagePort cloning/transfer gives this realm ownership. Recheck the pinned
			// receipt even on a cache hit, before permitting reuse of a compiled module.
			const digest = await crypto.subtle.digest('SHA-256', bytes);
			const hash = Array.from(new Uint8Array(digest), (byte) =>
				byte.toString(16).padStart(2, '0')
			).join('');
			if (hash !== receipt.sha256) throw new Error('Runtime Wasm module integrity mismatch');
			controller.signal.throwIfAborted();
			let module = cache?.get<WebAssembly.Module>(key);
			if (!module) {
				const start = async (signal: AbortSignal) => {
					signal.throwIfAborted();
					const module = await compile(bytes);
					signal.throwIfAborted();
					if (!(module instanceof WebAssembly.Module)) {
						throw new Error('Runtime Wasm compiler did not return a module');
					}
					// Native engine memory is opaque; account by pinned logical module size.
					// Failed or abandoned compilation never publishes a retained value.
					cache?.set(key, module, receipt.bytes);
					return module;
				};
				module = cache
					? await cache.share(key, controller.signal, start)
					: await start(controller.signal);
			}
			if (!closed) port.postMessage({ type: 'module', module });
		})()
			.catch((error: unknown) => {
				try {
					if (!closed) {
						port.postMessage({
							type: 'error',
							message: error instanceof Error ? error.message : String(error)
						});
					}
				} catch {
					// The peer may close while hashing or native compilation is pending.
				}
			})
			.finally(finish);
	};
	parent?.addEventListener('abort', abort, { once: true });
	if (parent?.aborted) close();
	else port.start();
	return { close };
}

/** Create a host service and the opposite endpoint to transfer to a compiler worker. */
export function createRuntimeWasmModuleService(
	options: RuntimeWasmModuleServiceOptions
): RuntimeWasmModuleService {
	const channel = new MessageChannel();
	let service: Pick<RuntimeWasmModuleService, 'close'>;
	try {
		service = serveRuntimeWasmModule(channel.port1, options);
	} catch (error) {
		closePort(channel.port1);
		closePort(channel.port2);
		throw error;
	}
	return {
		port: channel.port2,
		close() {
			service.close();
			closePort(channel.port2);
		}
	};
}

/** Transfer verified, worker-owned bytes and accept exactly one native module response. */
export function requestRuntimeWasmModule(
	bytes: Uint8Array,
	port: MessagePort,
	options: RuntimeWasmModuleRequestOptions = {}
): Promise<WebAssembly.Module> {
	const timeoutMs = options.timeoutMs ?? 120_000;
	if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 2_147_483_647) {
		closePort(port);
		return Promise.reject(
			new TypeError('Runtime Wasm module timeout must be a positive integer')
		);
	}
	const signal = options.signal;
	return new Promise((resolve, reject) => {
		let settled = false;
		const finish = (error?: unknown, module?: WebAssembly.Module, cancel = false) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			signal?.removeEventListener('abort', abort);
			if (cancel) {
				try {
					port.postMessage({ type: 'cancel' });
				} catch {
					// Closing a retired peer must not replace the request's result.
				}
			}
			closePort(port);
			if (error !== undefined) reject(error);
			else resolve(module!);
		};
		const abort = () => finish(abortReason(signal!), undefined, true);
		const timer = setTimeout(
			() => finish(new Error('Runtime Wasm module service timed out'), undefined, true),
			timeoutMs
		);
		port.onmessageerror = () =>
			finish(new Error('Runtime Wasm module response could not be cloned'), undefined, true);
		port.onmessage = (event: MessageEvent<unknown>) => {
			const message = event.data as {
				type?: unknown;
				module?: unknown;
				message?: unknown;
			} | null;
			if (message?.type === 'module' && message.module instanceof WebAssembly.Module) {
				finish(undefined, message.module);
			} else {
				finish(
					new Error(
						message?.type === 'error' && typeof message.message === 'string'
							? message.message
							: 'Invalid runtime Wasm module response'
					),
					undefined,
					true
				);
			}
		};
		signal?.addEventListener('abort', abort, { once: true });
		if (signal?.aborted) {
			abort();
			return;
		}
		try {
			const buffer =
				bytes.buffer instanceof ArrayBuffer &&
				bytes.byteOffset === 0 &&
				bytes.byteLength === bytes.buffer.byteLength
					? bytes.buffer
					: Uint8Array.from(bytes).buffer;
			port.postMessage({ type: 'compile', bytes: buffer }, [buffer]);
			port.start();
		} catch (error) {
			finish(error instanceof Error ? error : new Error(String(error)), undefined, true);
		}
	});
}
