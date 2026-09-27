import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { it } from 'vitest';

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
	return { promise, resolve, reject };
}

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
const bytes = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]);
const sysroot = [{ runtimePath: '/lib/fmt.a', bytes: new Uint8Array([7]) }];
const source = readFileSync(new URL('../src/tool-runtime.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
	compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
}).outputText;

type Settings = {
	pack?: (...args: unknown[]) => Promise<typeof sysroot>;
	asset?: (...args: unknown[]) => Promise<Uint8Array>;
	compile?: (bytes: ArrayBuffer) => Promise<WebAssembly.Module>;
	instantiate?: () => Promise<unknown>;
	capError?: Error;
	startError?: Error;
};

function harness(settings: Settings = {}) {
	const calls: { kind: string; args: unknown[] }[] = [];
	const log = (kind: string, ...args: unknown[]) => calls.push({ kind, args });
	const exports: Record<string, (...args: any[]) => Promise<any>> = {};
	class Directory { constructor(public contents: Map<string, unknown>) {} }
	class Placeholder { constructor(...args: unknown[]) { void args; } }
	class WASI {
		wasiImport = {};
		constructor(...args: unknown[]) { log('wasi', ...args); }
		start() {
			log('start');
			if (settings.startError) throw settings.startError;
			return 7;
		}
	}
	class CaptureFd { getText() { return 'captured'; } }
	const imports: Record<string, unknown> = {
		'@bjorn3/browser_wasi_shim': {
			Directory, File: Placeholder, OpenFile: Placeholder, PreopenDirectory: Placeholder, WASI
		},
		'./asset-url.js': { resolveVersionedAssetUrl: (base: string, asset: string) => new URL(asset, base) },
		'./runtime-asset.js': {
			loadRuntimePackEntries: (...args: unknown[]) => {
				log('pack', ...args);
				return settings.pack?.(...args) ?? Promise.resolve(sysroot);
			},
			fetchRuntimeAssetBytes: (...args: unknown[]) => {
				log('asset', ...args);
				return settings.asset?.(...args) ?? Promise.resolve(bytes);
			}
		},
		'./wasi-guest.js': {
			CaptureFd,
			ensureGuestDirectory: (...args: unknown[]) => log('directory', ...args),
			normalizeGuestPath: (path: string) => path,
			readGuestFile: (...args: unknown[]) => { log('read', ...args); return new Uint8Array([9]); },
			toStandaloneBytes: (value: Uint8Array) => Uint8Array.from(value),
			writeGuestFile: (...args: unknown[]) => log('write', ...args)
		},
		'./wasm-memory.js': {
			capGoWasmMemory: (value: Uint8Array, ...args: unknown[]) => {
				log('cap', value, ...args);
				if (settings.capError) throw settings.capError;
				return value;
			},
			assertGoInstanceMemoryLimit: (...args: unknown[]) => log('memory-check', ...args)
		}
	};
	// Exercise the production module cache too, with the existing controlled memory
	// and native-compile boundaries. No Web Crypto in this VM selects its uncached path.
	const moduleExports: Record<string, unknown> = {};
	const moduleSource = readFileSync(new URL('../src/tool-module.ts', import.meta.url), 'utf8');
	runInNewContext(
		ts.transpileModule(moduleSource, {
			compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
		}).outputText,
		{
			exports: moduleExports,
			require: (id: string) => imports[id],
			Uint8Array,
			DOMException,
			WebAssembly: {
				compile: (value: Uint8Array) => {
					log('compile', value);
					return settings.compile?.(value.slice().buffer) ?? WebAssembly.compile(Uint8Array.from(value));
				}
			}
		}
	);
	imports['./tool-module.js'] = moduleExports;
	runInNewContext(compiled, {
		exports, require: (id: string) => {
			if (!(id in imports)) throw new Error(`Unexpected dependency ${id}`);
			return imports[id];
		}, URL, Uint8Array, AbortController, DOMException, fetch,
		WebAssembly: {
			compile: (value: ArrayBuffer) => {
				log('compile', value);
				return settings.compile?.(value) ?? WebAssembly.compile(value);
			},
			instantiate: async (...args: unknown[]) => {
				log('instantiate', ...args);
				return settings.instantiate ? settings.instantiate() : { exports: {} };
			}
		}
	}, { filename: 'tool-runtime.js' });
	const invocation = {
		tool: 'compile', toolAsset: 'compile.wasm', args: ['compile', '-o', '/work/main.a'],
		env: { GOOS: 'js' }, inputFiles: [{ path: '/work/main.go', contents: 'package main' }],
		outputPath: '/work/main.a'
	};
	const plan: any = {
		sysrootPack: { index: 'sysroot.json', asset: 'sysroot.pack' },
		compile: { outputPath: '/work/main.a' }
	};
	const fetchImpl = async () => new Response();
	const progress = (...args: unknown[]) => log('progress', ...args);
	const run = (options: Record<string, unknown> = {}) =>
		exports.executeGoToolInvocation(invocation, plan, 'https://example.test/go/', fetchImpl, progress, options);
	const count = (kind: string) => calls.filter((call) => call.kind === kind).length;
	return { calls, count, run, invocation, plan, fetchImpl };
}

