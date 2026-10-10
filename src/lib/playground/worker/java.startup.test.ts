// @vitest-environment node

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { test } from 'vitest';

const assetNames = [
	'compiler.wasm-runtime.js',
	'compiler.wasm',
	'compile-classlib-teavm.bin',
	'runtime-classlib-teavm.bin'
];
const source = readFileSync(new URL('./java.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
	compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason: Error) => void;
	const promise = new Promise<T>((yes, no) => {
		resolve = yes;
		reject = no;
	});
	return { promise, resolve, reject };
}

function worker(
	options: {
		asset?: (name: string) => Promise<{ bytes: Uint8Array }>;
		initialize?: () => Promise<void>;
		importError?: () => Error | undefined;
		setSdk?: () => void;
		setClasslib?: () => void;
	} = {}
) {
	const requests: string[] = [];
	const messages: any[] = [];
	const revoked: string[] = [];
	const imports: string[] = [];
	const registered: Array<{ kind: string; bytes: number[] }> = [];
	let handler!: (event: { data: any }) => Promise<void>;
	let initializationCount = 0;
	const runtime = {
		load: async () => {
			initializationCount++;
			await options.initialize?.();
			return {
				exports: {
					createCompiler: () => ({
						setSdk: (bytes: Int8Array) => {
							options.setSdk?.();
							registered.push({ kind: 'sdk', bytes: Array.from(bytes) });
						},
						setTeaVMClasslib: (bytes: Int8Array) => {
							options.setClasslib?.();
							registered.push({ kind: 'classlib', bytes: Array.from(bytes) });
						}
					})
				}
			};
		}
	};
	const assetApi = {
		configureWorkerRuntimeAssets() {},
		handleWorkerAssetMessage: () => false,
		loadWorkerRuntimeAsset: (name: string) => {
			requests.push(name);
			return options.asset?.(name) ?? Promise.resolve({ bytes: new Uint8Array([1, 2, 255]) });
		}
	};
	vm.runInNewContext(compiled, {
		exports: {},
		TextDecoder,
		TextEncoder,
		Blob,
		Uint8Array,
		Int8Array,
		Int32Array,
		Error,
		URL: {
			createObjectURL: () => `blob:runtime-${imports.length}`,
			revokeObjectURL: (url: string) => revoked.push(url)
		},
		self: {
			addEventListener: (_: string, listener: typeof handler) => {
				handler = listener;
			},
			postMessage: (message: any) => messages.push(message)
		},
		require: (id: string) => {
			if (id === './javaStreaming')
				return {
					acceptCompiledTeaVmModule: (source: string) => source,
					loadStreamingJavaCompiler: async () => undefined
				};
			if (id === '$lib/playground/worker/assets') return assetApi;
			if (id.startsWith('blob:')) {
				imports.push(id);
				const error = options.importError?.();
				if (error) throw error;
				return runtime;
			}
			if (
				[
					'$lib/playground/javaStdin',
					'$lib/playground/javaRuntimeStdin',
					'$lib/playground/javaSource',
					'$lib/playground/stdinBuffer'
				].includes(id)
			)
				return {};
			throw new Error(`Unexpected dependency: ${id}`);
		}
	});
	return {
		load: (baseUrl = '/teavm/') => handler({ data: { load: true, assets: { baseUrl } } }),
		requests,
		messages,
		revoked,
		imports,
		registered,
		get initializationCount() {
			return initializationCount;
		}
	};
}

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

test('starts all verified asset requests before the runtime JavaScript is available', async () => {
	const gate = deferred<{ bytes: Uint8Array }>();
	const w = worker({ asset: () => gate.promise });
	const loading = w.load();
	assert.deepEqual([...w.requests].sort(), [...assetNames].sort());
	assert.equal(w.messages.length, 0);
	gate.resolve({ bytes: new Uint8Array([1]) });
	await loading;
	assert.equal(w.messages.at(-1)?.load, true);
});

