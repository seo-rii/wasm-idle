// @vitest-environment node

import { strict as assert } from 'node:assert';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { beforeEach, describe, it, vi } from 'vitest';

const startup = vi.hoisted(() => ({
	memfsReady: Promise.resolve(),
	memfsOptions: [] as Array<{ signal?: AbortSignal; maxAssetBytes?: number }>,
	compile: vi.fn(),
	readBuffer: vi.fn(),
	untar: vi.fn(),
	installHeaders: vi.fn(),
	installCompatibility: vi.fn()
}));

vi.mock('../../core/src/wasm.js', () => ({
	DEFAULT_MAX_DECOMPRESSED_ASSET_BYTES: 128 * 1024 * 1024,
	compile: startup.compile,
	readBuffer: startup.readBuffer
}));
vi.mock('../../core/src/memfs.js', () => ({
	default: class MockMemFS {
		ready = startup.memfsReady;

		constructor(options: { signal?: AbortSignal; maxAssetBytes?: number }) {
			startup.memfsOptions.push(options);
		}
	}
}));
vi.mock('../../core/src/tar.js', () => ({ default: startup.untar }));
vi.mock('../../core/src/clang-resource-headers.js', () => ({
	installClangResourceHeaders: startup.installHeaders
}));
vi.mock('../../core/src/gcc-compat.js', () => ({
	installGccCompatibilityHeaders: startup.installCompatibility
}));

import Clang from '../src/runtime.js';

const runtimeBaseUrl = 'https://cdn.test/clang/';
const sysrootUrl = `${runtimeBaseUrl}bin/sysroot.tar.gz`;
const archive = new Uint8Array([1, 2, 3]);

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason: unknown) => void;
	const promise = new Promise<T>((yes, no) => {
		resolve = yes;
		reject = no;
	});
	return { promise, resolve, reject };
}

function observe(promise: Promise<unknown>) {
	const state = { settled: false, error: undefined as unknown };
	void promise.then(
		() => {
			state.settled = true;
		},
		(error) => {
			state.settled = true;
			state.error = error;
		}
	);
	return state;
}

function assertNotInstalled() {
	assert.equal(startup.untar.mock.calls.length, 0);
	assert.equal(startup.installHeaders.mock.calls.length, 0);
	assert.equal(startup.installCompatibility.mock.calls.length, 0);
}

