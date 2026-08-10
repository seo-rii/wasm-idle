import { createHash } from 'node:crypto';
import { RUBY_RUNTIME_ASSET_PATH, type RubyRuntimeAssetReceipts } from '@wasm-idle/core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
	loadVerifiedRubyRuntimeAssets,
	snapshotRubyRuntimeAssetConfig,
	type RubyRuntimeAssetConfig
} from './rubyAssets';

const MODULE_URL = 'https://runtime.example/ruby/runtime.mjs?v=profile';
const WASM_URL = `https://runtime.example/ruby/${RUBY_RUNTIME_ASSET_PATH}?v=profile`;
const encoder = new TextEncoder();
const moduleBytes = encoder.encode(
	`const note=${JSON.stringify(RUBY_RUNTIME_ASSET_PATH)};export const rubyStdlibWasmUrl=new URL(${JSON.stringify(RUBY_RUNTIME_ASSET_PATH)},import.meta.url).href;`
);
const wasmBytes = Uint8Array.of(0, 97, 115, 109, 1, 0, 0, 0);
const receipt = (bytes: Uint8Array) => ({
	bytes: bytes.byteLength,
	sha256: createHash('sha256').update(bytes).digest('hex')
});
const integrity = {
	'runtime.mjs': receipt(moduleBytes),
	[RUBY_RUNTIME_ASSET_PATH]: receipt(wasmBytes)
} satisfies RubyRuntimeAssetReceipts;

const config = (overrides: Partial<RubyRuntimeAssetConfig> = {}): RubyRuntimeAssetConfig => ({
	moduleUrl: MODULE_URL,
	wasmUrl: WASM_URL,
	integrity,
	maxAssetBytes: 1_024,
	...overrides
});

const responseFor = (bytes: Uint8Array, url: string) => {
	const response = new Response(Uint8Array.from(bytes).buffer, {
		headers: { 'Content-Length': String(bytes.byteLength) }
	});
	Object.defineProperty(response, 'url', { value: url });
	return response;
};

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe('Ruby runtime asset verification', () => {
	it('snapshots exact receipts, URLs, and limits away from caller-owned objects', () => {
		const callerIntegrity = structuredClone(integrity);
		const snapshot = snapshotRubyRuntimeAssetConfig(
			config({
				moduleUrl: 'https://runtime.example/ruby/./runtime.mjs?v=profile',
				integrity: callerIntegrity
			})
		);
		callerIntegrity['runtime.mjs'].bytes = 1;

		expect(snapshot).toEqual(config());
		expect(snapshot.integrity).not.toBe(callerIntegrity);
		expect(snapshot.integrity['runtime.mjs']).not.toBe(callerIntegrity['runtime.mjs']);
		expect(Object.isFrozen(snapshot)).toBe(true);
		expect(Object.isFrozen(snapshot.integrity)).toBe(true);
		expect(Object.isFrozen(snapshot.integrity['runtime.mjs'])).toBe(true);
	});

	it('captures the caller-owned asset limit exactly once', () => {
		let reads = 0;
		const candidate = {
			moduleUrl: MODULE_URL,
			wasmUrl: WASM_URL,
			integrity,
			get maxAssetBytes() {
				reads += 1;
				return 1_024;
			}
		};

		expect(snapshotRubyRuntimeAssetConfig(candidate).maxAssetBytes).toBe(1_024);
		expect(reads).toBe(1);
	});

	it.each([
		[
			'extra receipt',
			config({
				integrity: { ...integrity, unexpected: receipt(Uint8Array.of(1)) } as never
			})
		],
		['oversized receipt', config({ maxAssetBytes: moduleBytes.byteLength - 1 })],
		[
			'credential URL',
			config({ moduleUrl: 'https://user:secret@runtime.example/runtime.mjs' })
		],
		[
			'encoded separator URL',
			config({ wasmUrl: 'https://runtime.example/ruby/%2fsecret.wasm' })
		],
		['invalid limit', config({ maxAssetBytes: 0 })]
	])('rejects %s before downloading', (_label, candidate) => {
		expect(() => snapshotRubyRuntimeAssetConfig(candidate)).toThrow();
	});

	it('fetches and verifies exactly two assets before rewriting the module graph', async () => {
		const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
			const url = input.toString();
			return responseFor(url === MODULE_URL ? moduleBytes : wasmBytes, url);
		});
		vi.stubGlobal('fetch', fetchMock);

		const loaded = await loadVerifiedRubyRuntimeAssets(config());

		expect(loaded.config).toEqual(config());
		expect(loaded.wasmBytes).toEqual(wasmBytes);
		expect(loaded.moduleSource).toContain(
			`new URL(${JSON.stringify(WASM_URL)},import.meta.url)`
		);
		expect(loaded.moduleSource).toContain(
			`const note=${JSON.stringify(RUBY_RUNTIME_ASSET_PATH)}`
		);
		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([MODULE_URL, WASM_URL]);
		for (const [, init] of fetchMock.mock.calls) {
			expect(init).toMatchObject({
				cache: 'no-store',
				credentials: 'omit',
				redirect: 'error',
				referrerPolicy: 'no-referrer',
				signal: expect.any(AbortSignal)
			});
		}
	});

	it.each(['runtime.mjs', RUBY_RUNTIME_ASSET_PATH] as const)(
		'rejects corrupt %s bytes without returning executable material',
		async (corruptAsset) => {
			vi.stubGlobal(
				'fetch',
				vi.fn(async (input: RequestInfo | URL) => {
					const url = input.toString();
					const asset = url === MODULE_URL ? 'runtime.mjs' : RUBY_RUNTIME_ASSET_PATH;
					const expected = asset === 'runtime.mjs' ? moduleBytes : wasmBytes;
					const bytes =
						asset === corruptAsset
							? Uint8Array.from(expected, (value) => value ^ 1)
							: expected;
					return responseFor(bytes, url);
				})
			);

			await expect(loadVerifiedRubyRuntimeAssets(config())).rejects.toMatchObject({
				code: 'asset-integrity',
				runtimeId: 'RUBY'
			});
		}
	);

	it('aborts the sibling download after the first asset fails verification', async () => {
		let wasmSignal: AbortSignal | undefined;
		vi.stubGlobal(
			'fetch',
			vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
				const url = input.toString();
				if (url === MODULE_URL) {
					return Promise.resolve(responseFor(Uint8Array.of(1), url));
				}
				wasmSignal = init?.signal || undefined;
				return new Promise<Response>(() => undefined);
			})
		);

		await expect(loadVerifiedRubyRuntimeAssets(config())).rejects.toMatchObject({
			code: 'asset-integrity'
		});
		expect(wasmSignal?.aborted).toBe(true);
	});
});
