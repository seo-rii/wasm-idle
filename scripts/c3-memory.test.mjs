import assert from 'node:assert/strict';
import { test } from 'node:test';
import { c3Digest, limitC3WasmMemory } from './runtime-workers/c3-memory.mjs';

const header = [0, 97, 115, 109, 1, 0, 0, 0];
const PAGE = 65536;
const memoryModule = (minimum = 1, maximum = 8) =>
	Uint8Array.from([
		...header,
		5,
		maximum === null ? 3 : 4,
		1,
		maximum === null ? 0 : 1,
		minimum,
		...(maximum === null ? [] : [maximum]),
		7,
		10,
		1,
		6,
		...Buffer.from('memory'),
		2,
		0
	]);

test('bounds actual memory growth and binds the original and derived bytes to the limit', async () => {
	const original = memoryModule();
	const originalCopy = original.slice();
	const bounded = await limitC3WasmMemory(original, PAGE * 2 + 10);
	const { instance } = await WebAssembly.instantiate(bounded.bytes);
	const memory = instance.exports.memory;
	assert.equal(memory.grow(1), 1);
	assert.throws(() => memory.grow(1), RangeError);
	assert.equal(memory.buffer.byteLength, PAGE * 2);
	assert.deepEqual(original, originalCopy);
	assert.deepEqual(bounded.evidence, {
		originalSha256: await c3Digest(original),
		limitedSha256: await c3Digest(bounded.bytes),
		initialBytes: PAGE,
		maximumBytes: PAGE * 2,
		originalMaximumBytes: PAGE * 8
	});
	assert.notEqual(bounded.evidence.originalSha256, bounded.evidence.limitedSha256);
});

test('adds a maximum to an unbounded defined memory and retains a stricter original maximum', async () => {
	assert.equal(
		(await limitC3WasmMemory(memoryModule(1, null), PAGE * 3)).evidence.maximumBytes,
		PAGE * 3
	);
	assert.equal(
		(await limitC3WasmMemory(memoryModule(1, 2), PAGE * 5)).evidence.maximumBytes,
		PAGE * 2
	);
});

test('rejects initial memory larger than the budget without changing its minimum', async () => {
	await assert.rejects(limitC3WasmMemory(memoryModule(3, 4), PAGE * 2), {
		code: 'resource-limit',
		resource: 'wasm-memory',
		actual: PAGE * 3,
		limit: PAGE * 2
	});
});

test('reports even a sub-page positive limit as an initial-memory resource limit', async () => {
	await assert.rejects(limitC3WasmMemory(memoryModule(), 1), {
		code: 'resource-limit',
		actual: PAGE,
		limit: 1
	});
});

test('rejects ambiguous, imported, shared, memory64 and malformed memory sections', async () => {
	const rejected = [
		Uint8Array.from(header),
		Uint8Array.from([...header, 5, 5, 2, 0, 1, 0, 1]),
		Uint8Array.from([...header, 5, 4, 1, 3, 1, 2]),
		Uint8Array.from([...header, 5, 3, 1, 4, 1]),
		Uint8Array.from([...header, 2, 10, 1, 1, 101, 1, 109, 2, 1, 1, 2]),
		Uint8Array.from([...header, 5, 4, 1, 1, 1]),
		Uint8Array.from([...header, 5, 255, 255, 255, 255, 127])
	];
	for (const bytes of rejected) await assert.rejects(limitC3WasmMemory(bytes, PAGE * 4));
});
