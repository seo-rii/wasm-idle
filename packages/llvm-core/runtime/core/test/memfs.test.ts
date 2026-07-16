import { beforeEach, describe, expect, it, vi } from 'vitest';

import MemFS from '../src/memfs.js';
import { compile } from '../src/wasm.js';

vi.mock('../src/wasm.js', () => ({
	compile: vi.fn()
}));

describe('MemFS', () => {
	beforeEach(() => {
		vi.mocked(compile).mockReset();
	});

	it('loads and initializes the configured MemFS module', async () => {
		const module = {} as WebAssembly.Module;
		const memory = new WebAssembly.Memory({ initial: 1 });
		const init = vi.fn();
		vi.mocked(compile).mockResolvedValue(module);
		const instantiate = vi.spyOn(WebAssembly, 'instantiate').mockResolvedValue({
			exports: { init, memory }
		} as WebAssembly.Instance);

		const memfs = new MemFS({
			moduleUrl: 'https://example.test/memfs.zip',
			stdin: () => '',
			stdout: vi.fn()
		});
		await memfs.ready;

		expect(compile).toHaveBeenCalledWith('https://example.test/memfs.zip', undefined);
		expect(instantiate).toHaveBeenCalledWith(module, {
			env: expect.objectContaining({
				abort: expect.any(Function),
				copy_in: expect.any(Function),
				copy_out: expect.any(Function),
				host_read: expect.any(Function),
				host_write: expect.any(Function),
				memfs_log: expect.any(Function)
			})
		});
		expect(init).toHaveBeenCalledOnce();
		expect(memfs.mem.memory).toBe(memory);

		instantiate.mockRestore();
	});

	it('replaces an existing file through the JS overlay without adding a duplicate node', async () => {
		const module = {} as WebAssembly.Module;
		const memory = new WebAssembly.Memory({ initial: 1 });
		const addFileNode = vi.fn(() => 1);
		vi.mocked(compile).mockResolvedValue(module);
		const instantiate = vi.spyOn(WebAssembly, 'instantiate').mockResolvedValue({
			exports: {
				init: vi.fn(),
				memory,
				GetPathBuf: vi.fn(() => 0),
				AddFileNode: addFileNode,
				GetFileNodeAddress: vi.fn(() => 128)
			}
		} as unknown as WebAssembly.Instance);
		const memfs = new MemFS({
			moduleUrl: 'https://example.test/memfs.zip',
			stdin: () => '',
			stdout: vi.fn()
		});
		await memfs.ready;

		memfs.addFile('nested/output.wasm', Uint8Array.from([1]));
		memfs.setFile('nested/output.wasm', Uint8Array.from([2, 3, 4]));

		expect(addFileNode).toHaveBeenCalledOnce();
		expect(Array.from(memfs.getFileContents('nested/output.wasm'))).toEqual([2, 3, 4]);

		instantiate.mockRestore();
	});
});
