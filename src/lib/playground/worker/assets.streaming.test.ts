// @vitest-environment node

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getEventListeners } from 'node:events';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { createContext, runInContext } from 'node:vm';
import { gzipSync } from 'node:zlib';
import * as ts from 'typescript';
import { describe, it } from 'vitest';

const baseUrl = 'https://assets.example.test/python/';
const wasmUrl = `${baseUrl}pyodide.asm.wasm`;
// A real Wasm module exporting answer() -> 42, not a mocked compilation result.
const wasm = new Uint8Array([
	0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 127,
	3, 2, 1, 0, 7, 10, 1, 6, 97, 110, 115, 119, 101, 114, 0, 0,
	10, 6, 1, 4, 0, 65, 42, 11
]);

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason: unknown) => void;
	const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
	return { promise, resolve, reject };
}

async function bounded<T>(promise: Promise<T>): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			promise,
			new Promise<never>((_, reject) => {
				timer = setTimeout(() => reject(new Error('operation did not settle')), 1000);
			})
		]);
	} finally {
		clearTimeout(timer);
	}
}

/** Isolate worker globals while using native Response, streams and Wasm APIs. */
function createWorker(
	fetchImpl: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
	maxAssetBytes = 1024,
	useAssetBridge = false
) {
	const messages: any[] = [];
	const calls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
	const context = createContext({
		URL, Request, Response, Headers, Blob, ReadableStream, Uint8Array, ArrayBuffer,
		TextEncoder, TextDecoder, DOMException, AbortController,
		postMessage: (message: unknown) => messages.push(message),
		fetch: (input: RequestInfo | URL, init?: RequestInit) => {
			calls.push([input, init]);
			return fetchImpl(input, init);
		},
		XMLHttpRequest: undefined
	});
	context.self = context;
	const modules = new Map<string, any>();
	const load = (name: string): any => {
		if (modules.has(name)) return modules.get(name);
		const source = readFileSync(new URL(`./${name}.ts`, import.meta.url), 'utf8');
		const compiled = ts.transpileModule(source, {
			compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
		}).outputText;
		const module = { exports: {} };
		runInContext(`(function(exports, require, module) {${compiled}\n})`, context)(
			module.exports,
			(specifier: string) => {
				assert.equal(specifier, './boundedAssetResponse');
				return load('boundedAssetResponse');
			},
			module
		);
		modules.set(name, module.exports);
		return module.exports;
	};
	const api = load('assets');
	api.configureWorkerRuntimeAssets({ baseUrl, maxAssetBytes, useAssetBridge });
	return { api, fetch: context.fetch as typeof fetch, messages, calls, load };
}

function response(body: BodyInit | null, headers: Record<string, string> = {}) {
	return new Response(body, { headers: { 'Content-Type': 'application/wasm', ...headers } });
}

function controlledSource() {
	let controller!: ReadableStreamDefaultController<Uint8Array>;
	const cancellations: unknown[] = [];
	const body = new ReadableStream<Uint8Array>({
		start(value) { controller = value; },
		cancel(reason) { cancellations.push(reason); }
	}, { highWaterMark: 0 });
	return { body, cancellations, get controller() { return controller; } };
}

const progress = (messages: any[]) => messages.filter((message) => message.assetProgress);

