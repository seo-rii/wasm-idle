import { describe, expect, it } from 'vitest';
import wabt from 'wabt';

import { assertGoInstanceMemoryLimit, capGoWasmMemory } from '../src/wasm-memory.js';

async function compileWat(source: string) {
	const wabtApi = await wabt();
	const parsed = wabtApi.parseWat('memory.wat', source);
	return new Uint8Array(parsed.toBinary({}).buffer);
}

describe('Go WebAssembly memory boundary', () => {
	it('adds a physical maximum and floors non-page-aligned byte limits', async () => {
		const bytes = await compileWat('(module (memory (export "memory") 1))');
		const capped = capGoWasmMemory(bytes, 2 * 65_536 + 17, 'Go test');
		const { instance } = await WebAssembly.instantiate(capped.slice().buffer as ArrayBuffer);
		const memory = instance.exports.memory as WebAssembly.Memory;

		expect(memory.grow(1)).toBe(1);
		expect(() => memory.grow(1)).toThrow(RangeError);
	});

	it('rejects modules whose declared minimum already exceeds the cap', async () => {
		const bytes = await compileWat('(module (memory (export "memory") 3))');

		expect(() => capGoWasmMemory(bytes, 2 * 65_536, 'Go test')).toThrow(
			/minimum memory .* exceeds the hard limit/
		);
	});

	it('fails closed for imported memories that cannot be rewritten', async () => {
		const bytes = await compileWat('(module (import "env" "memory" (memory 1)))');

		expect(() => capGoWasmMemory(bytes, 2 * 65_536, 'Go test')).toThrow(
			/imports memory and cannot receive an engine-enforced cap/
		);
	});

	it('checks actual exported memory at the instantiated boundary', async () => {
		const bytes = await compileWat('(module (memory (export "memory") 2 2))');
		const { instance } = await WebAssembly.instantiate(bytes.slice().buffer as ArrayBuffer);

		expect(() => assertGoInstanceMemoryLimit(instance, 65_536, 'Go test')).toThrow(
			/memory 131072 exceeds the hard limit 65536/
		);
	});
});
