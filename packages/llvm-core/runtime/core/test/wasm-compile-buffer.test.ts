// @vitest-environment node

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { gzipSync } from 'node:zlib';
import ts from 'typescript';
import { describe, it } from 'vitest';

// A real module exporting answer() -> 42.
const wasm = Uint8Array.of(
	0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 127,
	3, 2, 1, 0, 7, 10, 1, 6, 97, 110, 115, 119, 101, 114, 0, 0,
	10, 6, 1, 4, 0, 65, 42, 11
);
const url = 'https://cdn.test/compile-buffer/tool.wasm';
const source = readFileSync(new URL('../src/wasm.ts', import.meta.url), 'utf8');
const compiledSource = ts.transpileModule(source, {
	compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
}).outputText;

type Loader = typeof import('../src/wasm.js');

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason: unknown) => void;
	const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
	return { promise, resolve, reject };
}

/**
 * Isolate caches and track only explicit copies made by this module, not allocations
 * internal to the engine, Response, or the decompressor. Wasm compilation is native
 * unless a test explicitly injects a delayed/rejected compiler operation.
 */
function createLoader(options: {
	fetch?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
	compile?: (bytes: BufferSource) => Promise<WebAssembly.Module>;
} = {}) {
	const copies: number[] = [];
	const requests: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
	const compileInputs: Uint8Array[] = [];
	const trackedArray = new Proxy(Uint8Array, {
		get(target, key, receiver) {
			if (key !== 'from') return Reflect.get(target, key, receiver);
			return (input: Uint8Array) => {
				copies.push(input.byteLength);
				return Uint8Array.from(input);
			};
		}
	});
	const module = { exports: {} };
	const run = runInNewContext(`(function(exports, require, module) {${compiledSource}\n})`, {
		Uint8Array: trackedArray, ArrayBuffer, URL, Response, Headers, ReadableStream,
		DecompressionStream, TextDecoder, DOMException,
		fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
			requests.push({ input, init });
			return options.fetch ? options.fetch(input, init) : new Response(wasm);
		},
		WebAssembly: {
			compile: (bytes: BufferSource) => {
				compileInputs.push(bytes as Uint8Array);
				return (options.compile ?? WebAssembly.compile)(bytes);
			},
			instantiate: WebAssembly.instantiate
		}
	});
	run(module.exports, (name: string) => {
		throw new Error(`Unexpected dependency in this raw/gzip test: ${name}`);
	}, module);
	return { api: module.exports as Loader, copies, requests, compileInputs };
}

async function answer(module: WebAssembly.Module) {
	const instance = await WebAssembly.instantiate(module);
	return (instance.exports.answer as () => number)();
}