test('imports the loader without waiting for the compiler Wasm download', async () => {
	const gate = deferred<{ bytes: Uint8Array }>();
	const w = worker({
		asset: (name) =>
			name === 'compiler.wasm'
				? gate.promise
				: Promise.resolve({ bytes: new Uint8Array([1]) })
	});
	const loading = w.load();
	await tick();
	assert.equal(w.imports.length, 1);
	assert.equal(w.initializationCount, 0);
	assert.equal(w.revoked.length, 1);
	gate.resolve({ bytes: new Uint8Array([2]) });
	await loading;
});

test('initializes Wasm while class libraries are downloading, but does not announce ready', async () => {
	const gate = deferred<{ bytes: Uint8Array }>();
	const w = worker({
		asset: (name) =>
			name.endsWith('.bin') ? gate.promise : Promise.resolve({ bytes: new Uint8Array([1]) })
	});
	const loading = w.load();
	await tick();
	assert.equal(w.initializationCount, 1);
	assert.equal(w.registered.length, 0);
	assert.equal(w.messages.length, 0);
	gate.resolve({ bytes: new Uint8Array([3]) });
	await loading;
	assert.deepEqual(
		w.registered.map((entry) => entry.kind),
		['sdk', 'classlib']
	);
	assert.equal(w.messages.at(-1)?.load, true);
});

test('class libraries use only the verified typed-array view', async () => {
	const w = worker({
		asset: async () => ({ bytes: new Uint8Array([9, 1, 255, 9]).subarray(1, 3) })
	});
	await w.load();
	assert.deepEqual(
		w.registered.map((entry) => entry.bytes),
		[
			[1, -1],
			[1, -1]
		]
	);
});

for (const failedAsset of assetNames) {
	test(`retries after ${failedAsset} fails without caching partial initialization`, async () => {
		let fail = true;
		const w = worker({
			asset: async (name) => {
				if (fail && name === failedAsset) throw new Error(`failed: ${name}`);
				return { bytes: new Uint8Array([1]) };
			}
		});
		await w.load();
		await tick();
		assert.equal(w.messages.at(-1)?.error, `failed: ${failedAsset}`);
		assert.equal(
			w.messages.some((message) => message.load),
			false
		);
		fail = false;
		await w.load();
		assert.equal(w.messages.at(-1)?.load, true);
		assert.equal(w.requests.length, 8);
	});
}

test('revokes the Blob URL even when importing the loader fails', async () => {
	let fail = true;
	const w = worker({ importError: () => (fail ? new Error('import failed') : undefined) });
	await w.load();
	assert.equal(w.messages.at(-1)?.error, 'import failed');
	assert.deepEqual(w.revoked, w.imports);
	fail = false;
	await w.load();
	assert.equal(w.messages.at(-1)?.load, true);
});

for (const stage of ['setSdk', 'setClasslib'] as const) {
	test(`does not publish a compiler when ${stage} fails`, async () => {
		let fail = true;
		const w = worker({
			[stage]: () => {
				if (fail) throw new Error(stage);
			}
		});
		await w.load();
		assert.equal(w.messages.at(-1)?.error, stage);
		fail = false;
		await w.load();
		assert.equal(w.initializationCount, 2);
		assert.equal(w.messages.at(-1)?.load, true);
	});
}

test('reuses a successfully initialized compiler and reloads a different base URL', async () => {
	const w = worker();
	await w.load();
	await w.load();
	assert.equal(w.initializationCount, 1);
	assert.equal(w.requests.length, 4);
	await w.load('/other-teavm/');
	assert.equal(w.initializationCount, 2);
	assert.equal(w.requests.length, 8);
});

test('observes a class-library rejection even while Wasm initialization is blocked', async () => {
	const initialization = deferred<void>();
	const classlib = deferred<{ bytes: Uint8Array }>();
	const w = worker({
		initialize: () => initialization.promise,
		asset: (name) =>
			name === 'runtime-classlib-teavm.bin'
				? classlib.promise
				: Promise.resolve({ bytes: new Uint8Array([1]) })
	});
	const loading = w.load();
	await tick();
	assert.equal(w.initializationCount, 1);
	classlib.reject(new Error('classlib rejected'));
	await loading;
	assert.equal(w.messages.at(-1)?.error, 'classlib rejected');
	initialization.resolve();
	await tick();
	assert.equal(
		w.messages.some((message) => message.load),
		false
	);
});
