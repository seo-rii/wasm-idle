import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

import {
	capTinyGoWasmMemory,
	compileTinyGoInDisposableWorker,
	type TinyGoCompileWorkerLike
} from '../src/upstream-worker.ts';

function wasmU32(value: number) {
	const bytes: number[] = [];
	do {
		let byte = value & 0x7f;
		value >>>= 7;
		if (value !== 0) byte |= 0x80;
		bytes.push(byte);
	} while (value !== 0);
	return bytes;
}

function memoryModule(minimumPages = 1) {
	const memory = [1, 0, ...wasmU32(minimumPages)];
	const exports = [1, 6, 109, 101, 109, 111, 114, 121, 2, 0];
	return new Uint8Array([
		0, 97, 115, 109, 1, 0, 0, 0,
		5, ...wasmU32(memory.length), ...memory,
		7, ...wasmU32(exports.length), ...exports
	]);
}

function emptyAssets() {
	const bytes = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]);
	return {
		manifest: {},
		producerReceipt: bytes,
		packageGraphReceipt: bytes,
		compiler: bytes,
		packageGraph: bytes,
		rootArchive: bytes,
		lld: bytes
	};
}

test('caps a defined Wasm memory at an engine-enforced maximum', async () => {
	const capped = capTinyGoWasmMemory(memoryModule(), 2 * 65_536, 'fixture');
	const instance = await WebAssembly.instantiate(capped);
	const memory = instance.instance.exports.memory as WebAssembly.Memory;
	assert.equal(memory.grow(1), 1);
	assert.throws(() => memory.grow(1), /[Mm]aximum memory size|Unable to grow/u);
	assert.throws(
		() => capTinyGoWasmMemory(memoryModule(2), 65_536, 'fixture'),
		/minimum memory/u
	);
});

test('loads Binaryen only when the optimizer phase runs', async () => {
	const source = await readFile(
		new URL('../src/upstream-compile-worker.ts', import.meta.url),
		'utf8'
	);
	assert.doesNotMatch(source, /^import binaryen from 'binaryen';$/mu);
	assert.match(source, /const \{ default: binaryen \} = await import\('binaryen'\);/u);
});

test('terminates the disposable compiler worker when one phase exceeds its deadline', async () => {
	let terminated = 0;
	const worker: TinyGoCompileWorkerLike = {
		onmessage: null,
		onerror: null,
		postMessage() {
			queueMicrotask(() =>
				this.onmessage?.({ data: { type: 'phase', phase: 'compile' } } as MessageEvent)
			);
		},
		terminate() {
			terminated += 1;
		}
	};
	await assert.rejects(
		compileTinyGoInDisposableWorker(
			emptyAssets(),
			{ workspaceFiles: { 'go.mod': 'module example.com/app\n', 'main.go': 'package main\n' } },
			{
				workerFactory: () => worker,
				phaseTimeoutMs: { prepare: 20, graph: 20, validate: 20, compile: 20, link: 20, optimize: 20 },
				maxWasmMemoryBytes: 65_536
			}
		),
		/TinyGo compile phase exceeded 20 ms/u
	);
	assert.equal(terminated, 1);
});

test('returns a successful worker result and always retires the one-shot worker', async () => {
	let terminated = 0;
	const expected = { wasm: new Uint8Array([1, 2, 3]), packageJSON: '{}\n' };
	const worker: TinyGoCompileWorkerLike = {
		onmessage: null,
		onerror: null,
		postMessage() {
			queueMicrotask(() =>
				this.onmessage?.({ data: { type: 'phase', phase: 'graph' } } as MessageEvent)
			);
			queueMicrotask(() =>
				this.onmessage?.({ data: { type: 'result', result: expected } } as MessageEvent)
			);
		},
		terminate() {
			terminated += 1;
		}
	};
	const result = await compileTinyGoInDisposableWorker(
		emptyAssets(),
		{ workspaceFiles: { 'go.mod': 'module example.com/app\n', 'main.go': 'package main\n' } },
		{
			workerFactory: () => worker,
			phaseTimeoutMs: { prepare: 100, graph: 100, validate: 100, compile: 100, link: 100, optimize: 100 },
			maxWasmMemoryBytes: 65_536
		}
	);
	assert.deepEqual(result, expected);
	assert.equal(terminated, 1);
});
