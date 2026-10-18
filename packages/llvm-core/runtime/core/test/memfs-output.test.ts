import { afterEach, describe, expect, it, vi } from 'vitest';
import MemFS from '../src/memfs.js';
import Memory from '../src/memory.js';
import { compile } from '../src/wasm.js';
import App from '../../clang/src/app.js';
import { ProcExit } from '../src/error.js';

vi.mock('../src/wasm.js', () => ({ compile: vi.fn() }));
afterEach(() => vi.restoreAllMocks());

async function createOutputHarness() {
	vi.mocked(compile).mockResolvedValue({} as WebAssembly.Module);
	vi.spyOn(WebAssembly, 'instantiate').mockResolvedValue({
		exports: {
			init: vi.fn(),
			memory: new WebAssembly.Memory({ initial: 1 }),
			fd_close: () => 0
		}
	} as unknown as WebAssembly.Instance);
	const stdout = vi.fn();
	const memfs = new MemFS({ moduleUrl: 'memfs.wasm', stdin: () => '', stdout });
	await memfs.ready;
	const memory = new Memory(new WebAssembly.Memory({ initial: 1 }));
	memfs.hostMem = memory;
	const write = (fd: number, ...parts: number[][]) => {
		let address = 128;
		for (const [index, bytes] of parts.entries()) {
			memory.write32(index * 8, address);
			memory.write32(index * 8 + 4, bytes.length);
			memory.write(address, Uint8Array.from(bytes));
			address += bytes.length;
		}
		expect(memfs.host_write(fd, 0, parts.length, 64)).toBe(0);
		expect(memory.read32(64)).toBe(parts.reduce((size, bytes) => size + bytes.length, 0));
	};
	const app = Object.assign(Object.create(App.prototype), {
		ready: Promise.resolve(),
		argv: ['test.wasm'],
		memfs,
		trace: vi.fn(),
		syntheticFileHandles: new Set(),
		readFileHandles: new Map(),
		writeFileHandles: new Map(),
		exports: { _start: () => {} }
	}) as App;
	return {
		memfs,
		memory,
		write,
		app,
		stdout,
		output: () => stdout.mock.calls.map(([text]) => text).join('')
	};
}

describe('MemFS stdout/stderr byte streams', () => {
	it('preserves NUL bytes and the suffix of an explicit-length write', async () => {
		const h = await createOutputHarness();
		h.write(1, [65, 0, 66, 10]);
		expect(h.output()).toBe('A\0B\n');
	});

	it('retains UTF-8 state across iovecs and writes', async () => {
		const h = await createOutputHarness();
		h.write(1, [0xea], [0xb0]);
		expect(h.output()).toBe('');
		h.write(1, [0x80, 10]);
		expect(h.output()).toBe('가\n');
	});

	it('keeps stdout and stderr decoder states independent', async () => {
		const h = await createOutputHarness();
		h.write(1, [0xea]);
		h.write(2, [0xeb, 0x82]);
		h.write(1, [0xb0, 0x80]);
		h.write(2, [0x98]);
		expect(h.output()).toBe('가나');
	});

	it('flushes only the closed stream and resets that decoder', async () => {
		const h = await createOutputHarness();
		h.write(1, [0xea]);
		h.write(2, [0xeb, 0x82]);
		expect(h.app.fd_close(1)).toBe(0);
		expect(h.output()).toBe('�');
		h.write(2, [0x98]);
		h.write(1, [65]);
		expect(h.output()).toBe('�나A');
	});

	it.each(['return', 'exit', 'trap'] as const)(
		'flushes pending output on guest %s',
		async (outcome) => {
			const h = await createOutputHarness();
			h.app.exports._start = () => {
				h.write(1, [0xea]);
				if (outcome === 'exit') throw new ProcExit(0);
				if (outcome === 'trap') throw new Error('guest trap');
			};
			if (outcome === 'trap') await expect(h.app.run()).rejects.toThrow('guest trap');
			else await h.app.run();
			expect(h.stdout.mock.calls[0]?.[0]).toBe('�');
			h.write(1, [65]);
			expect(h.output().endsWith('A')).toBe(true);
		}
	);

	it('discards a previous guest decoder when host memory is replaced', async () => {
		const h = await createOutputHarness();
		h.write(1, [0xea]);
		h.memfs.hostMem = h.memory;
		h.write(1, [65]);
		expect(h.output()).toBe('A');
	});

	it('does not carry suppressed output into a later visible run', async () => {
		const h = await createOutputHarness();
		h.memfs.out = false;
		h.app.exports._start = () => h.write(1, [0xea]);
		await h.app.run();
		h.memfs.out = true;
		h.write(1, [65]);
		expect(h.output()).toBe('A');
	});

	it('keeps a live rAF guest stream open after its start function exits', async () => {
		const h = await createOutputHarness();
		h.app.exports._start = () => {
			h.write(1, [0xea]);
			expect(h.output()).toBe('');
			throw new ProcExit(0xc0c0a);
		};
		expect(await h.app.run()).toBe(true);
		expect(h.output()).toBe('');
		h.write(1, [0xb0, 0x80]);
		expect(h.output()).toBe('가');
	});
});
