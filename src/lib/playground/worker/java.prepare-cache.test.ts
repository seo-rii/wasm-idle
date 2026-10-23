// @vitest-environment node

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { test } from 'vitest';
import { webcrypto } from 'node:crypto';
import * as javaDebugBridge from '../javaDebugBridge';
import * as javaDebugSource from '../javaDebugSource';
import * as javaDebugRuntime from './javaDebugRuntime';
import * as debugMailbox from '../debugMailbox';
import { prepareJavaExceptionBridge } from '../javaRuntimeErrors';

const source = readFileSync(new URL('./java.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
	compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;

function worker() {
	const messages: any[] = [];
	const counts = { compile: 0, bridgeCompile: 0, generate: 0, run: 0, initialize: 0 };
	const failure = { compile: false, bridge: false, generate: false, output: false };
	let compilingBridge = false;
	let onDiagnostic: ((diagnostic: any) => void) | undefined;
	let handler!: (event: { data: any }) => Promise<void>;
	const compiler = {
		setSdk() {},
		setTeaVMClasslib() {},
		clearSourceFiles() {
			compilingBridge = false;
		},
		clearInputClassFiles() {},
		clearOutputFiles() {},
		addSourceFile(name: string) {
			compilingBridge =
				name.startsWith('WasmIdleJavaEntryPoint') ||
				name.startsWith('WasmIdleJavaExceptionBridge');
		},
		listOutputFiles: () => ['Main.class'],
		getOutputFile: () => new Int8Array([1]),
		addClassFile() {},
		onDiagnostic(callback: typeof onDiagnostic) {
			onDiagnostic = callback;
			return () => {
				onDiagnostic = undefined;
			};
		},
		compile() {
			if (compilingBridge) {
				counts.bridgeCompile++;
				onDiagnostic?.({ severity: 'other', message: 'internal generated-source note' });
				return !failure.bridge;
			}
			counts.compile++;
			onDiagnostic?.({
				fileName: 'Main.java',
				lineNumber: 1,
				severity: 'warning',
				message: 'warning'
			});
			onDiagnostic?.({
				fileName: 'Unrelated.java',
				lineNumber: 1,
				severity: 'warning',
				message: 'hidden'
			});
			return !failure.compile;
		},
		detectMainClasses: () => ['Main'],
		generateWebAssembly() {
			counts.generate++;
			return !failure.generate;
		},
		getWebAssemblyOutputFile() {
			if (failure.output) throw new Error('output failed');
			return new Uint8Array([9]);
		}
	};
	const runtime = {
		load: async (bytes: Uint8Array) => {
			if (bytes[0] === 9)
				return {
					exports: {
						main: () => {
							counts.run++;
						}
					}
				};
			counts.initialize++;
			return { exports: { createCompiler: () => compiler } };
		}
	};
	vm.runInNewContext(compiled, {
		exports: {},
		crypto: webcrypto,
		TextDecoder,
		TextEncoder,
		Blob,
		Uint8Array,
		Int8Array,
		Int32Array,
		Error,
		WebAssembly: { compile: async () => ({}) },
		URL: { createObjectURL: () => 'blob:loader', revokeObjectURL() {} },
		self: {
			addEventListener: (_: string, listener: typeof handler) => {
				handler = listener;
			},
			postMessage: (message: any) => messages.push(message)
		},
		require: (id: string) => {
			if (id === '../javaDebugBridge') return javaDebugBridge;
			if (id === '../javaDebugSource') return javaDebugSource;
			if (id === '../debugMailbox') return debugMailbox;
			if (id === './javaDebugRuntime') return javaDebugRuntime;
			if (id === '$lib/playground/javaRuntimeErrors') return { prepareJavaExceptionBridge };
			if (id === './javaStreaming')
				return {
					acceptCompiledTeaVmModule: (source: string) => source,
					loadStreamingJavaCompiler: async () => undefined
				};
			if (id === '$lib/playground/worker/assets')
				return {
					configureWorkerRuntimeAssets() {},
					handleWorkerAssetMessage: () => false,
					loadWorkerRuntimeAsset: async () => ({ bytes: new Uint8Array([1]) })
				};
			if (id === '$lib/playground/javaRuntimeStdin')
				return {
					prepareJavaRuntimeStdinInjection: (code: string) => ({
						transformedCode: code,
						usesStdin: false,
						stdinCacheKey: 'host-chunks-v1'
					}),
					createJavaStdinBridge: () => ({
						readByte: () => -1,
						readChunk: () => null,
						dispose() {}
					})
				};
			if (id === '$lib/playground/javaSource')
				return {
					resolveJavaSourceIdentity: () => ({
						mainClass: 'Main',
						sourcePath: 'Main.java'
					})
				};
			if (id === '$lib/playground/stdinBuffer') return { waitForBufferedStdin: () => null };
			if (id === 'blob:loader') return runtime;
			throw new Error(`Unexpected dependency: ${id}`);
		}
	});
	return {
		counts,
		hasDiagnosticListener: () => onDiagnostic !== undefined,
		failure,
		messages,
		load: (baseUrl = '/teavm/') => handler({ data: { load: true, assets: { baseUrl } } }),
		run: (options: Record<string, unknown> = {}) => {
			messages.length = 0;
			return handler({
				data: {
					code: 'class Main {}',
					prepare: true,
					hasExplicitStdin: true,
					buffer: new ArrayBuffer(16),
					...options
				}
			});
		}
	};
}

test('unchanged prepare requests compile only once and never execute the program', async () => {
	const w = worker();
	await w.load();
	await w.run();
	await w.run();
	assert.deepEqual(w.counts, {
		compile: 1,
		bridgeCompile: 1,
		generate: 1,
		run: 0,
		initialize: 1
	});
	assert.equal(w.messages.at(-1)?.results, true);
});

test('execution after preparation reuses the artifact, including when only args change', async () => {
	const w = worker();
	await w.load();
	await w.run();
	await w.run({ prepare: false, args: ['first'] });
	await w.run({ prepare: false, args: ['second'] });
	assert.equal(w.counts.compile, 1);
	assert.equal(w.counts.generate, 1);
	assert.equal(w.counts.run, 2);
});

for (const [label, options] of Object.entries({
	source: { code: 'class Main { int x; }' },
	activePath: { activePath: 'other/Main.java' },
	workspace: { workspaceFiles: [{ path: 'Helper.java', content: 'class Helper {}' }] }
})) {
	test(`invalidates preparation when ${label} changes`, async () => {
		const w = worker();
		await w.load();
		await w.run();
		await w.run(options);
		await w.run(options);
		assert.equal(w.counts.compile, 2);
		assert.equal(w.counts.run, 0);
	});
}

test('changes to workspace contents invalidate a same-length file list', async () => {
	const w = worker();
	await w.load();
	await w.run({ workspaceFiles: [{ path: 'Helper.java', content: 'class Helper {}' }] });
	await w.run({ workspaceFiles: [{ path: 'Helper.java', content: 'class Helper { int x; }' }] });
	assert.equal(w.counts.compile, 2);
});

for (const stage of ['compile', 'bridge', 'generate', 'output'] as const) {
	test(`a failed ${stage} cannot leave the previous artifact eligible for reuse`, async () => {
		const w = worker();
		await w.load();
		await w.run();
		w.failure[stage] = true;
		await w.run({ code: 'class Main { int changed; }' });
		assert.equal(typeof w.messages.at(-1)?.error, 'string');
		assert.equal(
			w.messages.some((message) => message.results),
			false
		);
		w.failure[stage] = false;
		await w.run();
		assert.equal(w.counts.compile, 3);
		assert.equal(w.messages.at(-1)?.results, true);
	});
}

test('replays visible diagnostics once per cache hit, without unrelated-file diagnostics', async () => {
	const w = worker();
	await w.load();
	await w.run();
	const first = JSON.stringify(w.messages.filter((message) => message.diagnostic));
	await w.run();
	assert.equal(JSON.stringify(w.messages.filter((message) => message.diagnostic)), first);
	assert.equal(w.messages.filter((message) => message.diagnostic).length, 1);
	assert.equal(w.counts.compile, 1);
});

test('a different runtime invalidates the artifact cache', async () => {
	const w = worker();
	await w.load();
	await w.run();
	await w.load('/another-teavm/');
	await w.run();
	assert.equal(w.counts.compile, 2);
	assert.equal(w.counts.initialize, 2);
});

test('invalid workspaces are rejected even when the source would otherwise be cached', async () => {
	const w = worker();
	await w.load();
	await w.run();
	await w.run({ workspaceFiles: [{ path: 42, content: 'bad' }] });
	assert.equal(w.messages.at(-1)?.error, 'Invalid Java workspace files');
	assert.equal(w.counts.compile, 1);
});

for (const options of [{ stdin: 'changed input' }, { hasExplicitStdin: false }]) {
	test(`runtime input changes do not invalidate compilation: ${JSON.stringify(options)}`, async () => {
		const w = worker();
		await w.load();
		await w.run();
		await w.run({ ...options, prepare: false });
		assert.equal(w.counts.compile, 1);
		assert.equal(w.counts.generate, 1);
		assert.equal(w.counts.run, 1);
		assert.equal(w.messages.at(-1)?.results, true);
	});
}

test('debug and ordinary preparation never reuse each other’s compiled artifact', async () => {
	const w = worker();
	await w.load();
	await w.run({ debugMode: 'trace' });
	assert.equal(w.messages.at(-1)?.results, true);
	await w.run({ debugMode: 'none' });
	await w.run({ debugMode: 'trace' });
	assert.equal(w.counts.compile, 3);
	assert.equal(w.counts.generate, 3);
	assert.equal(w.counts.run, 0);
});

test('unsupported debug syntax leaves no diagnostic registration and ordinary Run can recover', async () => {
	const w = worker();
	await w.load();
	const code = String.raw`class Main { // \u0041
 }`;
	await w.run({ code, debugMode: 'trace' });
	assert.match(w.messages.at(-1)?.error, /Unicode preprocessing/);
	assert.equal(w.hasDiagnosticListener(), false);
	await w.run({ code, debugMode: 'none' });
	assert.equal(w.messages.at(-1)?.results, true);
	assert.equal(w.hasDiagnosticListener(), false);
});

test('container UTF-8 auxiliary files share cache identity with source strings', async () => {
	const w = worker();
	await w.load();
	const source = 'class Helper { String value = "한글"; }';
	await w.run({
		workspaceFiles: [{ path: 'Helper.java', content: new TextEncoder().encode(source) }]
	});
	assert.equal(w.messages.at(-1)?.results, true);
	await w.run({ workspaceFiles: [{ path: 'Helper.java', content: source }] });
	assert.equal(w.counts.compile, 1);
	await w.run({ workspaceFiles: [{ path: 'Helper.java', content: new Uint8Array([255]) }] });
	assert.ok(w.messages.at(-1)?.error);
	assert.equal(w.counts.compile, 1);
});