describe('Clang parallel sysroot startup', () => {
	beforeEach(() => {
		startup.memfsReady = Promise.resolve();
		startup.memfsOptions.length = 0;
		startup.compile.mockReset().mockResolvedValue({});
		startup.readBuffer.mockReset().mockResolvedValue(archive);
		startup.untar.mockReset();
		startup.installHeaders.mockReset();
		startup.installCompatibility.mockReset();
	});

	it('starts exactly one sysroot download before MemFS is ready', async () => {
		const filesystem = deferred<void>();
		startup.memfsReady = filesystem.promise;
		const runtime = new Clang({ runtimeBaseUrl });
		const state = observe(runtime.ready);

		assert.equal(startup.readBuffer.mock.calls.length, 1);
		assert.deepEqual(startup.readBuffer.mock.calls[0], [sysrootUrl, undefined, 128 * 1024 * 1024]);
		await nextTurn();
		assertNotInstalled();
		assert.equal(state.settled, false);

		filesystem.resolve();
		await runtime.ready;
		assert.equal(startup.readBuffer.mock.calls.length, 1);
		assert.equal(startup.untar.mock.calls.length, 1);
		assert.equal(startup.untar.mock.calls[0][0], archive);
		assert.equal(startup.untar.mock.calls[0][1], runtime.memfs);
		assert.equal(startup.installHeaders.mock.calls.length, 1);
		assert.equal(startup.installCompatibility.mock.calls.length, 1);
	});

	it('does not install files when MemFS finishes before the download', async () => {
		const download = deferred<Uint8Array>();
		startup.readBuffer.mockReturnValue(download.promise);
		const runtime = new Clang({ runtimeBaseUrl });
		const state = observe(runtime.ready);
		await nextTurn();
		assertNotInstalled();
		assert.equal(state.settled, false);
		download.resolve(archive);
		await runtime.ready;
		assert.equal(startup.untar.mock.calls.length, 1);
	});

	it('still waits for the compiler after the filesystem is prepared', async () => {
		const compiler = deferred<WebAssembly.Module>();
		startup.compile.mockImplementation((url: string) =>
			url.endsWith('/clang.wasm.gz') ? compiler.promise : Promise.resolve({})
		);
		const runtime = new Clang({ runtimeBaseUrl });
		const state = observe(runtime.ready);
		await nextTurn();
		assert.equal(startup.installCompatibility.mock.calls.length, 1);
		assert.equal(state.settled, false);
		compiler.resolve({} as WebAssembly.Module);
		await runtime.ready;
	});

	for (const failing of ['download', 'filesystem'] as const) {
		for (const lateFailure of [false, true]) {
			it(`rejects a ${failing} failure without waiting for its peer (lateFailure=${lateFailure})`, async () => {
				const filesystem = deferred<void>();
				const download = deferred<Uint8Array>();
				startup.memfsReady = filesystem.promise;
				startup.readBuffer.mockReturnValue(download.promise);
				const runtime = new Clang({ runtimeBaseUrl });
				const state = observe(runtime.ready);
				const reason = new Error(`${failing} failed`);
				(failing === 'download' ? download : filesystem).reject(reason);
				await nextTurn();
				assert.equal(state.settled, true);
				assert.equal(state.error, reason);
				assertNotInstalled();
				// A late rejection must also have a handler; test runners report unhandled ones.
				if (lateFailure) {
					(failing === 'download' ? filesystem : download).reject(new Error('late peer failure'));
				} else if (failing === 'download') {
					filesystem.resolve();
				} else {
					download.resolve(archive);
				}
				await nextTurn();
				assertNotInstalled();
				assert.equal(state.error, reason);
			});
		}
	}

	it('passes the caller signal and byte limit to the eager sysroot download', async () => {
		const controller = new AbortController();
		const runtime = new Clang({ runtimeBaseUrl, signal: controller.signal, maxAssetBytes: 4096 });
		await runtime.ready;
		assert.deepEqual(startup.readBuffer.mock.calls[0], [sysrootUrl, undefined, 4096, controller.signal]);
		assert.equal(startup.memfsOptions[0].signal, controller.signal);
		assert.equal(startup.memfsOptions[0].maxAssetBytes, 4096);
	});

	it('does not mount an already-downloaded sysroot after cancellation', async () => {
		const filesystem = deferred<void>();
		const controller = new AbortController();
		startup.memfsReady = filesystem.promise;
		const runtime = new Clang({ runtimeBaseUrl, signal: controller.signal });
		const state = observe(runtime.ready);
		await nextTurn();
		const reason = new Error('startup cancelled');
		controller.abort(reason);
		filesystem.resolve();
		await nextTurn();
		assert.equal(state.settled, true);
		assert.equal(state.error, reason);
		assertNotInstalled();
	});

	it('does not install compatibility headers after cancellation during untar', async () => {
		const extracted = deferred<void>();
		const controller = new AbortController();
		startup.untar.mockReturnValue(extracted.promise);
		const runtime = new Clang({ runtimeBaseUrl, signal: controller.signal });
		const state = observe(runtime.ready);
		await nextTurn();
		assert.equal(startup.untar.mock.calls.length, 1);
		const reason = new Error('cancel after extraction started');
		controller.abort(reason);
		extracted.resolve();
		await nextTurn();
		assert.equal(state.error, reason);
		assert.equal(startup.installHeaders.mock.calls.length, 0);
		assert.equal(startup.installCompatibility.mock.calls.length, 0);
	});

	it('keeps extraction and header installation ordered', async () => {
		const order: string[] = [];
		const extracted = deferred<void>();
		startup.untar.mockImplementation(async () => {
			order.push('untar');
			await extracted.promise;
			order.push('extracted');
		});
		startup.installHeaders.mockImplementation(() => {
			order.push('resource-headers');
		});
		startup.installCompatibility.mockImplementation(() => {
			order.push('compatibility');
		});
		const runtime = new Clang({ runtimeBaseUrl });
		await nextTurn();
		assert.deepEqual(order, ['untar']);
		extracted.resolve();
		await runtime.ready;
		assert.deepEqual(order, ['untar', 'extracted', 'resource-headers', 'compatibility']);
	});

	it('propagates extraction errors without installing headers', async () => {
		const reason = new Error('invalid tar');
		startup.untar.mockImplementation(() => {
			throw reason;
		});
		const runtime = new Clang({ runtimeBaseUrl });
		await assert.rejects(runtime.ready, (error) => error === reason);
		assert.equal(startup.installHeaders.mock.calls.length, 0);
		assert.equal(startup.installCompatibility.mock.calls.length, 0);
	});

	it('propagates resource-header installation errors', async () => {
		const reason = new Error('header installation failed');
		startup.installHeaders.mockImplementation(() => {
			throw reason;
		});
		const runtime = new Clang({ runtimeBaseUrl });
		await assert.rejects(runtime.ready, (error) => error === reason);
		assert.equal(startup.installCompatibility.mock.calls.length, 0);
	});

	it('validates byte limits before starting any asset work', () => {
		for (const maxAssetBytes of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
			assert.throws(() => new Clang({ runtimeBaseUrl, maxAssetBytes }), /positive safe integer/);
		}
		assert.equal(startup.memfsOptions.length, 0);
		assert.equal(startup.compile.mock.calls.length, 0);
		assert.equal(startup.readBuffer.mock.calls.length, 0);
	});
});