it('starts the tool download before the sysroot resolves and overlaps Wasm compilation', async () => {
	const pack = deferred<typeof sysroot>();
	const h = harness({ pack: () => pack.promise });
	const run = h.run();
	await tick();
	assert.equal(h.count('pack'), 1);
	assert.equal(h.count('asset'), 1);
	assert.equal(h.count('compile'), 1);
	assert.equal(h.count('instantiate'), 0);
	pack.resolve(sysroot);
	await run;
	assert.equal(h.count('start'), 1);
});

it('waits for tool compilation when the sysroot finishes first', async () => {
	const module = deferred<WebAssembly.Module>();
	const h = harness({ compile: () => module.promise });
	const run = h.run();
	await tick();
	assert.equal(h.count('compile'), 1);
	assert.equal(h.count('instantiate'), 0);
	module.resolve(await WebAssembly.compile(bytes));
	await run;
	assert.equal(h.count('start'), 1);
});

for (const failed of ['pack', 'asset'] as const) {
	it(`reports ${failed} failure while its peer is pending, and observes a later peer rejection`, async () => {
		const pack = deferred<typeof sysroot>();
		const asset = deferred<Uint8Array>();
		const h = harness({ pack: () => pack.promise, asset: () => asset.promise });
		const error = new Error(failed);
		const run = h.run();
		const rejection = assert.rejects(run, (value) => value === error);
		(failed === 'pack' ? pack : asset).reject(error);
		await Promise.race([rejection, tick().then(() => { throw new Error('failure blocked by peer'); })]);
		(failed === 'pack' ? asset : pack).reject(new Error('late peer failure'));
		await tick();
		assert.equal(h.count('instantiate'), 0);
		assert.equal(h.count('start'), 0);
	});
}

for (const failed of ['pack', 'asset'] as const) {
	it(`aborts pending ${failed === 'pack' ? 'tool' : 'sysroot'} work when ${failed} fails`, async () => {
		const error = new Error(failed);
		const callerController = new AbortController();
		let peerSignal: AbortSignal | undefined;
		let peerAborted = false;
		const waitForAbort = (signal: AbortSignal) => {
			peerSignal = signal;
			return new Promise<never>((_resolve, reject) => {
				signal.addEventListener(
					'abort',
					() => {
						peerAborted = true;
						reject(signal.reason);
					},
					{ once: true }
				);
			});
		};
		const h = harness({
			pack:
				failed === 'pack'
					? () => Promise.reject(error)
					: (...args) => waitForAbort((args[4] as { signal: AbortSignal }).signal),
			asset:
				failed === 'asset'
					? () => Promise.reject(error)
					: (...args) => waitForAbort((args[5] as { signal: AbortSignal }).signal)
		});
		await assert.rejects(
			h.run({ signal: callerController.signal }),
			(value) => value === error
		);
		assert.equal(peerAborted, true);
		assert.equal(peerSignal?.aborted, true);
		assert.equal(peerSignal?.reason, error);
		assert.notEqual(peerSignal, callerController.signal);
		assert.equal(callerController.signal.aborted, false);
	});
}

it('observes synchronous loader failures without starting the program', async () => {
	const error = new Error('sync failure');
	const h = harness({ pack: () => { throw error; }, asset: () => Promise.reject(new Error('peer')) });
	await assert.rejects(h.run(), (value) => value === error);
	await tick();
	assert.equal(h.count('asset'), 1);
	assert.equal(h.count('start'), 0);
});

it('preserves fetch, boundary options and progress for both dependencies', async () => {
	const h = harness();
	const options = { maxAssetBytes: 2000, maxWasmMemoryBytes: 65536, assetTimeoutMs: 1000, signal: new AbortController().signal };
	await h.run(options);
	const pack = h.calls.find((call) => call.kind === 'pack')!.args;
	const asset = h.calls.find((call) => call.kind === 'asset')!.args;
	const packOptions = pack[4] as typeof options;
	const assetOptions = asset[5] as typeof options;
	assert.equal(pack[2], h.fetchImpl);
	assert.notEqual(packOptions, options);
	assert.equal(asset[2], h.fetchImpl);
	assert.equal(asset[3], true);
	assert.equal(assetOptions, packOptions);
	assert.notEqual(assetOptions.signal, options.signal);
	assert.equal(assetOptions.maxAssetBytes, options.maxAssetBytes);
	assert.equal(assetOptions.maxWasmMemoryBytes, options.maxWasmMemoryBytes);
	assert.equal(assetOptions.assetTimeoutMs, options.assetTimeoutMs);
	(asset[4] as Function)(8, 16);
	(pack[3] as { index: Function; asset: Function }).index(1, 2);
	(pack[3] as { index: Function; asset: Function }).asset(3, 4);
	assert.deepEqual(h.calls.filter((call) => call.kind === 'progress').map((call) => call.args), [
		['compile.wasm', 8, 16], ['sysroot.json', 1, 2], ['sysroot.pack', 3, 4]
	]);
	const cap = h.calls.find((call) => call.kind === 'cap')!.args;
	assert.equal(cap[1], 65536);
	assert.equal(cap[2], 'compile.wasm');
	assert.equal(h.count('memory-check'), 2);
});

