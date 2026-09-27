import { TEAVM_RUNTIME_ASSET_RECEIPTS } from '@wasm-idle/core';

// Capture before the worker asset shim installs its buffered fetch adapter.
const nativeFetch = globalThis.fetch?.bind(globalThis);
const compilerReceipt = TEAVM_RUNTIME_ASSET_RECEIPTS['compiler.wasm'];

/** No instance is created until EOF, exact length and SHA-256 have all passed. */
export async function compileVerifiedWasmResponse(
	response: Response,
	receipt: { bytes: number; sha256: string },
	maxAssetBytes: number,
	onProgress?: (loaded: number, total: number) => void
): Promise<WebAssembly.Module> {
	if (!Number.isSafeInteger(maxAssetBytes) || maxAssetBytes < 1 || receipt.bytes > maxAssetBytes ||
		!Number.isSafeInteger(receipt.bytes) || receipt.bytes < 1 || !/^[a-f0-9]{64}$/.test(receipt.sha256)) {
		void response.body?.cancel().catch(() => {});
		throw new Error('Java compiler exceeds its asset limit or has an invalid receipt');
	}
	if (!response.ok || !response.body || !globalThis.crypto?.subtle) {
		void response.body?.cancel().catch(() => {});
		throw new Error('Java compiler streaming requires a successful body and Web Crypto');
	}
	const reader = response.body.getReader();
	const snapshot = new Uint8Array(receipt.bytes);
	let received = 0;
	let released = false;
	const release = () => { if (!released) { released = true; reader.releaseLock(); } };
	const cancel = async (reason?: unknown) => {
		if (released) return;
		try { await reader.cancel(reason); } finally { release(); }
	};
	const body = new ReadableStream<Uint8Array>({
		async pull(controller) {
			try {
				const { done, value } = await reader.read();
				if (done) {
					if (received !== receipt.bytes) throw new Error('Java compiler length mismatch');
					const digest = await crypto.subtle.digest('SHA-256', snapshot);
					const actual = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
					if (actual !== receipt.sha256) throw new Error('Java compiler SHA-256 mismatch');
					release(); controller.close(); return;
				}
				if (received + value.byteLength > receipt.bytes) throw new Error('Java compiler exceeds its receipt byte limit');
				snapshot.set(value, received);
				received += value.byteLength;
				// Own every chunk: mutable producer views cannot change after hashing.
				controller.enqueue(Uint8Array.from(value));
				onProgress?.(received, receipt.bytes);
			} catch (error) {
				controller.error(error);
				await cancel(error).catch(() => {});
			}
		},
		cancel
	});
	try {
		return await (WebAssembly.compileStreaming as (
			response: Response, options: { builtins: string[] }
		) => Promise<WebAssembly.Module>)(
			new Response(body, { headers: { 'Content-Type': 'application/wasm' } }),
			{ builtins: ['js-string'] }
		);
	} catch (error) {
		await cancel(error).catch(() => {});
		throw error;
	}
}

/** Only enabled by the host for the pinned, non-custom-loader TeaVM profile. */
export async function loadStreamingJavaCompiler(baseUrl: string, maxAssetBytes: number) {
	if (typeof WebAssembly.compileStreaming !== 'function' || !globalThis.crypto?.subtle || !nativeFetch) return undefined;
	const url = new URL('compiler.wasm', baseUrl);
	if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash) throw new Error('Invalid Java compiler URL');
	const response = await nativeFetch(url.href, { credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer' });
	if (response.url && new URL(response.url).href !== url.href) {
		void response.body?.cancel().catch(() => {});
		throw new Error('Java compiler response URL mismatch');
	}
	// Static hosts without logical .wasm delivery retain the verified buffered path.
	if (response.status === 404) { void response.body?.cancel().catch(() => {}); return undefined; }
	return await compileVerifiedWasmResponse(response, compilerReceipt, maxAssetBytes, (loaded, total) => {
		globalThis.postMessage?.({ assetProgress: { asset: 'compiler.wasm', loaded, total } });
	});
}

/** Transform only the known verified loader, preserving TeaVM imports and exports. */
export function acceptCompiledTeaVmModule(source: string) {
	const anchor = 'async function b(e,t){if(typeof e!=="string")';
	if (source.split(anchor).length !== 2) throw new Error('Unsupported TeaVM loader for compiled-module input');
	return source.replace(anchor, 'async function b(e,t){if(e instanceof WebAssembly.Module)return e;if(typeof e!=="string")');
}
