/** Native modules only: every PHP instance receives new memory and filesystem state. */
export interface PhpWasmAsset {
	url: string;
	bytes: number;
	sha256: string;
}
const MAX_WASM_BYTES = 64 * 1024 * 1024;
const modules = new Map<string, Promise<WebAssembly.Module>>();
export function clearPhpModuleCache() {
	modules.clear();
}

async function compileVerifiedAsset(asset: PhpWasmAsset): Promise<WebAssembly.Module> {
	const controller = new AbortController();
	let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
	try {
		const response = await fetch(asset.url, {
			credentials: 'same-origin',
			signal: controller.signal
		});
		if (!response.ok || !response.body)
			throw new Error(`PHP Wasm fetch failed: ${response.status}`);
		const bytes = new Uint8Array(asset.bytes);
		let offset = 0;
		reader = response.body.getReader();
		let resolveBytes!: () => void;
		let rejectBytes!: (error: unknown) => void;
		const complete = new Promise<void>((resolve, reject) => {
			resolveBytes = resolve;
			rejectBytes = reject;
		});
		// Observe rejection even if compileStreaming throws synchronously.
		void complete.catch(() => {});
		const stream = new ReadableStream<Uint8Array>({
			async pull(output) {
				try {
					const part = await reader!.read();
					if (part.done) {
						if (offset !== asset.bytes)
							throw new Error('PHP Wasm byte length mismatch');
						resolveBytes();
						output.close();
						return;
					}
					if (offset + part.value.byteLength > asset.bytes)
						throw new Error('PHP Wasm byte limit exceeded');
					bytes.set(part.value, offset);
					offset += part.value.byteLength;
					output.enqueue(part.value);
				} catch (error) {
					rejectBytes(error);
					output.error(error);
				}
			},
			cancel(reason) {
				rejectBytes(reason ?? new Error('PHP Wasm compilation cancelled'));
				return reader!.cancel(reason);
			}
		});
		const verify = async () => {
			await complete;
			const digest = await crypto.subtle.digest('SHA-256', bytes);
			const hash = Array.from(new Uint8Array(digest), (x) =>
				x.toString(16).padStart(2, '0')
			).join('');
			if (hash !== asset.sha256) throw new Error('PHP Wasm SHA-256 mismatch');
		};
		if (typeof WebAssembly.compileStreaming === 'function') {
			const [module] = await Promise.all([
				WebAssembly.compileStreaming(
					new Response(stream, { headers: { 'Content-Type': 'application/wasm' } })
				),
				verify()
			]);
			return module;
		}
		// The compatibility path preserves the same byte budget and receipt check.
		const drain = stream.getReader();
		try {
			while (!(await drain.read()).done) {
				/* Bounded snapshot already filled. */
			}
		} finally {
			drain.releaseLock();
		}
		await verify();
		return await WebAssembly.compile(bytes);
	} finally {
		controller.abort();
		if (reader) {
			try {
				void reader.cancel().catch(() => {});
			} catch {
				/* Preserve the primary failure. */
			}
			try {
				reader.releaseLock();
			} catch {
				/* A failed native stream may be releasing it. */
			}
		}
	}
}

export function loadPhpModule(asset: PhpWasmAsset): Promise<WebAssembly.Module> {
	if (
		!Number.isSafeInteger(asset.bytes) ||
		asset.bytes < 8 ||
		asset.bytes > MAX_WASM_BYTES ||
		!/^[a-f0-9]{64}$/.test(asset.sha256)
	) {
		return Promise.reject(new Error('Invalid pinned PHP Wasm receipt'));
	}
	if (!globalThis.crypto?.subtle)
		return Promise.reject(
			new Error('PHP startup requires Web Crypto for integrity verification')
		);
	const key = `php-default-compile-v1:${asset.bytes}:${asset.sha256}`;
	let pending = modules.get(key);
	if (pending) {
		modules.delete(key);
		modules.set(key, pending);
		return pending;
	}
	pending = compileVerifiedAsset({ ...asset });
	modules.set(key, pending);
	const operation = pending;
	void operation.catch(() => {
		if (modules.get(key) === operation) modules.delete(key);
	});
	while (modules.size > 2) modules.delete(modules.keys().next().value!);
	return pending;
}
