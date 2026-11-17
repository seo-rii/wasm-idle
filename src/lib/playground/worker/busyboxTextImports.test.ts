import { wasi } from '@bjorn3/browser_wasi_shim';
import { describe, expect, it } from 'vitest';
import { createBusyboxTextImports } from './busyboxTextImports';

describe('BusyBox text interpreter imports', () => {
	it('initializes the real root cwd without overwriting adjacent guest bytes', () => {
		const memory = new WebAssembly.Memory({ initial: 1 });
		const bytes = new Uint8Array(memory.buffer);
		bytes.fill(0xaa, 10, 14);
		const host = createBusyboxTextImports(() => memory);
		expect(host.wasm_idle_process_v1.initial_cwd(11, 2)).toBe(2);
		expect(Array.from(bytes.subarray(10, 14))).toEqual([0xaa, 47, 0, 0xaa]);
	});

	it('rejects absent memory, short buffers, out-of-bounds spans and wrapped pointers', () => {
		const memory = new WebAssembly.Memory({ initial: 1 });
		const host = createBusyboxTextImports(() => memory);
		const length = memory.buffer.byteLength;
		for (const [pointer, capacity] of [
			[0, 1],
			[length, 2],
			[length - 1, 2],
			[-1, 2],
			[1, -1]
		]) {
			expect(host.wasm_idle_process_v1.initial_cwd(pointer, capacity)).toBe(-1);
		}
		expect(
			createBusyboxTextImports(() => undefined).wasm_idle_process_v1.initial_cwd(0, 2)
		).toBe(-1);
	});

	it('reports unsupported stored modes rather than inventing POSIX metadata', () => {
		const host = createBusyboxTextImports(() => undefined);
		expect(host.wasm_idle_fs_v1.path_mode()).toBe(-wasi.ERRNO_NOTSUP);
		expect(host.wasm_idle_fs_v1.fd_mode()).toBe(-wasi.ERRNO_NOTSUP);
	});
});
