// @vitest-environment node
import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import { resolveExecutionLimits, createRuntimeAssetsKey } from '@wasm-idle/core';
import {
	preflightPicatRuntimeAssets,
	resolvePicatRuntimeAssetConfig,
	PICAT_RUNTIME_MANIFEST
} from './picatAssets';
import { WASM_PICAT_PROFILE as profile } from './wasmPicatVersion';
import { StaticStdinRingHost } from './staticStdinRing';

const helpers = async () =>
	new Function(
		'self',
		(
			await readFile(
				new URL(
					'../../../scripts/runtime-workers/wasm-picat-runner-worker.js',
					import.meta.url
				),
				'utf8'
			)
		).replace('__WASM_IDLE_PICAT_ASSET_LOCK__', '{}') +
			'\nreturn {boundPicatMemory,workspacePath,createSharedStdinReader,createBufferedStdinReader};'
	)({ postMessage() {} });
describe('Picat official consumer', () => {
	it('pins the official snapshot while recording unavailable producer provenance', () => {
		expect(profile.verifiedBuildInput).toBe(false);
		expect(profile.sourceRevision).toBe('unrecorded');
		expect(profile.upstream['picat.wasm'].sha256).toBe(
			'2e9d503c9e3d4aec33dfc403cb493ec6dc2c132b87ed7d87b2ea059d687b8bff'
		);
		expect(PICAT_RUNTIME_MANIFEST.runtimes[0].capabilities.stdin).toBe('streaming');
	});
	it('relocates one coherent bundle and includes it in runtime cache keys', () => {
		expect(
			resolvePicatRuntimeAssetConfig(
				{ picat: { baseUrl: '/mirror' } },
				'https://example.org/'
			).baseUrl
		).toBe('https://example.org/mirror/');
		expect(
			resolvePicatRuntimeAssetConfig({ rootUrl: '/app' }, 'https://example.org/').baseUrl
		).toBe('https://example.org/app/wasm-picat/');
		expect(createRuntimeAssetsKey({ picat: { baseUrl: '/a' } })).not.toBe(
			createRuntimeAssetsKey({ picat: { baseUrl: '/b' } })
		);
		for (const baseUrl of [
			'file:///tmp',
			'https://user:pass@example.org/',
			'https://example.org/?a=1'
		])
			expect(() =>
				resolvePicatRuntimeAssetConfig({ picat: { baseUrl } }, 'https://example.org')
			).toThrow();
	});
	it('rejects insufficient memory before asset downloads', async () => {
		const fetch = vi.fn();
		await expect(
			preflightPicatRuntimeAssets('https://example.org/', {
				limits: resolveExecutionLimits({ maxWasmMemoryBytes: 32 * 1024 * 1024 }),
				fetch
			})
		).rejects.toMatchObject({ code: 'resource-limit' });
		expect(fetch).not.toHaveBeenCalled();
	});
	it('rejects tampered runtime bytes before evaluation', async () => {
		const fetch = vi.fn(async (url: RequestInfo | URL) => {
			const name = new URL(String(url)).pathname
				.split('/')
				.pop() as keyof typeof profile.storage;
			const res = new Response(new Uint8Array(profile.storage[name].bytes));
			Object.defineProperty(res, 'url', { value: String(url) });
			return res;
		});
		await expect(
			preflightPicatRuntimeAssets('https://example.org/', {
				limits: resolveExecutionLimits(),
				fetch
			})
		).rejects.toMatchObject({ code: 'asset-integrity' });
	});
	it('lowers only the memory section and enforces its ceiling in the engine', async () => {
		const { boundPicatMemory } = await helpers();
		// A valid Wasm memory-only module with the exact reviewed memory declaration.
		const original = Uint8Array.from([
			0, 97, 115, 109, 1, 0, 0, 0, 5, 7, 1, 1, 128, 8, 128, 128, 4, 7, 10, 1, 6, 109, 101,
			109, 111, 114, 121, 2, 0
		]);
		const instance = new WebAssembly.Instance(
			new WebAssembly.Module(boundPicatMemory(original, 64 * 1024 * 1024))
		);
		const memory = instance.exports.memory as WebAssembly.Memory;
		expect(memory.buffer.byteLength).toBe(64 * 1024 * 1024);
		expect(() => memory.grow(1)).toThrow(RangeError);
		expect(() => boundPicatMemory(original, 63 * 1024 * 1024)).toThrow(/at least/);
		const changed = original.slice();
		changed[13] = 7;
		expect(() => boundPicatMemory(changed, 128 * 1024 * 1024)).toThrow(/Unexpected/);
	});
	it('preserves available stdin bytes without waiting for a later line', async () => {
		const { createSharedStdinReader, createBufferedStdinReader, workspacePath } =
			await helpers();
		const ring = new StaticStdinRingHost({ capacity: 32, maxBufferedBytes: 64 });
		ring.enqueue('안녕\n');
		const read = createSharedStdinReader(ring.descriptor),
			buffer = new Uint8Array(1024);
		const spy = vi.spyOn(Atomics, 'wait').mockImplementation(() => {
			throw new Error('Unexpected wait');
		});
		try {
			const count = read.read({ node: {} }, buffer, 0, 1024);
			expect(new TextDecoder().decode(buffer.subarray(0, count))).toBe('안녕\n');
			ring.close();
			expect(read()).toBe(null);
			expect(spy).not.toHaveBeenCalled();
		} finally {
			spy.mockRestore();
			ring.cancel();
		}
		const buffered = createBufferedStdinReader('42\n');
		expect([buffered(), buffered(), buffered(), buffered()]).toEqual([52, 50, 10, null]);
		for (const path of ['../x.pi', '/a.pi', 'a//b', 'a\\b', 'a/./b'])
			expect(() => workspacePath(path)).toThrow();
		expect(workspacePath('lib/data.txt')).toBe('/workspace/lib/data.txt');
	});
});