describe('direct Wasm response streaming', () => {
	it('returns headers and the first chunk without waiting for the remaining download', async () => {
		const source = controlledSource();
		const worker = createWorker(async () => response(source.body));
		const result = await bounded(worker.fetch(wasmUrl));
		assert.equal(result.headers.get('content-type'), 'application/wasm');
		assert.equal(progress(worker.messages).length, 0);
		const reader = result.body!.getReader();
		source.controller.enqueue(wasm.subarray(0, 8));
		assert.deepEqual((await bounded(reader.read())).value, wasm.subarray(0, 8));
		assert.equal(progress(worker.messages).length, 1);
		source.controller.enqueue(wasm.subarray(8));
		source.controller.close();
		assert.deepEqual((await reader.read()).value, wasm.subarray(8));
		assert.equal((await reader.read()).done, true);
		assert.equal(source.body.locked, false);
		assert.equal(progress(worker.messages).at(-1).assetProgress.loaded, wasm.length);
	});

	it('does not pull ahead while the consumer is idle', async () => {
		let pulls = 0;
		const body = new ReadableStream<Uint8Array>({
			pull(controller) { pulls++; controller.enqueue(new Uint8Array([1])); }
		}, { highWaterMark: 0 });
		const worker = createWorker(async () => response(body));
		const result = await worker.fetch(wasmUrl);
		await Promise.resolve();
		assert.equal(pulls, 0);
		const reader = result.body!.getReader();
		await reader.read();
		await Promise.resolve();
		assert.equal(pulls, 1);
		await reader.cancel();
		assert.equal(body.locked, false);
	});

	it('compiles and executes real Wasm through the intercepted fetch', async () => {
		const source = controlledSource();
		const worker = createWorker(async () => response(source.body));
		const result = await bounded(worker.fetch(wasmUrl));
		const compiling = WebAssembly.compileStreaming(result);
		source.controller.enqueue(wasm.subarray(0, 8));
		source.controller.enqueue(wasm.subarray(8));
		source.controller.close();
		const instance = await WebAssembly.instantiate(await bounded(compiling));
		assert.equal((instance.exports.answer as () => number)(), 42);
	});

	it('bounds gzip-decoded bytes and does not reuse transport encoding headers', async () => {
		const decoded = response(gzipSync(wasm)).body!.pipeThrough(new DecompressionStream('gzip'));
		const worker = createWorker(async () => response(decoded, {
			'Content-Encoding': 'gzip', 'Content-Length': '2'
		}), wasm.length);
		const result = await worker.fetch(wasmUrl);
		assert.equal(result.headers.get('content-encoding'), null);
		assert.equal(result.headers.get('content-length'), null);
		const instance = await WebAssembly.instantiate(await WebAssembly.compileStreaming(result));
		assert.equal((instance.exports.answer as () => number)(), 42);
	});

	for (const contentLength of [undefined, '1', '0']) {
		it(`rejects decoded overflow before forwarding it (Content-Length=${contentLength})`, async () => {
			const source = controlledSource();
			const headers: Record<string, string> =
				contentLength === undefined ? {} : { 'Content-Length': contentLength };
			const worker = createWorker(async () => response(source.body, headers), 4);
			const reader = (await worker.fetch(wasmUrl)).body!.getReader();
			source.controller.enqueue(new Uint8Array(3));
			assert.equal((await reader.read()).value!.length, 3);
			source.controller.enqueue(new Uint8Array(2));
			await assert.rejects(reader.read(), /exceeds the 4 byte limit/);
			assert.equal(source.cancellations.length, 1);
			assert.equal(source.body.locked, false);
			assert.equal(progress(worker.messages).length, 1);
		});
	}

	it('rejects an oversized declared length before exposing a response', async () => {
		const source = controlledSource();
		const worker = createWorker(async () => response(source.body, { 'Content-Length': '5' }), 4);
		await assert.rejects(worker.fetch(wasmUrl), /exceeds the 4 byte limit/);
		assert.equal(source.cancellations.length, 1);
		assert.equal(progress(worker.messages).length, 0);
	});

	for (const length of ['abc', '-1', '9007199254740992']) {
		it(`rejects invalid declared length ${length}`, async () => {
			const source = controlledSource();
			const worker = createWorker(async () => response(source.body, { 'Content-Length': length }));
			await assert.rejects(worker.fetch(wasmUrl), /invalid Content-Length/);
			assert.equal(source.cancellations.length, 1);
		});
	}

	it('does not report completion when the network stream fails', async () => {
		const source = controlledSource();
		const worker = createWorker(async () => response(source.body));
		const result = await worker.fetch(wasmUrl);
		const reading = result.arrayBuffer();
		source.controller.error(new Error('network interrupted'));
		await assert.rejects(bounded(reading), /network interrupted/);
		assert.equal(source.body.locked, false);
		assert.equal(progress(worker.messages).length, 0);
	});

	it('cancels a pending body read promptly on AbortSignal', async () => {
		const source = controlledSource();
		const controller = new AbortController();
		const worker = createWorker(async () => response(source.body));
		const result = await worker.fetch(wasmUrl, { signal: controller.signal });
		const reading = result.arrayBuffer();
		const reason = new Error('cancel loading');
		controller.abort(reason);
		await assert.rejects(bounded(reading), (error) => error === reason);
		assert.equal(source.cancellations.length, 1);
		assert.equal(source.cancellations[0], reason);
		assert.equal(source.body.locked, false);
		assert.equal(progress(worker.messages).length, 0);
	});

	it('propagates consumer cancellation upstream', async () => {
		const source = controlledSource();
		const worker = createWorker(async () => response(source.body));
		const result = await worker.fetch(wasmUrl);
		await bounded(result.body!.cancel('consumer done'));
		assert.deepEqual(source.cancellations, ['consumer done']);
		assert.equal(source.body.locked, false);
		assert.equal(progress(worker.messages).length, 0);
	});

	for (const mode of ['throws', 'rejects', 'hangs']) {
		it(`does not block abort when upstream cancellation ${mode}`, async () => {
			let releases = 0;
			let cancels = 0;
			const pending = deferred<ReadableStreamReadResult<Uint8Array>>();
			const native = {
				ok: true, status: 200, headers: new Headers({ 'Content-Type': 'application/wasm' }),
				body: { getReader: () => ({
					read: () => pending.promise,
					releaseLock: () => { releases++; },
					cancel: () => {
						cancels++;
						if (mode === 'throws') throw new Error('cancel failed');
						if (mode === 'rejects') return Promise.reject(new Error('cancel failed'));
						return new Promise(() => {});
					}
				}) }
			} as unknown as Response;
			const controller = new AbortController();
			const worker = createWorker(async () => native);
			const result = await worker.fetch(wasmUrl, { signal: controller.signal });
			const reading = result.arrayBuffer();
			controller.abort(new Error('original abort'));
			await assert.rejects(bounded(reading), /original abort/);
			pending.resolve({ done: false, value: wasm });
			await Promise.resolve();
			assert.equal(releases, 1);
			assert.equal(cancels, 1);
			assert.equal(progress(worker.messages).length, 0);
		});
	}

	it('rejects already-aborted requests without starting native fetch', async () => {
		const controller = new AbortController();
		controller.abort(new Error('already stopped'));
		const worker = createWorker(async () => response(wasm));
		await assert.rejects(worker.fetch(wasmUrl, { signal: controller.signal }), /already stopped/);
		assert.equal(worker.calls.length, 0);
	});

	it('cancels a response arriving after its request was aborted', async () => {
		const pending = deferred<Response>();
		const controller = new AbortController();
		const source = controlledSource();
		const worker = createWorker(async () => pending.promise);
		const loading = worker.fetch(wasmUrl, { signal: controller.signal });
		controller.abort(new Error('late response'));
		pending.resolve(response(source.body));
		await assert.rejects(loading, /late response/);
		assert.equal(source.cancellations.length, 1);
	});

	it('preserves Request integrity and signal with least-authority network options', async () => {
		const worker = createWorker(async () => response(wasm));
		const request = new Request(wasmUrl, { integrity: 'sha256-test', signal: new AbortController().signal });
		const result = await worker.fetch(request);
		assert.deepEqual({ ...worker.calls[0][1] }, {
			credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer',
			integrity: 'sha256-test', signal: request.signal
		});
		await result.arrayBuffer();
	});

	it('honors an explicit null signal and integrity override on Request input', async () => {
		const controller = new AbortController();
		controller.abort();
		const request = new Request(wasmUrl, { signal: controller.signal, integrity: 'sha256-test' });
		const worker = createWorker(async () => response(wasm));
		await (await worker.fetch(request, { signal: null, integrity: '' })).arrayBuffer();
		assert.equal(worker.calls[0][1]?.signal, undefined);
		assert.equal(worker.calls[0][1]?.integrity, undefined);
	});

	it('rejects substituted final URLs and HTTP failures', async () => {
		for (const substitute of [false, true]) {
			const source = controlledSource();
			const native = new Response(source.body, { status: substitute ? 200 : 503 });
			if (substitute) Object.defineProperty(native, 'url', { value: 'https://other.test/tool.wasm' });
			const worker = createWorker(async () => native);
			await assert.rejects(worker.fetch(wasmUrl), substitute ? /URL mismatch/ : /503/);
			assert.equal(source.cancellations.length, 1);
		}
	});

	it('keeps allowlists authoritative even when runtime and package bases overlap', async () => {
		const worker = createWorker(async () => response(wasm));
		worker.api.configureWorkerRuntimeAssetAllowlist({
			baseUrl, assets: ['demo.whl'], runtimeAssets: ['pyodide.asm.wasm']
		});
		await (await worker.fetch(wasmUrl)).arrayBuffer();
		await assert.rejects(worker.fetch(`${baseUrl}unlisted.wasm`), /Untracked runtime asset/);
		assert.equal(worker.calls.length, 1);
	});

	it('does not bypass the host bridge or return bytes before its reply', async () => {
		const worker = createWorker(async () => { throw new Error('native fetch not allowed'); }, 1024, true);
		let settled = false;
		const loading = worker.fetch(wasmUrl).then((value) => { settled = true; return value; });
		await Promise.resolve();
		assert.equal(settled, false);
		const request = worker.messages.find((message) => message.assetRequest).assetRequest;
		assert.equal(request.asset, 'pyodide.asm.wasm');
		worker.api.handleWorkerAssetMessage({ assetResponse: {
			id: request.id, ok: true, bytes: wasm.slice().buffer, mimeType: 'application/wasm'
		} });
		assert.deepEqual(new Uint8Array(await (await loading).arrayBuffer()), wasm);
		assert.equal(worker.calls.length, 0);
	});

	it('preserves buffered loadWorkerRuntimeAsset and archive fetch failure timing', async () => {
		for (const archive of [false, true]) {
			const worker = createWorker(async () => response(new Uint8Array(5)), 4);
			const loading = archive ? worker.fetch(`${baseUrl}demo.whl`) : worker.api.loadWorkerRuntimeAsset('pyodide.asm.wasm');
			await assert.rejects(loading, /exceeds the 4 byte limit/);
		}
	});

	it('rejects malformed Wasm rather than retrying an unbounded download', async () => {
		const worker = createWorker(async () => response(new Uint8Array([0, 1, 2, 3])));
		await assert.rejects(WebAssembly.compileStreaming(worker.fetch(wasmUrl)));
		assert.equal(worker.calls.length, 1);
	});

	it('handles a bounded body-less fallback and rejects oversized materialization', async () => {
		for (const maxAssetBytes of [4, 64]) {
			const worker = createWorker(async () => ({
				ok: true, status: 200, body: null, headers: new Headers(),
				arrayBuffer: async () => wasm.slice().buffer
			}) as Response, maxAssetBytes);
			if (maxAssetBytes === 4) await assert.rejects(worker.fetch(wasmUrl), /exceeds/);
			else assert.deepEqual(new Uint8Array(await (await worker.fetch(wasmUrl)).arrayBuffer()), wasm);
		}
	});
});


