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
		addDirectory = vi.fn();
		addFile = vi.fn();
		getFileContents = vi.fn(() => new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]));

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
import type { RuntimeManifestV1 } from '../src/types.js';

const runtimeBaseUrl = 'https://cdn.test/clang/';
const sysrootUrl = `${runtimeBaseUrl}bin/sysroot.tar.gz`;
const archive = new Uint8Array([1, 2, 3]);
const cArchive = new Uint8Array([4, 5, 6]);
const cppArchive = new Uint8Array([7, 8, 9]);
const cSysrootUrl = `${runtimeBaseUrl}bin/c-sysroot.tar.gz`;
const cppAddonUrl = `${runtimeBaseUrl}bin/cpp-addon.tar.gz`;
const profileManifest = {
	compiler: {
		memfs: { asset: 'bin/memfs.wasm.gz', argv0: 'memfs' },
		clang: { asset: 'bin/clang.wasm.gz', argv0: 'clang' },
		lld: { asset: 'bin/lld.wasm.gz', argv0: 'wasm-ld' },
		sysroot: {
			asset: 'bin/sysroot.tar.gz',
			profiles: {
				c: { asset: 'bin/c-sysroot.tar.gz' },
				cppAddon: { asset: 'bin/cpp-addon.tar.gz' }
			}
		}
	},
	clangd: { js: 'clangd/clangd.js', wasm: 'clangd/clangd.wasm.gz' }
} as RuntimeManifestV1;

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
		assert.deepEqual(startup.readBuffer.mock.calls[0], [
			sysrootUrl,
			undefined,
			128 * 1024 * 1024
		]);
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
					(failing === 'download' ? filesystem : download).reject(
						new Error('late peer failure')
					);
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
		const runtime = new Clang({
			runtimeBaseUrl,
			signal: controller.signal,
			maxAssetBytes: 4096
		});
		await runtime.ready;
		assert.deepEqual(startup.readBuffer.mock.calls[0], [
			sysrootUrl,
			undefined,
			4096,
			controller.signal
		]);
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
			assert.throws(
				() => new Clang({ runtimeBaseUrl, maxAssetBytes }),
				/positive safe integer/
			);
		}
		assert.equal(startup.memfsOptions.length, 0);
		assert.equal(startup.compile.mock.calls.length, 0);
		assert.equal(startup.readBuffer.mock.calls.length, 0);
	});
});

