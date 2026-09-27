import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import {
	clearPhpModuleCache,
	loadPhpModule,
	type PhpWasmAsset
} from '../../producers/wasm-php/src/startup-loader';

const command = new Uint8Array([
	0, 97, 115, 109, 1, 0, 0, 0, 1, 4, 1, 96, 0, 0, 3, 2, 1, 0, 5, 3, 1, 0, 1, 7, 19, 2, 6, 109,
	101, 109, 111, 114, 121, 2, 0, 6, 95, 115, 116, 97, 114, 116, 0, 0, 10, 4, 1, 2, 0, 11
]);
function asset(bytes = command): PhpWasmAsset {
	return {
		url: 'https://example.test/php.wasm',
		bytes: bytes.length,
		sha256: createHash('sha256').update(bytes).digest('hex')
	};
}
function response(bytes = command) {
	return new Response(Uint8Array.from(bytes).buffer);
}
function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((yes) => (resolve = yes));
	return { promise, resolve };
}
afterEach(() => {
	clearPhpModuleCache();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe('verified PHP startup modules', () => {
	it('fetches, streams and compiles a real native module', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => response())
		);
		const stream = vi.spyOn(WebAssembly, 'compileStreaming');
		const instantiate = vi.spyOn(WebAssembly, 'instantiate');
		const module = await loadPhpModule(asset());
		expect(module).toBeInstanceOf(WebAssembly.Module);
		expect(stream).toHaveBeenCalledTimes(1);
		expect(instantiate).not.toHaveBeenCalled();
		const instance = await WebAssembly.instantiate(module);
		expect((instance.exports.memory as WebAssembly.Memory).buffer.byteLength).toBe(65536);
	});
	it('starts compiling before the body finishes, but does not resolve before validation', async () => {
		const gate = deferred<void>();
		let sent = false;
		const body = new ReadableStream<Uint8Array>({
			async pull(c) {
				if (!sent) {
					sent = true;
					c.enqueue(command.slice(0, 8));
				} else {
					await gate.promise;
					c.enqueue(command.slice(8));
					c.close();
				}
			}
		});
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response(body))
		);
		const stream = vi.spyOn(WebAssembly, 'compileStreaming');
		let resolved = false;
		const pending = loadPhpModule(asset()).then((value) => {
			resolved = true;
			return value;
		});
		await vi.waitFor(() => expect(stream).toHaveBeenCalledTimes(1));
		expect(resolved).toBe(false);
		gate.resolve();
		expect(await pending).toBeInstanceOf(WebAssembly.Module);
	});
	it('rejects a valid but wrong module before it can be instantiated or cached', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => response())
		);
		const a = { ...asset(), sha256: '0'.repeat(64) };
		await expect(loadPhpModule(a)).rejects.toThrow('SHA-256');
		await expect(loadPhpModule(a)).rejects.toThrow('SHA-256');
		expect(fetch).toHaveBeenCalledTimes(2);
	});
	it.each([command.slice(0, -1), new Uint8Array([...command, 0])])(
		'rejects an incorrect logical byte count',
		async (bytes) => {
			vi.stubGlobal(
				'fetch',
				vi.fn(async () => response(bytes))
			);
			await expect(loadPhpModule(asset())).rejects.toThrow(/byte (length|limit)/);
		}
	);
	it('rejects a streaming network failure and retries', async () => {
		const fetcher = vi
			.fn()
			.mockResolvedValueOnce(
				new Response(
					new ReadableStream({
						pull(c) {
							c.error(new Error('connection reset'));
						}
					})
				)
			)
			.mockResolvedValueOnce(response());
		vi.stubGlobal('fetch', fetcher);
		await expect(loadPhpModule(asset())).rejects.toThrow('connection reset');
		expect(await loadPhpModule(asset())).toBeInstanceOf(WebAssembly.Module);
	});
	it('retries HTTP failure without keeping a rejected promise', async () => {
		vi.stubGlobal(
			'fetch',
			vi
				.fn()
				.mockResolvedValueOnce(new Response(null, { status: 503 }))
				.mockResolvedValueOnce(response())
		);
		await expect(loadPhpModule(asset())).rejects.toThrow('503');
		expect(await loadPhpModule(asset())).toBeInstanceOf(WebAssembly.Module);
	});
	it('deduplicates concurrent and sequential initialization but never shares instances', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => response())
		);
		const [a, b] = await Promise.all([loadPhpModule(asset()), loadPhpModule(asset())]);
		expect(a).toBe(b);
		expect(await loadPhpModule(asset())).toBe(a);
		expect(fetch).toHaveBeenCalledTimes(1);
		const left = await WebAssembly.instantiate(a),
			right = await WebAssembly.instantiate(b);
		new Uint8Array((left.exports.memory as WebAssembly.Memory).buffer)[0] = 33;
		expect(new Uint8Array((right.exports.memory as WebAssembly.Memory).buffer)[0]).toBe(0);
	});
	it('does not use a URL as the cache key and bounds retention to two modules', async () => {
		const variants = [65, 66, 67].map((n) => new Uint8Array([...command, 0, 2, 1, n]));
		const byHash = new Map(variants.map((bytes) => [asset(bytes).sha256, bytes]));
		vi.stubGlobal(
			'fetch',
			vi.fn(async (url: string) => response(byHash.get(url)!))
		);
		const receipts = variants.map((bytes) => ({ ...asset(bytes), url: asset(bytes).sha256 }));
		await loadPhpModule(receipts[0]);
		await loadPhpModule(receipts[1]);
		await loadPhpModule(receipts[0]);
		await loadPhpModule(receipts[2]);
		await loadPhpModule(receipts[0]);
		expect(fetch).toHaveBeenCalledTimes(3);
		await loadPhpModule(receipts[1]);
		expect(fetch).toHaveBeenCalledTimes(4);
	});
	it('supports browsers without streaming compilation without skipping checksum validation', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => response())
		);
		vi.spyOn(WebAssembly, 'compileStreaming', 'get').mockReturnValue(undefined as any);
		expect(await loadPhpModule(asset())).toBeInstanceOf(WebAssembly.Module);
		await expect(loadPhpModule({ ...asset(), sha256: '0'.repeat(64) })).rejects.toThrow(
			'SHA-256'
		);
	});
	it('rejects invalid receipts and missing crypto before network I/O', async () => {
		vi.stubGlobal('fetch', vi.fn());
		for (const bytes of [0, -1, 1.5, 65 * 1024 * 1024])
			await expect(loadPhpModule({ ...asset(), bytes })).rejects.toThrow('receipt');
		vi.stubGlobal('crypto', undefined);
		await expect(loadPhpModule(asset())).rejects.toThrow('Web Crypto');
		expect(fetch).not.toHaveBeenCalled();
	});
	it('does not suppress native compilation errors', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => response())
		);
		vi.spyOn(WebAssembly, 'compileStreaming').mockRejectedValueOnce(
			new Error('native compile failure')
		);
		await expect(loadPhpModule(asset())).rejects.toThrow('native compile failure');
		expect(await loadPhpModule(asset())).toBeInstanceOf(WebAssembly.Module);
	});
});
