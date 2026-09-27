import type { PHPLoaderModule } from '@php-wasm/universal';

/** Build-pinned PHP engines. Only immutable code is retained, never a PHP instance. */
export type PhpAsyncMode = 'jspi' | 'asyncify';
export interface PhpEngineAsset {
	readonly url: string;
	readonly bytes: number;
	readonly sha256: string;
	readonly load: () => Promise<PHPLoaderModule>;
}

const MAX_WASM_BYTES = 64 * 1024 * 1024;

function abortable<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
	return new Promise((resolve, reject) => {
		const abort = () => {
			signal.removeEventListener('abort', abort);
			reject(signal.reason);
		};
		signal.addEventListener('abort', abort, { once: true });
		operation.then(
			(value) => {
				signal.removeEventListener('abort', abort);
				resolve(value);
			},
			(error) => {
				signal.removeEventListener('abort', abort);
				reject(error);
			}
		);
		if (signal.aborted) abort();
	});
}

async function compileVerifiedEngine(asset: PhpEngineAsset, signal: AbortSignal) {
	if (
		!Number.isSafeInteger(asset.bytes) ||
		asset.bytes < 8 ||
		asset.bytes > MAX_WASM_BYTES ||
		!/^[a-f0-9]{64}$/.test(asset.sha256)
	)
		throw new Error('Invalid PHP engine receipt');
	if (!globalThis.crypto?.subtle) throw new Error('PHP engine verification requires Web Crypto');
	if (signal.aborted) throw signal.reason;
	const response = await fetch(asset.url, {
		signal,
		credentials: 'omit',
		redirect: 'error'
	});
	if (signal.aborted) {
		await response.body?.cancel().catch(() => {});
		throw signal.reason;
	}
	if (
		!response.ok ||
		!response.body ||
		response.redirected ||
		(response.url && response.url !== new URL(asset.url).href)
	) {
		await response.body?.cancel();
		throw new Error(`PHP engine request failed: ${response.status}`);
	}
	const reader = response.body.getReader();
	const bytes = new Uint8Array(asset.bytes);
	let offset = 0;
	let stopped = false;
	let verified = false;
	const abort = () => {
		void reader.cancel(signal.reason).catch(() => {});
	};
	signal.addEventListener('abort', abort, { once: true });
	const stream = new ReadableStream<Uint8Array>({
		async pull(controller) {
			try {
				if (signal.aborted) throw signal.reason;
				const chunk = await reader.read();
				if (stopped) return;
				if (signal.aborted) throw signal.reason;
				if (chunk.done) {
					if (offset !== bytes.length) throw new Error('PHP engine byte length mismatch');
					const hash = Array.from(
						new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
						(byte) => byte.toString(16).padStart(2, '0')
					).join('');
					if (signal.aborted) throw signal.reason;
					if (hash !== asset.sha256) throw new Error('PHP engine integrity mismatch');
					verified = true;
					controller.close();
					return;
				}
				if (chunk.value.length > bytes.length - offset)
					throw new Error('PHP engine exceeds its byte budget');
				const owned = chunk.value.slice();
				bytes.set(owned, offset);
				offset += owned.length;
				controller.enqueue(owned);
			} catch (error) {
				controller.error(error);
			}
		},
		cancel(reason) {
			stopped = true;
			return reader.cancel(reason);
		}
	});
	try {
		// Verification happens before closing the stream. Compilation may overlap
		// transfer, but no caller can instantiate an unverified module.
		if (typeof WebAssembly.compileStreaming === 'function') {
			const module = await WebAssembly.compileStreaming(
				new Response(stream, {
					headers: { 'Content-Type': 'application/wasm' }
				})
			);
			if (!verified) throw new Error('PHP engine stream was not verified');
			return module;
		}
		const drained = stream.getReader();
		try {
			while (!(await drained.read()).done) {
				/* Fill and verify the owned buffer. */
			}
		} finally {
			drained.releaseLock();
		}
		if (!verified) throw new Error('PHP engine stream was not verified');
		return await WebAssembly.compile(bytes);
	} finally {
		stopped = true;
		signal.removeEventListener('abort', abort);
		await reader.cancel().catch(() => {});
		reader.releaseLock();
	}
}

export function createPhpEngineBootstrap(
	assets: Readonly<Record<PhpAsyncMode, PhpEngineAsset>>,
	detectJspi: () => Promise<boolean>,
	timeoutMs = 90_000
) {
	const prepared = new Map<
		PhpAsyncMode,
		Promise<{ mode: PhpAsyncMode; loader: PHPLoaderModule; module: WebAssembly.Module }>
	>();
	let supported: Promise<boolean> | undefined;
	return async (requested: 'auto' | PhpAsyncMode = 'auto') => {
		if (!['auto', 'jspi', 'asyncify'].includes(requested))
			throw new TypeError('Invalid PHP async mode');
		let mode: PhpAsyncMode = 'asyncify';
		if (requested !== 'asyncify') {
			supported ??= Promise.resolve()
				.then(detectJspi)
				.catch((error) => {
					supported = undefined;
					throw error;
				});
			const available = await supported;
			if (requested === 'jspi' && !available)
				throw new Error('PHP JSPI is not supported by this browser');
			if (available) mode = 'jspi';
		}
		const previous = prepared.get(mode);
		if (previous) return await previous;
		const controller = new AbortController();
		const timer = setTimeout(
			() => controller.abort(new Error('PHP engine startup timed out')),
			timeoutMs
		);
		const asset = assets[mode];
		// Attach both observers before either operation can throw or reject.
		const operation = abortable(
			Promise.all([
				Promise.resolve().then(() => asset.load()),
				Promise.resolve().then(() => compileVerifiedEngine(asset, controller.signal))
			]),
			controller.signal
		)
			.then(([loader, module]) => {
				if (
					loader.dependencyFilename !== asset.url ||
					loader.dependenciesTotalSize !== asset.bytes
				)
					throw new Error('PHP loader and pinned Wasm receipt disagree');
				return { mode, loader, module };
			})
			.catch((error) => {
				controller.abort(error);
				if (prepared.get(mode) === operation) prepared.delete(mode);
				throw error;
			})
			.finally(() => clearTimeout(timer));
		prepared.set(mode, operation);
		return await operation;
	};
}