describe('Clang profiled sysroot consumption', () => {
	beforeEach(() => {
		startup.memfsReady = Promise.resolve();
		startup.memfsOptions.length = 0;
		startup.compile.mockReset().mockResolvedValue({});
		startup.readBuffer
			.mockReset()
			.mockImplementation(async (url: string) =>
				url === cSysrootUrl ? cArchive : cppArchive
			);
		startup.untar.mockReset();
		startup.installHeaders.mockReset();
		startup.installCompatibility.mockReset();
	});

	it('loads only the C base at startup, including when a full legacy asset exists', async () => {
		const runtime = new Clang({ runtimeBaseUrl, manifest: profileManifest });
		await runtime.ready;
		assert.deepEqual(
			startup.readBuffer.mock.calls.map(([url]) => url),
			[cSysrootUrl]
		);
		assert.deepEqual(
			startup.untar.mock.calls.map(([bytes]) => bytes),
			[cArchive]
		);
		assert.equal(runtime.assetUrls.sysroot, sysrootUrl);
	});

	it('mounts the C++ overlay before compilation and direct linking, only once', async () => {
		const order: string[] = [];
		startup.untar.mockImplementation((bytes: Uint8Array) => {
			order.push(bytes === cArchive ? 'base' : 'addon');
		});
		const runtime = new Clang({ runtimeBaseUrl, manifest: profileManifest });
		await runtime.ready;
		runtime.run = vi.fn(async () => {
			order.push('run');
			return null;
		});
		await runtime.compile({
			input: 'main.c',
			code: 'int main(void) { return 0; }',
			obj: 'main.o',
			language: 'C'
		});
		assert.deepEqual(order, ['base', 'run']);
		await runtime.compile({
			input: 'main.cc',
			code: 'int main() { return 0; }',
			obj: 'main.o',
			language: 'CPP'
		});
		await runtime.link('main.o', 'main.wasm');
		assert.deepEqual(order, ['base', 'run', 'addon', 'run', 'run']);
		assert.deepEqual(
			startup.readBuffer.mock.calls.map(([url]) => url),
			[cSysrootUrl, cppAddonUrl]
		);
		assert.deepEqual(
			startup.untar.mock.calls.map(([bytes]) => bytes),
			[cArchive, cppArchive]
		);
	});

	it('mounts the overlay for response-file overrides before compiling a C input', async () => {
		const order: string[] = [];
		startup.untar.mockImplementation((bytes: Uint8Array) => {
			order.push(bytes === cArchive ? 'base' : 'addon');
		});
		const runtime = new Clang({ runtimeBaseUrl, manifest: profileManifest });
		await runtime.ready;
		runtime.run = vi.fn(async () => {
			order.push('run');
			return null;
		});
		await runtime.compile({
			input: 'main.c',
			code: 'int main() { return 0; }',
			obj: 'main.o',
			language: 'C',
			compileArgs: ['@flags.rsp']
		});
		assert.deepEqual(order, ['base', 'addon', 'run']);
	});

	it('waits for the add-on before the first C++ unit in a mixed C/C++ build', async () => {
		const order: string[] = [];
		startup.untar.mockImplementation((bytes: Uint8Array) => {
			order.push(bytes === cArchive ? 'base' : 'addon');
		});
		const runtime = new Clang({ runtimeBaseUrl, manifest: profileManifest });
		await runtime.ready;
		runtime.run = vi.fn(async (_module, _out, executable: string) => {
			order.push(executable);
			return null;
		});
		await runtime.compileLink('int main(void) { return helper(); }', {
			language: 'C',
			activePath: 'main.c',
			workspaceFiles: [{ path: 'z-helper.cpp', content: 'int helper() { return 0; }' }]
		});
		assert.deepEqual(order, ['base', 'clang', 'addon', 'clang', 'wasm-ld']);
		assert.deepEqual(
			startup.readBuffer.mock.calls.map(([url]) => url),
			[cSysrootUrl, cppAddonUrl]
		);
	});

	it('loads the add-on for direct C++ linking without an earlier compile', async () => {
		const order: string[] = [];
		startup.untar.mockImplementation((bytes: Uint8Array) => {
			order.push(bytes === cArchive ? 'base' : 'addon');
		});
		const runtime = new Clang({ runtimeBaseUrl, manifest: profileManifest });
		await runtime.ready;
		runtime.run = vi.fn(async () => {
			order.push('link');
			return null;
		});
		await runtime.link('main.o', 'main.wasm');
		assert.deepEqual(order, ['base', 'addon', 'link']);
	});

	it('retries a failed add-on download without remounting the C base', async () => {
		const reason = new Error('temporary add-on fetch failure');
		let addonAttempts = 0;
		startup.readBuffer.mockImplementation(async (url: string) => {
			if (url === cSysrootUrl) return cArchive;
			if (++addonAttempts === 1) throw reason;
			return cppArchive;
		});
		const runtime = new Clang({ runtimeBaseUrl, manifest: profileManifest });
		await runtime.ready;
		runtime.run = vi.fn(async () => null);
		const compileOptions = {
			input: 'main.cc',
			code: 'int main() {}',
			obj: 'main.o',
			language: 'CPP'
		};
		await assert.rejects(runtime.compile(compileOptions), (error) => error === reason);
		await runtime.compile(compileOptions);
		assert.equal(addonAttempts, 2);
		assert.deepEqual(
			startup.untar.mock.calls.map(([bytes]) => bytes),
			[cArchive, cppArchive]
		);
	});

	it('does not mount an add-on after cancellation', async () => {
		const addon = deferred<Uint8Array>();
		startup.readBuffer.mockImplementation((url: string) =>
			url === cSysrootUrl ? Promise.resolve(cArchive) : addon.promise
		);
		const controller = new AbortController();
		const runtime = new Clang({
			runtimeBaseUrl,
			manifest: profileManifest,
			signal: controller.signal
		});
		await runtime.ready;
		runtime.run = vi.fn(async () => null);
		const compiled = runtime.compile({
			input: 'main.cc',
			code: 'int main() {}',
			obj: 'main.o'
		});
		const reason = new Error('cancel add-on');
		controller.abort(reason);
		addon.resolve(cppArchive);
		await assert.rejects(compiled, (error) => error === reason);
		assert.deepEqual(
			startup.untar.mock.calls.map(([bytes]) => bytes),
			[cArchive]
		);
		assert.equal(vi.mocked(runtime.run).mock.calls.length, 0);
	});
});
