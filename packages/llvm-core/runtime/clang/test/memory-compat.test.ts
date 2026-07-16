import { afterEach, describe, expect, it, vi } from 'vitest';

import * as coreIndex from '../../core/src/index.js';
import CoreMemFS from '../../core/src/memfs.js';
import CoreMemory from '../../core/src/memory.js';
import coreUntar from '../../core/src/tar.js';
import * as coreWasm from '../../core/src/wasm.js';
import * as clangIndex from '../src/index.js';
import { MemFS, Memory, untar } from '../src/memory/index.js';
import * as clangWasm from '../src/wasm.js';

describe('Clang memory utility compatibility', () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('re-exports the canonical Memory, tar, and wasm loader utilities', () => {
		expect(Memory).toBe(CoreMemory);
		expect(untar).toBe(coreUntar);
		expect(clangWasm.compile).toBe(coreWasm.compile);
		expect(clangWasm.getInstance).toBe(coreWasm.getInstance);
		expect(clangWasm.readBuffer).toBe(coreWasm.readBuffer);
	});

	it('exposes the utilities through the Core and Clang indexes', () => {
		expect(coreIndex.Memory).toBe(CoreMemory);
		expect(coreIndex.MemFS).toBe(CoreMemFS);
		expect(coreIndex.untar).toBe(coreUntar);
		expect(coreIndex.compile).toBe(coreWasm.compile);
		expect(clangIndex.Memory).toBe(CoreMemory);
		expect(clangIndex.MemFS).toBe(MemFS);
		expect(clangIndex.untar).toBe(coreUntar);
		expect(clangIndex.compile).toBe(coreWasm.compile);
	});

	it('keeps the legacy MemFS class and path option compatible with Core MemFS', async () => {
		expect(Object.getPrototypeOf(MemFS.prototype)).toBe(CoreMemFS.prototype);

		const module = {} as WebAssembly.Module;
		const compile = vi.spyOn(coreWasm, 'compile').mockResolvedValue(module);
		vi.spyOn(WebAssembly, 'instantiate').mockResolvedValue({
			exports: {
				init: vi.fn(),
				memory: new WebAssembly.Memory({ initial: 1 })
			}
		} as WebAssembly.Instance);

		const memfs = new MemFS({
			path: 'https://example.test/runtime',
			stdin: () => '',
			stdout: vi.fn()
		});
		await memfs.ready;

		expect(compile).toHaveBeenCalledWith(
			'https://example.test/runtime/bin/memfs.zip',
			undefined
		);
	});
});
