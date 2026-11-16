// @vitest-environment node
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import {
	normalizeLanguageId,
	createRuntimeAssetsKey,
	resolveExecutionLimits
} from '@wasm-idle/core';
import { createApplicationRuntimeAssets } from './applicationAssets';
import {
	PARIGP_RUNTIME_MANIFEST,
	preflightPariGpRuntimeAssets,
	resolvePariGpRuntimeAssetConfig
} from './parigpAssets';
import { WASM_PARIGP_PROFILE as profile } from './wasmPariGpVersion';

describe('PARI/GP runtime contract', () => {
	it('pins the actual official wasm32 implementation and relocated assets', () => {
		expect(profile.version).toBe('2.19.0');
		expect(profile.assets['gp.wasm'].sha256).toBe(
			'08e3a86f6ba502660dc094e61aa0ee0251efaff1ee56bdf5296c437d70cedd6e'
		);
		expect(profile.provenance).toContain('not published');
		expect(PARIGP_RUNTIME_MANIFEST.runtimes[0].identity.languageId).toBe('PARIGP');
		expect(normalizeLanguageId('PARI/GP')).toBe('PARIGP');
		expect(normalizeLanguageId('gp')).toBe('PARIGP');
		expect(
			resolvePariGpRuntimeAssetConfig({ rootUrl: '/relocated/' }, 'https://example.com/')
				.baseUrl
		).toBe('https://example.com/relocated/wasm-parigp/');
		expect(createApplicationRuntimeAssets('/demo').parigp?.baseUrl).toBe('/demo/wasm-parigp/');
		expect(createRuntimeAssetsKey({ parigp: { baseUrl: '/a' } })).not.toBe(
			createRuntimeAssetsKey({ parigp: { baseUrl: '/b' } })
		);
	});
	it.each(['file:///tmp/', 'https://user:pass@example.com/', 'https://example.com/?x=1'])(
		'rejects unsafe asset root %s',
		(baseUrl) => {
			expect(() =>
				resolvePariGpRuntimeAssetConfig({ parigp: { baseUrl } }, 'https://example.com/')
			).toThrow();
		}
	);
	it('rejects an impossible memory budget before any download', async () => {
		const fetch = vi.fn();
		await expect(
			preflightPariGpRuntimeAssets('https://example.com/runtime/', {
				limits: resolveExecutionLimits({ maxWasmMemoryBytes: 16 * 1024 * 1024 }),
				fetch
			})
		).rejects.toMatchObject({ code: 'resource-limit' });
		expect(fetch).not.toHaveBeenCalled();
	});
	it('bounds the existing memory section and preserves every other byte', async () => {
		const source = await readFile(
			new URL(
				'../../../scripts/runtime-workers/wasm-parigp-runner-worker.js',
				import.meta.url
			),
			'utf8'
		);
		const boundMemory = runInNewContext(
			source.replace('__WASM_IDLE_PARIGP_ASSET_LOCK__', '{}') + '\nboundMemory;',
			{ self: {}, Uint8Array, TextEncoder, TextDecoder }
		);
		const original = Uint8Array.from([
			0, 97, 115, 109, 1, 0, 0, 0, 5, 7, 1, 1, 137, 3, 128, 128, 2
		]);
		const bounded = boundMemory(original, 32 * 1024 * 1024);
		expect([...bounded.slice(0, 14)]).toEqual([...original.slice(0, 14)]);
		expect([...original.slice(14)]).toEqual([128, 128, 2]);
		const withExport = Uint8Array.from([
			...bounded,
			7,
			10,
			1,
			6,
			109,
			101,
			109,
			111,
			114,
			121,
			2,
			0
		]);
		const instance = await WebAssembly.instantiate(withExport);
		const memory = instance.instance.exports.memory as WebAssembly.Memory;
		expect(memory.buffer.byteLength).toBe(393 * 65536);
		memory.grow(512 - 393);
		expect(() => memory.grow(1)).toThrow(RangeError);
		expect(() => boundMemory(original, 16 * 1024 * 1024)).toThrow(/requires at least/);
		const altered = original.slice();
		altered[12] = 138;
		expect(() => boundMemory(altered, 32 * 1024 * 1024)).toThrow(/declaration changed/);
	});
});
