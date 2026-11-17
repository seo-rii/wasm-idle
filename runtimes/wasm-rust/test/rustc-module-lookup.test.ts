import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import {
	clearRustcModuleCache,
	createRustcModuleService,
	obtainRustcThroughPort
} from '../src/rustc-module-service.js';

// Initialize Node's HTTP parser before spying on native Wasm compilation.
void new Response();
const empty = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]);
const receipt = { bytes: empty.length, sha256: createHash('sha256').update(empty).digest('hex') };
const services: Array<{ close(): void }> = [];
const service = () => {
	const created = createRustcModuleService(receipt)!;
	services.push(created);
	return created;
};

afterEach(() => {
	for (const current of services.splice(0)) current.close();
	clearRustcModuleCache();
	vi.restoreAllMocks();
});

describe('lookup-first rustc module service', () => {
	it('downloads rustc only until a compiled module is retained', async () => {
		const compile = vi.spyOn(WebAssembly, 'compile');
		const loadBytes = vi.fn(async () => empty.slice());
		const cold = await obtainRustcThroughPort(service().port, loadBytes, 1000);
		expect(cold.reused).toBe(false);
		expect(cold.module).toBeInstanceOf(WebAssembly.Module);
		const warm = await obtainRustcThroughPort(service().port, loadBytes, 1000);
		expect(warm.reused).toBe(true);
		expect(warm.module).toBeInstanceOf(WebAssembly.Module);
		expect(loadBytes).toHaveBeenCalledOnce();
		expect(compile).toHaveBeenCalledOnce();
	});

	it('still verifies the bytes sent after a miss', async () => {
		const altered = empty.slice();
		altered[7] = 1;
		await expect(
			obtainRustcThroughPort(service().port, async () => altered, 1000)
		).rejects.toThrow('integrity');
		// A failed compile retains nothing, so the next worker downloads again.
		const loadBytes = vi.fn(async () => empty.slice());
		expect((await obtainRustcThroughPort(service().port, loadBytes, 1000)).reused).toBe(false);
		expect(loadBytes).toHaveBeenCalledOnce();
	});

	it('compiles locally when an older service rejects the lookup', async () => {
		const channel = new MessageChannel();
		channel.port2.onmessage = (event) => {
			expect(event.data).toEqual({ type: 'lookup' });
			channel.port2.postMessage({
				type: 'error',
				message: 'Invalid runtime Wasm module request'
			});
			channel.port2.close();
		};
		const loadBytes = vi.fn(async () => empty.slice());
		const result = await obtainRustcThroughPort(channel.port1, loadBytes, 1000);
		expect(result.reused).toBe(false);
		expect(result.module).toBeInstanceOf(WebAssembly.Module);
		expect(loadBytes).toHaveBeenCalledOnce();
	});

	it('reports download failures after a miss', async () => {
		await expect(
			obtainRustcThroughPort(
				service().port,
				async () => {
					throw new Error('rustc download failed');
				},
				1000
			)
		).rejects.toThrow('rustc download failed');
	});

	it('times out a service that never answers the lookup', async () => {
		const channel = new MessageChannel();
		await expect(
			obtainRustcThroughPort(channel.port1, async () => empty.slice(), 5)
		).rejects.toThrow('timed out');
		channel.port2.close();
	});
});