it('removes the caller abort relay after startup success and failure', async () => {
	for (const error of [undefined, new Error('asset')]) {
		let added = 0;
		let removed = 0;
		const listeners = new Set<EventListenerOrEventListenerObject>();
		const signal = {
			aborted: false,
			reason: undefined,
			addEventListener: (type: string, listener: EventListenerOrEventListenerObject) => {
				assert.equal(type, 'abort');
				added += 1;
				listeners.add(listener);
			},
			removeEventListener: (type: string, listener: EventListenerOrEventListenerObject) => {
				assert.equal(type, 'abort');
				removed += 1;
				listeners.delete(listener);
			}
		} as unknown as AbortSignal;
		const h = harness(error ? { asset: () => Promise.reject(error) } : {});
		if (error) {
			await assert.rejects(h.run({ signal }), (value) => value === error);
		} else {
			await h.run({ signal });
		}
		assert.equal(added, 1);
		assert.equal(removed, 1);
		assert.equal(listeners.size, 0);
	}
});

it('mounts sysroot before workspace inputs and preserves results', async () => {
	const h = harness();
	const result = await h.run();
	assert.deepEqual(h.calls.filter((call) => call.kind === 'write').map((call) => call.args[1]), ['/lib/fmt.a', '/work/main.go']);
	assert.equal(result.exitCode, 7);
	assert.equal(result.stdout, 'captured');
	assert.equal(result.stderr, 'captured');
	assert.deepEqual(Array.from(result.outputs['/work/main.a']), [9]);
});

it('also overlaps individual sysroot assets with the compiler', async () => {
	const asset = deferred<Uint8Array>();
	const h = harness({ asset: () => asset.promise });
	delete h.plan.sysrootPack;
	h.plan.sysrootFiles = [{ runtimePath: '/lib/fmt.a', asset: 'fmt.a' }];
	const run = h.run();
	await tick();
	assert.equal(h.count('asset'), 2);
	asset.resolve(bytes);
	await run;
});

it('rejects missing linker input before starting downloads', async () => {
	const h = harness();
	h.invocation.tool = 'link';
	h.plan.link = {};
	await assert.rejects(h.run(), /missing compile output/);
	assert.equal(h.count('pack'), 0);
	assert.equal(h.count('asset'), 0);
});

it('does no I/O for an already aborted operation', async () => {
	const h = harness();
	const controller = new AbortController();
	controller.abort(new Error('cancelled'));
	await assert.rejects(h.run({ signal: controller.signal }), /cancelled/);
	assert.equal(h.calls.length, 0);
});

it('does not instantiate after cancellation during module compilation', async () => {
	const module = deferred<WebAssembly.Module>();
	const controller = new AbortController();
	const h = harness({ compile: () => module.promise });
	const run = h.run({ signal: controller.signal });
	const rejection = assert.rejects(run, /cancelled/);
	await tick();
	controller.abort(new Error('cancelled'));
	module.resolve(await WebAssembly.compile(bytes));
	await rejection;
	assert.equal(h.count('instantiate'), 0);
});

it('does not start when cancellation arrives during instantiation', async () => {
	const instance = deferred<unknown>();
	const controller = new AbortController();
	const h = harness({ instantiate: () => instance.promise });
	const run = h.run({ signal: controller.signal });
	await tick();
	controller.abort(new Error('cancelled'));
	instance.resolve({ exports: {} });
	await assert.rejects(run, /cancelled/);
	assert.equal(h.count('start'), 0);
});

for (const stage of ['cap', 'compile', 'instantiate', 'start'] as const) {
	it(`propagates ${stage} errors without returning artifacts`, async () => {
		const error = new Error(stage);
		const h = harness({
			...(stage === 'cap' ? { capError: error } : {}),
			...(stage === 'compile' ? { compile: () => Promise.reject(error) } : {}),
			...(stage === 'instantiate' ? { instantiate: () => Promise.reject(error) } : {}),
			...(stage === 'start' ? { startError: error } : {})
		});
		await assert.rejects(h.run(), (value) => value === error);
		assert.equal(h.count('read'), 0);
	});
}
