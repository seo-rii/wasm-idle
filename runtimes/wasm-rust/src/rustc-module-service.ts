import { compileOwnedRustcModule } from './rustc-module.js';
import { DEFAULT_MAX_RUNTIME_ASSET_BYTES, type RuntimeAssetReceipt } from './runtime-asset.js';

// Cache only immutable compiler modules in the long-lived parent runtime realm.
// No guest memory, filesystem, source, instance or helper-thread state crosses runs.
const modules = new Map<string, Promise<WebAssembly.Module>>();
const MAX_MODULES = 2;
export function clearRustcModuleCache() { modules.clear(); }

export function createRustcModuleService(receipt: RuntimeAssetReceipt | undefined) {
	if (!receipt || !globalThis.crypto?.subtle || typeof MessageChannel === 'undefined') return undefined;
	const expectedBytes = receipt.uncompressedBytes ?? receipt.bytes;
	const expectedHash = receipt.uncompressedSha256 ?? receipt.sha256;
	if (!Number.isSafeInteger(expectedBytes) || expectedBytes < 8 ||
		expectedBytes > DEFAULT_MAX_RUNTIME_ASSET_BYTES || !/^[a-f0-9]{64}$/.test(expectedHash)) {
		throw new Error('Invalid rustc module service receipt');
	}
	const channel = new MessageChannel();
	let closed = false;
	let received = false;
	const finish = () => {
		closed = true;
		channel.port1.onmessage = null;
		channel.port1.onmessageerror = null;
		channel.port1.close();
	};
	const close = () => { finish(); channel.port2.close(); };
	channel.port1.onmessageerror = close;
	channel.port1.onmessage = (event: MessageEvent<unknown>) => {
		if (received || closed) return;
		received = true;
		void (async () => {
			const message = event.data as { type?: unknown; bytes?: unknown };
			if (!message || message.type !== 'compile' || !(message.bytes instanceof ArrayBuffer) ||
				message.bytes.byteLength !== expectedBytes) throw new Error('Invalid rustc module request');
			// Structured transfer gives this realm sole ownership. Recheck the pinned
			// logical receipt here; never accept a claimed hash or caller-supplied Module.
			const bytes = new Uint8Array(message.bytes);
			const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
				byte => byte.toString(16).padStart(2, '0')).join('');
			if (hash !== expectedHash) throw new Error('rustc module service integrity mismatch');
			if (closed) return;
			const key = `rustc-native-default-v1:${hash}`;
			let compiled = modules.get(key);
			if (compiled) {
				modules.delete(key);
				modules.set(key, compiled);
			} else {
				compiled = compileOwnedRustcModule(bytes);
				modules.set(key, compiled);
				const operation = compiled;
				void operation.catch(() => { if (modules.get(key) === operation) modules.delete(key); });
				while (modules.size > MAX_MODULES) modules.delete(modules.keys().next().value!);
			}
			const module = await compiled;
			if (!closed) channel.port1.postMessage({ type: 'module', module });
		})().catch(error => {
			try { if (!closed) channel.port1.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) }); } catch { /* Peer closed during native compilation. */ }
		}).finally(finish);
	};
	return { port: channel.port2, close };
}

/** Called only after the one-shot compiler worker's verified, bounded asset fetch. */
export function compileRustcThroughPort(bytes: Uint8Array, port: MessagePort, timeoutMs = 120_000): Promise<WebAssembly.Module> {
	return new Promise((resolve, reject) => {
		const finish = (error?: Error, module?: WebAssembly.Module) => {
			clearTimeout(timer);
			port.onmessage = null;
			port.onmessageerror = null;
			port.close();
			if (error) reject(error); else resolve(module!);
		};
		const timer = setTimeout(() => finish(new Error('rustc module service timed out')), timeoutMs);
		port.onmessageerror = () => finish(new Error('rustc module response could not be cloned'));
		port.onmessage = (event: MessageEvent<{type?: string; module?: unknown; message?: unknown}>) => {
			if (event.data?.type === 'module' && event.data.module instanceof WebAssembly.Module) finish(undefined, event.data.module);
			else finish(new Error(typeof event.data?.message === 'string' ? event.data.message : 'Invalid rustc module response'));
		};
		try {
			const buffer = bytes.buffer instanceof ArrayBuffer && bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
				? bytes.buffer : Uint8Array.from(bytes).buffer;
			port.postMessage({ type: 'compile', bytes: buffer }, [buffer]);
		} catch (error) { finish(error instanceof Error ? error : new Error(String(error))); }
	});
}
