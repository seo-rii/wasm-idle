import {
	RUBY_RUNTIME_ASSET_PATH,
	RUBY_RUNTIME_ASSET_RECEIPTS,
	deriveRubyRuntimeWasmUrl,
	snapshotRubyRuntimeAssetReceipts
} from '@wasm-idle/core';
import { describe, expect, it, vi } from 'vitest';

describe('Core Ruby runtime receipts', () => {
	it('publishes an exact detached and deeply immutable two-asset snapshot', () => {
		const moduleReceipt: { bytes: number; sha256: string } = {
			bytes: RUBY_RUNTIME_ASSET_RECEIPTS['runtime.mjs'].bytes,
			sha256: RUBY_RUNTIME_ASSET_RECEIPTS['runtime.mjs'].sha256
		};
		const wasmReceipt: { bytes: number; sha256: string } = {
			bytes: RUBY_RUNTIME_ASSET_RECEIPTS[RUBY_RUNTIME_ASSET_PATH].bytes,
			sha256: RUBY_RUNTIME_ASSET_RECEIPTS[RUBY_RUNTIME_ASSET_PATH].sha256
		};
		const input = {
			'runtime.mjs': moduleReceipt,
			[RUBY_RUNTIME_ASSET_PATH]: wasmReceipt
		};

		const snapshot = snapshotRubyRuntimeAssetReceipts(input);
		moduleReceipt.bytes = 1;
		wasmReceipt.sha256 = '0'.repeat(64);

		expect(snapshot).toEqual(RUBY_RUNTIME_ASSET_RECEIPTS);
		expect(snapshot).not.toBe(input);
		expect(snapshot['runtime.mjs']).not.toBe(moduleReceipt);
		expect(Object.isFrozen(snapshot)).toBe(true);
		expect(Object.isFrozen(snapshot['runtime.mjs'])).toBe(true);
		expect(Object.isFrozen(snapshot[RUBY_RUNTIME_ASSET_PATH])).toBe(true);
	});

	it('captures each untrusted receipt and field exactly once', () => {
		const moduleReceipt = {
			get bytes() {
				return RUBY_RUNTIME_ASSET_RECEIPTS['runtime.mjs'].bytes;
			},
			get sha256() {
				return RUBY_RUNTIME_ASSET_RECEIPTS['runtime.mjs'].sha256;
			}
		};
		const wasmReceipt = {
			get bytes() {
				return RUBY_RUNTIME_ASSET_RECEIPTS[RUBY_RUNTIME_ASSET_PATH].bytes;
			},
			get sha256() {
				return RUBY_RUNTIME_ASSET_RECEIPTS[RUBY_RUNTIME_ASSET_PATH].sha256;
			}
		};
		const moduleGetter = vi.fn(() => moduleReceipt);
		const wasmGetter = vi.fn(() => wasmReceipt);
		const input = Object.defineProperties(
			{},
			{
				'runtime.mjs': { enumerable: true, get: moduleGetter },
				[RUBY_RUNTIME_ASSET_PATH]: { enumerable: true, get: wasmGetter }
			}
		);
		const moduleBytes = vi.spyOn(moduleReceipt, 'bytes', 'get');
		const moduleSha = vi.spyOn(moduleReceipt, 'sha256', 'get');
		const wasmBytes = vi.spyOn(wasmReceipt, 'bytes', 'get');
		const wasmSha = vi.spyOn(wasmReceipt, 'sha256', 'get');

		expect(snapshotRubyRuntimeAssetReceipts(input)).toEqual(RUBY_RUNTIME_ASSET_RECEIPTS);
		expect(moduleGetter).toHaveBeenCalledOnce();
		expect(wasmGetter).toHaveBeenCalledOnce();
		expect(moduleBytes).toHaveBeenCalledOnce();
		expect(moduleSha).toHaveBeenCalledOnce();
		expect(wasmBytes).toHaveBeenCalledOnce();
		expect(wasmSha).toHaveBeenCalledOnce();
	});

	it.each([
		null,
		{},
		{ ...RUBY_RUNTIME_ASSET_RECEIPTS, extra: { bytes: 1, sha256: 'a'.repeat(64) } },
		{
			...RUBY_RUNTIME_ASSET_RECEIPTS,
			'runtime.mjs': { bytes: 0, sha256: 'a'.repeat(64) }
		},
		{
			...RUBY_RUNTIME_ASSET_RECEIPTS,
			[RUBY_RUNTIME_ASSET_PATH]: { bytes: 1, sha256: 'A'.repeat(64) }
		}
	])('rejects malformed or widened receipt sets', (value) => {
		expect(() => snapshotRubyRuntimeAssetReceipts(value)).toThrow('Ruby runtime');
	});

	it('derives one query-preserving Wasm sibling for absolute and root-relative modules', () => {
		expect(deriveRubyRuntimeWasmUrl('https://cdn.example/runtime/runtime.mjs?v=profile')).toBe(
			`https://cdn.example/runtime/${RUBY_RUNTIME_ASSET_PATH}?v=profile`
		);
		expect(deriveRubyRuntimeWasmUrl('/app/wasm-ruby/runtime.mjs?v=profile')).toBe(
			`/app/wasm-ruby/${RUBY_RUNTIME_ASSET_PATH}?v=profile`
		);
		expect(
			deriveRubyRuntimeWasmUrl(
				'./wasm-ruby/runtime.mjs?v=profile',
				'https://app.example/base/'
			)
		).toBe(`https://app.example/base/wasm-ruby/${RUBY_RUNTIME_ASSET_PATH}?v=profile`);
	});

	it('rejects ambiguous document-relative modules without a resolution context', () => {
		expect(() => deriveRubyRuntimeWasmUrl('wasm-ruby/runtime.mjs')).toThrow(
			'absolute or root-relative'
		);
		expect(() => deriveRubyRuntimeWasmUrl('/wasm-ruby/runtime.mjs#unsafe')).toThrow(
			'must not include a fragment'
		);
	});
});
