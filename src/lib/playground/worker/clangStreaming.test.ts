import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ compile: vi.fn() }));
vi.mock('@wasm-idle/llvm-core/core/verified-wasm', () => ({
	compileVerifiedWasmAsset: mocks.compile
}));
import type { BrowserClangRuntime } from '@wasm-idle/llvm-core/clang';
import { withVerifiedStreaming } from './clangStreaming';
import { BUNDLED_CLANG_ASSET_INTEGRITY } from '../clangAssetIntegrity';
import { shouldStreamBundledClang } from '../clangStreamingPolicy';
const fallback = vi.fn(
	async (..._args: unknown[]) => new WebAssembly.Module(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]))
);
class FakeRuntime {
	async getModule(...args: unknown[]) {
		return fallback(...args);
	}
}
const create = () =>
	new (withVerifiedStreaming(
		FakeRuntime as unknown as typeof BrowserClangRuntime,
		'https://cdn.test/clang/',
		64 * 1024 * 1024
	))({ runtimeBaseUrl: 'https://cdn.test/clang/' });
beforeEach(() => {
	mocks.compile.mockReset();
	fallback.mockClear();
});
afterEach(() => vi.unstubAllGlobals());
describe('bundled Clang streaming routing', () => {
	it('enables only the built-in profile without a custom loader', () => {
		expect(shouldStreamBundledClang({ integrity: BUNDLED_CLANG_ASSET_INTEGRITY })).toBe(true);
		expect(
			shouldStreamBundledClang({ integrity: BUNDLED_CLANG_ASSET_INTEGRITY, loader: () => {} })
		).toBe(false);
		expect(shouldStreamBundledClang({ integrity: { ...BUNDLED_CLANG_ASSET_INTEGRITY } })).toBe(
			false
		);
		expect(shouldStreamBundledClang({})).toBe(false);
		expect(
			shouldStreamBundledClang({
				integrity: BUNDLED_CLANG_ASSET_INTEGRITY,
				allowedBaseUrls: ['https://custom.test/']
			})
		).toBe(false);
	});
	it('compiles each of the two exact tools once and reuses their modules', async () => {
		const module = await WebAssembly.compile(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]));
		mocks.compile.mockResolvedValue(module);
		const runtime = create();
		for (const name of ['clang', 'lld']) {
			const url = `https://cdn.test/clang/bin/${name}.wasm.gz`;
			const [a, b] = await Promise.all([runtime.getModule(url), runtime.getModule(url)]);
			expect(a).toBe(b);
			expect(mocks.compile).toHaveBeenCalledWith(
				url,
				BUNDLED_CLANG_ASSET_INTEGRITY[`bin/${name}.wasm.gz` as 'bin/clang.wasm.gz'],
				expect.objectContaining({ maxAssetBytes: 64 * 1024 * 1024 })
			);
		}
		expect(mocks.compile).toHaveBeenCalledTimes(2);
		expect(fallback).not.toHaveBeenCalled();
	});
	it('retains the base loader for other assets and non-canonical tool URLs', async () => {
		const runtime = create();
		for (const url of [
			'https://cdn.test/clang/bin/memfs.wasm.gz',
			'https://other.test/clang/bin/clang.wasm.gz',
			'https://cdn.test/clang/bin/clang.wasm.gz?v=custom'
		])
			await runtime.getModule(url);
		expect(fallback).toHaveBeenCalledTimes(3);
		expect(mocks.compile).not.toHaveBeenCalled();
	});
	it('does not downgrade failed verification and retries a later load', async () => {
		mocks.compile.mockRejectedValueOnce(new Error('bad hash')).mockResolvedValueOnce('module');
		const runtime = create(),
			url = 'https://cdn.test/clang/bin/clang.wasm.gz';
		await expect(runtime.getModule(url)).rejects.toThrow('bad hash');
		expect(await runtime.getModule(url)).toBe('module');
		expect(fallback).not.toHaveBeenCalled();
	});
	it('does not share cancellation or modules across runtime constructions', async () => {
		mocks.compile.mockResolvedValue('module');
		const a = create(),
			b = create(),
			url = 'https://cdn.test/clang/bin/lld.wasm.gz';
		await a.getModule(url);
		await b.getModule(url);
		expect(mocks.compile).toHaveBeenCalledTimes(2);
		const c = new AbortController();
		c.abort();
		await expect(a.getModule(url, undefined, c.signal)).rejects.toThrow();
	});
	it('retains the base runtime on unsupported environments', () => {
		vi.stubGlobal('DecompressionStream', undefined);
		expect(
			withVerifiedStreaming(
				FakeRuntime as unknown as typeof BrowserClangRuntime,
				'https://cdn.test/clang/'
			)
		).toBe(FakeRuntime);
	});
});