describe('stream cleanup and native fetch integration', () => {
	it('removes abort listeners after successful EOF and after cancellation', async () => {
		for (const cancel of [false, true]) {
			const controller = new AbortController();
			const worker = createWorker(async () => response(wasm));
			const result = await worker.fetch(wasmUrl, { signal: controller.signal });
			assert.equal(getEventListeners(controller.signal, 'abort').length, 1);
			if (cancel) await result.body!.cancel();
			else await result.arrayBuffer();
			assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
		}
	});

	it('rejects a stalled body-less fallback promptly when aborted', async () => {
		const pending = deferred<ArrayBuffer>();
		const controller = new AbortController();
		const worker = createWorker(async () => ({
			ok: true, status: 200, body: null, headers: new Headers(),
			arrayBuffer: () => pending.promise
		}) as Response);
		const loading = worker.fetch(wasmUrl, { signal: controller.signal });
		await Promise.resolve();
		await Promise.resolve();
		controller.abort(new Error('fallback stopped'));
		await assert.rejects(bounded(loading), /fallback stopped/);
		pending.resolve(wasm.slice().buffer);
		assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
		assert.equal(progress(worker.messages).length, 0);
	});

	it('retains the original request byte budget after configuration changes', async () => {
		const source = controlledSource();
		const worker = createWorker(async () => response(source.body), 4);
		const result = await worker.fetch(wasmUrl);
		worker.api.configureWorkerRuntimeAssets({ baseUrl, maxAssetBytes: 100, useAssetBridge: false });
		source.controller.enqueue(new Uint8Array(5));
		await assert.rejects(result.arrayBuffer(), /exceeds the 4 byte limit/);
	});

	it('rejects Wasm streaming compilation on late size overflow', async () => {
		const source = controlledSource();
		const worker = createWorker(async () => response(source.body), 8);
		const result = await worker.fetch(wasmUrl);
		const compiling = WebAssembly.compileStreaming(result);
		source.controller.enqueue(wasm.subarray(0, 8));
		source.controller.enqueue(wasm.subarray(8));
		await assert.rejects(bounded(compiling), /exceeds the 8 byte limit/);
		assert.equal(source.cancellations.length, 1);
	});

	it('counts every chunk partition consistently at and above the limit', async () => {
		const worker = createWorker(async () => response(null));
		const { createBoundedAssetResponse } = worker.load('boundedAssetResponse');
		for (let split = 0; split <= wasm.length; split++) {
			for (const limit of [wasm.length - 1, wasm.length]) {
				const source = controlledSource();
				const result = await createBoundedAssetResponse(response(source.body), {
					asset: 'test.wasm', maxAssetBytes: limit
				});
				source.controller.enqueue(wasm.subarray(0, split));
				source.controller.enqueue(wasm.subarray(split));
				source.controller.close();
				if (limit < wasm.length) await assert.rejects(result.arrayBuffer(), /exceeds/);
				else assert.deepEqual(new Uint8Array(await result.arrayBuffer()), wasm);
			}
		}
	});

	it('preserves a normal EOF release failure instead of reporting success', async () => {
		const worker = createWorker(async () => ({
			ok: true, status: 200, headers: new Headers(),
			body: { getReader: () => ({
				read: async () => ({ done: true }), cancel: async () => undefined,
				releaseLock: () => { throw new Error('release failed'); }
			}) }
		}) as unknown as Response);
		await assert.rejects((await worker.fetch(wasmUrl)).arrayBuffer(), /release failed/);
		assert.equal(progress(worker.messages).length, 0);
	});

	it('does not let a release failure hide the original size violation', async () => {
		const worker = createWorker(async () => ({
			ok: true, status: 200, headers: new Headers(),
			body: { getReader: () => ({
				read: async () => ({ done: false, value: wasm }), cancel: async () => undefined,
				releaseLock: () => { throw new Error('release failed'); }
			}) }
		}) as unknown as Response, 4);
		await assert.rejects((await worker.fetch(wasmUrl)).arrayBuffer(), /exceeds the 4 byte limit/);
	});

	it('keeps actual native SRI verification and streaming Wasm execution working', async () => {
		const server = createServer((_request, output) => {
			output.writeHead(200, { 'Content-Type': 'application/wasm' });
			output.end(wasm);
		});
		await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
		try {
			const address = server.address();
			assert(address && typeof address !== 'string');
			const localBaseUrl = `http://127.0.0.1:${address.port}/`;
			const worker = createWorker(fetch);
			worker.api.configureWorkerRuntimeAssets({ baseUrl: localBaseUrl, maxAssetBytes: 1024, useAssetBridge: false });
			const integrity = `sha256-${createHash('sha256').update(wasm).digest('base64')}`;
			const { instance } = await WebAssembly.instantiateStreaming(worker.fetch(`${localBaseUrl}test.wasm`, { integrity }));
			assert.equal((instance.exports.answer as () => number)(), 42);
			await assert.rejects(worker.fetch(`${localBaseUrl}test.wasm`, { integrity: `sha256-${Buffer.alloc(32).toString('base64')}` }));
		} finally {
			server.closeAllConnections();
			await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
		}
	});
});
