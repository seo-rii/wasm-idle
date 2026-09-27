// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { compileVerifiedWasmResponse, acceptCompiledTeaVmModule } from './javaStreaming';

const bytes = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]);
const receipt = (value = bytes) => ({
	bytes: value.length,
	sha256: createHash('sha256').update(value).digest('hex')
});
const response = (value = bytes) => new Response(value.slice().buffer);

describe('verified Java compiler streaming', () => {
	it('compiles a real valid Wasm stream with progress', async () => {
		const progress = vi.fn();
		const module = await compileVerifiedWasmResponse(response(), receipt(), 100, progress);
		expect(await WebAssembly.instantiate(module)).toBeInstanceOf(WebAssembly.Instance);
		expect(progress).toHaveBeenCalledWith(8, 8);
	});
	it('does not resolve compilation before final digest validation', async () => {
		let close!: () => void;
		const stream = new ReadableStream<Uint8Array>({
			start(c) {
				c.enqueue(bytes);
				close = () => c.close();
			}
		});
		let resolved = false;
		const pending = compileVerifiedWasmResponse(new Response(stream), receipt(), 100).then(
			(m) => {
				resolved = true;
				return m;
			}
		);
		await new Promise((r) => setTimeout(r, 20));
		expect(resolved).toBe(false);
		close();
		expect(await pending).toBeInstanceOf(WebAssembly.Module);
	});
	it('rejects wrong SHA even when the native module is valid', async () => {
		await expect(
			compileVerifiedWasmResponse(response(), { ...receipt(), sha256: '0'.repeat(64) }, 100)
		).rejects.toThrow('SHA-256');
	});
	it('rejects short and overlong responses', async () => {
		await expect(
			compileVerifiedWasmResponse(response(), { ...receipt(), bytes: 9 }, 100)
		).rejects.toThrow('length mismatch');
		await expect(
			compileVerifiedWasmResponse(response(), { ...receipt(), bytes: 7 }, 100)
		).rejects.toThrow('byte limit');
	});
	it('rejects receipts beyond the caller asset limit before reading', async () => {
		const cancel = vi.fn();
		const stream = new ReadableStream({ cancel });
		await expect(
			compileVerifiedWasmResponse(new Response(stream), receipt(), 7)
		).rejects.toThrow('asset limit');
		expect(cancel).toHaveBeenCalledTimes(1);
	});
	it('observes transport failure without a compiled result', async () => {
		const stream = new ReadableStream({
			start(c) {
				c.error(new Error('network failure'));
			}
		});
		await expect(
			compileVerifiedWasmResponse(new Response(stream), receipt(), 100)
		).rejects.toThrow('network failure');
	});
	it('cancels the source when native streaming compilation rejects early', async () => {
		const cancel = vi.fn();
		const stream = new ReadableStream<Uint8Array>({ cancel });
		const failure = new Error('native compilation failed');
		const compileStreaming = vi
			.spyOn(WebAssembly, 'compileStreaming')
			.mockRejectedValue(failure);
		try {
			await expect(
				compileVerifiedWasmResponse(new Response(stream), receipt(), 100)
			).rejects.toBe(failure);
			expect(cancel).toHaveBeenCalledTimes(1);
		} finally {
			compileStreaming.mockRestore();
		}
	});
	it('propagates invalid Wasm instead of falling back to an unchecked loader', async () => {
		const invalid = new Uint8Array(8);
		await expect(
			compileVerifiedWasmResponse(response(invalid), receipt(invalid), 100)
		).rejects.toThrow();
	});
	it('handles nonzero-offset producer views exactly', async () => {
		const storage = new Uint8Array(20);
		storage.set(bytes, 4);
		const stream = new ReadableStream<Uint8Array>({
			start(c) {
				c.enqueue(storage.subarray(4, 12));
				c.close();
			}
		});
		expect(
			await compileVerifiedWasmResponse(new Response(stream), receipt(), 100)
		).toBeInstanceOf(WebAssembly.Module);
	});
	it('rejects unsuccessful responses', async () => {
		await expect(
			compileVerifiedWasmResponse(new Response('no', { status: 500 }), receipt(), 100)
		).rejects.toThrow('successful body');
	});
	it('transforms only one exact known loader anchor', () => {
		const anchor = 'async function b(e,t){if(typeof e!=="string")';
		expect(acceptCompiledTeaVmModule(anchor)).toContain('e instanceof WebAssembly.Module');
		expect(() => acceptCompiledTeaVmModule('changed')).toThrow('Unsupported');
		expect(() => acceptCompiledTeaVmModule(anchor + anchor)).toThrow('Unsupported');
	});
	it('pins the streaming optimization to the complete bundled profile and keeps custom loaders', () => {
		const host = readFileSync(new URL('../java.ts', import.meta.url), 'utf8');
		expect(host).toContain('!assetConfig.loader');
		expect(host).toContain('TEAVM_RUNTIME_ASSET_NAMES.every');
		expect(host).toContain('receipt.bytes === expected.bytes');
		expect(host).toContain('receipt.sha256 === expected.sha256');
	});
});
