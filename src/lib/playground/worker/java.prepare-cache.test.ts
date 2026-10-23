// @vitest-environment node

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as javaOutput from './javaOutput';
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

function worker(
	options: {
		now?: () => number;
		wasmBytes?: number;
		program?: (
			write: (charCode: number) => void,
			debug: ReturnType<typeof javaDebugRuntime.createJavaDebugRuntime>
		) => void;
		onMessage?: (message: any) => void;
	} = {}
) {
	const messages: any[] = [];
	const runs: Array<{ args: string[]; local: number }> = [];
	const counts = {
		compile: 0,
		bridgeCompile: 0,
		generate: 0,
		run: 0,
		initialize: 0,
		engineCompile: 0
	};
	const failure = {
		compile: false,
		bridge: false,
		generate: false,
		output: false,
		engineCompile: false
	};
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
			const bytes = new Uint8Array(options.wasmBytes ?? 1);
			bytes[0] = 9;
			return bytes;
		}
	};
	const runtime = {
		load: async (bytes: Uint8Array, settings?: { installImports?: (imports: any) => void }) => {
			if (bytes[0] === 9 || (bytes as any).app) {
				const imports = { teavmConsole: { putcharStdout: (_charCode: number) => {} } };
				settings?.installImports?.(imports);
				let local = 0;
				return {
					exports: {
						main: (args: string[]) => {
							counts.run++;
							runs.push({ args: [...args], local: ++local });
							options.program?.(
								imports.teavmConsole.putcharStdout,
								context.wasmIdleJavaDebug
							);
						}
					}
				};
			}
			counts.initialize++;
			return { exports: { createCompiler: () => compiler } };
		}
	};
	const context = vm.createContext({
		exports: {},
		performance,
		setTimeout,
		clearTimeout,
		crypto: webcrypto,
		TextDecoder,
		TextEncoder,
		Blob,
		Uint8Array,
		Int8Array,
		Int32Array,
		Error,
		WebAssembly: {
			compile: async (bytes: Uint8Array) => {
				if (bytes[0] === 9) {
					counts.engineCompile++;
					if (failure.engineCompile) throw new Error('engine compilation failed');
					return { app: true };
				}
				return {};
			}
		},
		URL: { createObjectURL: () => 'blob:loader', revokeObjectURL() {} },
		self: {
			addEventListener: (_: string, listener: typeof handler) => {
				handler = listener;
			},
			postMessage: (message: any) => {
				messages.push(message);
				options.onMessage?.(message);
			}
		},
		require: (id: string) => {
			if (id === '../javaDebugBridge') return javaDebugBridge;
			if (id === '../javaDebugSource') return javaDebugSource;
			if (id === '../debugMailbox') return debugMailbox;
			if (id === './javaDebugRuntime') return javaDebugRuntime;
			if (id === '$lib/playground/javaRuntimeErrors') return { prepareJavaExceptionBridge };
			if (id === './javaOutput')
				return {
					createJavaOutput: (emit: (text: string) => void) =>
						javaOutput.createJavaOutput(emit, { now: options.now })
				};
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
	vm.runInContext(compiled, context);
	return {
		counts,
		runs,
		hasDiagnosticListener: () => onDiagnostic !== undefined,
		failure,
		messages,
		load: (baseUrl = '/teavm/', streamCompiler = true) =>
			handler({ data: { load: true, assets: { baseUrl, streamCompiler } } }),
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

test('debug polling publishes elapsed output batches before an output-triggered pause', async () => {
	const mailbox = new debugMailbox.DebugCommandMailbox('Java');
	const pauses: Array<{ reason: string; line: number }> = [];
	let time = 0;
	let output = '';
	let outputDuringLoop = '';
	let outputBeforeDeadline = '';
	let runningLoop = false;
	let pauseRequests = 0;
	const w = worker({
		now: () => time,
		onMessage(message) {
			if (message.javaDebug?.consumed) mailbox.flush();
			const event = message.javaDebug?.event;
			if (event?.type === 'pause') {
				pauses.push({ reason: event.reason, line: event.line });
				mailbox.send(JSON.stringify({ op: 'control', command: 'continue' }));
			}
			if (message.output) {
				output += message.output;
				if (runningLoop && output.includes('loop-ready') && pauseRequests === 0) {
					pauseRequests++;
					mailbox.send(JSON.stringify({ op: 'pause' }));
				}
			}
		},
		program(write, debug) {
			debug.poll('Main.java', 2, 3);
			debug.pause('Main.java', 2, 3, '[["Main","main","Main.java",2]]', 1);
			runningLoop = true;
			for (const char of 'loop-ready\n') write(char.charCodeAt(0));
			// No await or timer advancement: Wasm retains the worker until it pauses.
			for (time = 1; time <= 17; time++) {
				if (debug.poll('Main.java', 4, 18))
					debug.pause('Main.java', 4, 18, '[["Main","main","Main.java",4]]', 1);
				if (time === 15) outputBeforeDeadline = output;
			}
			outputDuringLoop = output;
			runningLoop = false;
		}
	});
	try {
		await w.load();
		await w.run({
			code: 'public class Main {\n  public static void main(String[] args) {\n    System.out.println("loop-ready");\n    while (true) {}\n  }\n}',
			prepare: false,
			debugMode: 'trace',
			javaDebug: {
				buffer: mailbox.buffer,
				sourcePath: '/workspace/Main.java',
				pauseOnEntry: true
			}
		});
		assert.equal(w.messages.find((message) => message.error)?.error, undefined);
		assert.equal(outputBeforeDeadline, 'l');
		assert.equal(outputDuringLoop, 'loop-ready\n');
		assert.equal(pauseRequests, 1);
		assert.deepEqual(pauses, [
			{ reason: 'entry', line: 2 },
			{ reason: 'pause', line: 4 }
		]);
	} finally {
		mailbox.close();
	}
});

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
		initialize: 1,
		engineCompile: 1
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

for (const stage of ['compile', 'bridge', 'generate', 'output', 'engineCompile'] as const) {
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

test('pins one compiled module across warm runs and compiles again after source edits', async () => {
	const w = worker();
	await w.load();
	await w.run();
	await w.run({ prepare: false, stdin: 'one' });
	await w.run({ prepare: false, stdin: 'two' });
	assert.equal(w.counts.engineCompile, 1);
	assert.equal(w.counts.run, 2);
	await w.run({ code: 'class Main { int changed; }' });
	assert.equal(w.counts.engineCompile, 2);
});

test('custom byte-only loaders retain their byte input contract', async () => {
	const w = worker();
	await w.load('/custom/', false);
	await w.run({ prepare: false });
	assert.equal(w.counts.engineCompile, 0);
	assert.equal(w.counts.run, 1);
});

test('debug and ordinary preparation never reuse each other’s compiled artifact', async () => {
	const w = worker();
	await w.load();
	await w.run({ debugMode: 'trace' });
	assert.equal(w.messages.at(-1)?.results, true);
	await w.run({ debugMode: 'none' });
	await w.run({ debugMode: 'trace' });
	await w.run({ debugMode: 'trace' });
	assert.equal(w.counts.compile, 3);
	assert.equal(w.counts.generate, 3);
	assert.equal(w.counts.engineCompile, 3);
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

test('isolated evaluation reuses alternating compiled expressions with fresh instances and arguments', async () => {
	const w = worker();
	await w.load();
	const run = (code: string, args: string[]) =>
		w.run({ code, args, prepare: false, cacheEvaluationArtifacts: true });
	await run('class Main { int a; }', ['7']);
	const diagnostics = JSON.stringify(w.messages.filter((message) => message.diagnostic));
	await run('class Main { int b; }', ['8']);
	await run('class Main { int a; }', ['9']);
	assert.equal(w.counts.compile, 2);
	assert.equal(w.counts.generate, 2);
	assert.equal(w.counts.engineCompile, 2);
	assert.equal(w.counts.run, 3);
	assert.deepEqual(w.runs, [
		{ args: ['7'], local: 1 },
		{ args: ['8'], local: 1 },
		{ args: ['9'], local: 1 }
	]);
	assert.equal(JSON.stringify(w.messages.filter((message) => message.diagnostic)), diagnostics);
});

test('ordinary programs and custom byte-only loaders do not retain multiple evaluation artifacts', async () => {
	for (const custom of [false, true]) {
		const w = worker();
		await w.load('/teavm/', !custom);
		for (const name of ['a', 'b', 'a']) {
			await w.run({ code: `class Main { int ${name}; }`, cacheEvaluationArtifacts: custom });
		}
		assert.equal(w.counts.compile, 3);
		assert.equal(w.counts.engineCompile, custom ? 0 : 3);
	}
});

test('evaluation artifacts evict the least recently used expression after eight entries', async () => {
	const w = worker();
	await w.load();
	const run = (index: number) =>
		w.run({ code: `class Main { int value${index}; }`, cacheEvaluationArtifacts: true });
	for (let index = 0; index < 8; index++) await run(index);
	await run(0);
	await run(8);
	await run(0);
	assert.equal(w.counts.compile, 9);
	await run(1);
	assert.equal(w.counts.compile, 10);
});

test('evaluation artifact retention respects the byte budget and does not retain oversized entries', async () => {
	for (const wasmBytes of [9 * 1024 * 1024, 17 * 1024 * 1024]) {
		const w = worker({ wasmBytes });
		await w.load();
		for (const name of ['a', 'b', 'a']) {
			await w.run({ code: `class Main { int ${name}; }`, cacheEvaluationArtifacts: true });
		}
		assert.equal(w.counts.compile, 3);
		assert.equal(w.messages.at(-1)?.results, true);
	}
});

test('evaluation caches include source path and clear when the compiler runtime changes', async () => {
	const w = worker();
	await w.load();
	const run = (activePath: string) => w.run({ activePath, cacheEvaluationArtifacts: true });
	await run('one/Main.java');
	await run('two/Main.java');
	await run('one/Main.java');
	assert.equal(w.counts.compile, 2);
	await w.load('/another-teavm/');
	await run('one/Main.java');
	assert.equal(w.counts.compile, 3);
});

test('a failed expression is retried without invalidating other successful evaluation artifacts', async () => {
	const w = worker();
	await w.load();
	const run = (name: string) =>
		w.run({ code: `class Main { int ${name}; }`, cacheEvaluationArtifacts: true });
	await run('a');
	w.failure.generate = true;
	await run('b');
	assert.equal(typeof w.messages.at(-1)?.error, 'string');
	w.failure.generate = false;
	await run('a');
	assert.equal(w.counts.compile, 2);
	await run('b');
	assert.equal(w.counts.compile, 3);
	assert.equal(w.messages.at(-1)?.results, true);
});

test('workspace and debug compilations remain ineligible for the evaluation cache', async () => {
	const w = worker();
	await w.load();
	for (const extra of [
		{ workspaceFiles: [{ path: 'Helper.java', content: 'class Helper {}' }] },
		{ debugMode: 'trace' }
	]) {
		const before = w.counts.compile;
		for (const name of ['a', 'b', 'a'])
			await w.run({
				code: `class Main { int ${name}; }`,
				cacheEvaluationArtifacts: true,
				...extra
			});
		assert.equal(w.counts.compile - before, 3);
		assert.equal(w.messages.at(-1)?.results, true);
	}
});