describe('Wasm compilation buffer ownership', () => {
	it('compiles real Wasm without an explicit full-buffer clone', async () => {
		const { api, copies, requests, compileInputs } = createLoader();
		assert.equal(await answer(await api.compile(url)), 42);
		assert.deepEqual(copies, []);
		assert.equal(requests.length, 1);
		assert.equal(compileInputs[0].byteLength, wasm.byteLength);
		// The network reader uses a larger backing allocation; compile the view, not its tail.
		assert(compileInputs[0].buffer.byteLength > wasm.byteLength);
		assert.deepEqual(compileInputs[0], wasm);
	});

	it('also avoids the clone when a caller signal disables shared caches', async () => {
		const { api, copies, requests } = createLoader();
		const controller = new AbortController();
		assert.equal(await answer(await api.compile(url, undefined, controller.signal)), 42);
		assert.deepEqual(copies, []);
		assert.equal(requests[0].init?.signal, controller.signal);
	});

	it('compiles gzip assets without cloning their decompressed payload', async () => {
		const { api, copies } = createLoader({ fetch: async () => new Response(gzipSync(wasm)) });
		assert.equal(await answer(await api.compile(`${url}.gz`)), 42);
		assert.deepEqual(copies, []);
	});

	it('accepts already-decoded gzip delivery without adding a clone', async () => {
		const { api, copies } = createLoader();
		assert.equal(await answer(await api.compile(`${url}.gz`)), 42);
		assert.deepEqual(copies, []);
	});

	it('keeps independent mutable copies for every public buffer read', async () => {
		const { api, copies, requests } = createLoader();
		const first = await api.readBuffer(url);
		const second = await api.readBuffer(url);
		assert.notEqual(first.buffer, second.buffer);
		first.fill(0);
		assert.deepEqual(second, wasm);
		assert.equal(await answer(await api.compile(url)), 42);
		assert.deepEqual(copies, [wasm.length, wasm.length]);
		assert.equal(requests.length, 1);
	});

	it('does not expose cached bytes through a transferred public buffer', async () => {
		const { api, requests } = createLoader();
		const owned = await api.readBuffer(url);
		structuredClone(owned.buffer, { transfer: [owned.buffer] });
		assert.equal(owned.byteLength, 0);
		assert.equal(await answer(await api.compile(url)), 42);
		assert.deepEqual(await api.readBuffer(url), wasm);
		assert.equal(requests.length, 1);
	});

	it('shares one download with concurrent readers but only clones their public results', async () => {
		const download = deferred<Response>();
		const { api, copies, requests } = createLoader({ fetch: () => download.promise });
		const compiling = api.compile(url);
		const reading = api.readBuffer(url);
		download.resolve(new Response(wasm));
		const [module, publicBytes] = await Promise.all([compiling, reading]);
		publicBytes.fill(0);
		assert.equal(await answer(module), 42);
		assert.deepEqual(copies, [wasm.length]);
		assert.equal(requests.length, 1);
	});

	it('keeps compiled-module caching and in-flight deduplication unchanged', async () => {
		const { api, copies, requests, compileInputs } = createLoader();
		const [first, second] = await Promise.all([api.compile(url), api.compile(url)]);
		assert.equal(first, second);
		assert.equal(await api.compile(url), first);
		assert.equal(compileInputs.length, 1);
		assert.equal(requests.length, 1);
		assert.deepEqual(copies, []);
	});

	it('retries compilation failures without poisoning the cached source', async () => {
		let calls = 0;
		const reason = new Error('transient compiler failure');
		const { api, copies, requests } = createLoader({
			compile: async (bytes) => {
				if (++calls === 1) throw reason;
				return WebAssembly.compile(bytes);
			}
		});
		await assert.rejects(api.compile(url), (error) => error === reason);
		assert.equal(await answer(await api.compile(url)), 42);
		assert.deepEqual(copies, []);
		assert.equal(requests.length, 1);
	});

	it('rejects real malformed Wasm without publishing a successful module cache entry', async () => {
		const { api, compileInputs } = createLoader({ fetch: async () => new Response(Uint8Array.of(0, 1, 2)) });
		await assert.rejects(api.compile(url), WebAssembly.CompileError);
		await assert.rejects(api.compile(url), WebAssembly.CompileError);
		assert.equal(compileInputs.length, 2);
	});

	it('preserves limits even when a module is cached under a larger budget', async () => {
		const { api, compileInputs } = createLoader();
		await api.compile(url, undefined, undefined, 1024);
		await assert.rejects(api.compile(url, undefined, undefined, wasm.length - 1), /byte limit/);
		assert.equal(compileInputs.length, 1);
	});

	it('rejects decoded gzip overflow before invoking the compiler', async () => {
		const large = new Uint8Array(4096);
		const compressed = gzipSync(large);
		assert(compressed.length < 128);
		const { api, compileInputs } = createLoader({ fetch: async () => new Response(compressed) });
		await assert.rejects(api.compile(`${url}.gz`, undefined, undefined, 128), /byte limit/);
		assert.equal(compileInputs.length, 0);
	});

	it('preserves pre-abort reasons and does not fetch', async () => {
		const { api, requests, compileInputs } = createLoader();
		const controller = new AbortController();
		const reason = new Error('stop before startup');
		controller.abort(reason);
		await assert.rejects(api.compile(url, undefined, controller.signal), (error) => error === reason);
		assert.equal(requests.length, 0);
		assert.equal(compileInputs.length, 0);
	});

	it('does not cache a compilation result after its caller cancels', async () => {
		const started = deferred<void>();
		const nativeResult = deferred<WebAssembly.Module>();
		let delay = true;
		const { api, copies, requests } = createLoader({
			compile: (bytes) => {
				if (!delay) return WebAssembly.compile(bytes);
				started.resolve();
				return nativeResult.promise;
			}
		});
		const controller = new AbortController();
		const pending = api.compile(url, undefined, controller.signal);
		const reason = new Error('cancel compilation');
		const rejected = assert.rejects(pending, (error) => error === reason);
		await started.promise;
		controller.abort(reason);
		await rejected;
		nativeResult.resolve(await WebAssembly.compile(wasm));
		delay = false;
		assert.equal(await answer(await api.compile(url)), 42);
		assert.equal(requests.length, 2);
		assert.deepEqual(copies, []);
	});

	it('does not export the borrowed-buffer helper', () => {
		const { api } = createLoader();
		assert.equal('readBufferInternal' in api, false);
		assert.equal(typeof api.readBuffer, 'function');
	});
});
