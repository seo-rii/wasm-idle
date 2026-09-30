import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { preflightDebugRuntimeAssets } from '../src/manifest.js';
import type { RuntimeManifestV2 } from '../src/types.js';

const state = vi.hoisted(() => ({
	bytes: new Map<string, Uint8Array>(),
	reads: vi.fn(),
	writes: vi.fn()
}));
vi.mock('@wasm-idle/core', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@wasm-idle/core')>();
	return {
		...actual,
		readPersistentRuntimeAsset: async (request: any) => {
			state.reads(request);
			if (!actual.resolveRuntimeAssetCacheOptions(request.cache).enabled) return undefined;
			return state.bytes.get(`${request.identity.url}:${request.identity.sha256}`)?.slice();
		},
		writePersistentRuntimeAsset: async (request: any) => {
			state.writes(request);
			if (!actual.resolveRuntimeAssetCacheOptions(request.cache).enabled) return false;
			state.bytes.set(
				`${request.identity.url}:${request.identity.sha256}`,
				request.bytes.slice()
			);
			return true;
		}
	};
});
const bytes = new TextEncoder().encode('verified debug bytes');
const sha256 = createHash('sha256').update(bytes).digest('hex');
const manifest = {
	debugger: {
		lldb: {
			js: 'debug/lldb.js',
			wasm: 'debug/lldb.wasm',
			worker: 'debug/lldb.worker.js',
			jsSha256: sha256,
			wasmSha256: sha256,
			workerSha256: sha256
		},
		targetRuntime: {
			js: 'debug/wamr.js',
			wasm: 'debug/wamr.wasm',
			worker: 'debug/wamr.worker.js',
			jsSha256: sha256,
			wasmSha256: sha256,
			workerSha256: sha256
		}
	}
} as RuntimeManifestV2;
beforeEach(() => {
	state.bytes.clear();
	state.reads.mockClear();
	state.writes.mockClear();
});
afterEach(() => vi.restoreAllMocks());
describe('debug runtime persistent asset integration', () => {
	it('reuses all verified debugger and target bytes across sessions without shared mutable buffers', async () => {
		const fetch = vi.fn(async () => new Response(bytes));
		const first = await preflightDebugRuntimeAssets(
			manifest,
			'https://assets.example/debug/',
			fetch
		);
		new Uint8Array(first.lldb.wasm).fill(0);
		const second = await preflightDebugRuntimeAssets(
			manifest,
			'https://assets.example/debug/',
			fetch
		);
		expect(fetch).toHaveBeenCalledTimes(6);
		expect(new Uint8Array(second.lldb.wasm)).toEqual(bytes);
		expect(new Uint8Array(second.targetRuntime.wasm)).toEqual(bytes);
	});
	it('bypasses stored assets with per-call false and preserves configurable budgets', async () => {
		const fetch = vi.fn(async () => new Response(bytes));
		await preflightDebugRuntimeAssets(
			manifest,
			'https://assets.example/debug/',
			fetch,
			undefined,
			{ maxBytes: 4096 }
		);
		await preflightDebugRuntimeAssets(
			manifest,
			'https://assets.example/debug/',
			fetch,
			undefined,
			false
		);
		expect(fetch).toHaveBeenCalledTimes(12);
		expect(state.reads.mock.calls[0][0].cache.maxBytes).toBe(4096);
		expect(state.reads.mock.calls[6][0].cache.enabled).toBe(false);
	});
	it('does not publish integrity failures and checks abort before cache reads', async () => {
		const fetch = vi.fn(async () => new Response('wrong'));
		await expect(
			preflightDebugRuntimeAssets(manifest, 'https://assets.example/debug/', fetch)
		).rejects.toThrow('SHA-256 mismatch');
		expect(state.writes).not.toHaveBeenCalled();
		state.reads.mockClear();
		const controller = new AbortController();
		controller.abort(new Error('cancelled'));
		await expect(
			preflightDebugRuntimeAssets(
				manifest,
				'https://assets.example/debug/',
				fetch,
				controller.signal
			)
		).rejects.toThrow('cancelled');
		expect(state.reads).not.toHaveBeenCalled();
	});
});
