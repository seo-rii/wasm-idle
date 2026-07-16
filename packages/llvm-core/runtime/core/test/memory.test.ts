import { describe, expect, it } from 'vitest';

import Memory from '../src/memory.js';

describe('Memory', () => {
	it('reads and writes numeric, byte, and string values', () => {
		const memory = new Memory(new WebAssembly.Memory({ initial: 1 }));

		memory.write8(0, 0x7f);
		memory.write32(4, 0x89abcdef);
		memory.write64(8, 0x01234567, 0x76543210);
		expect(memory.writeStr(16, 'core')).toBe(5);

		expect(memory.read8(0)).toBe(0x7f);
		expect(memory.read32(4)).toBe(0x89abcdef);
		expect(memory.read32(8)).toBe(0x01234567);
		expect(memory.read32(12)).toBe(0x76543210);
		expect(memory.readStr(16, 4)).toBe('core');
		expect(memory.read8(20)).toBe(0);
	});

	it('refreshes its views after WebAssembly memory grows', () => {
		const wasmMemory = new WebAssembly.Memory({ initial: 1 });
		const memory = new Memory(wasmMemory);
		const originalBuffer = memory.buffer;

		wasmMemory.grow(1);
		expect(originalBuffer.byteLength).toBe(0);

		memory.check();
		memory.write8(65_536, 42);

		expect(memory.buffer).toBe(wasmMemory.buffer);
		expect(memory.read8(65_536)).toBe(42);
	});
});
