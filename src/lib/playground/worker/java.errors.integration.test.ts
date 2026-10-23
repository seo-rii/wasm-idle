// @vitest-environment node

import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { gunzipSync } from 'node:zlib';
import ts from 'typescript';
import { beforeAll, describe, expect, it } from 'vitest';
import { webcrypto } from 'node:crypto';
import * as javaDebugBridge from '../javaDebugBridge';
import * as javaDebugSource from '../javaDebugSource';
import * as javaDebugRuntime from './javaDebugRuntime';
import * as debugMailbox from '../debugMailbox';
import * as javaRuntimeErrors from '../javaRuntimeErrors';
import * as javaRuntimeStdin from '../javaRuntimeStdin';
import * as javaSource from '../javaSource';
import * as stdinBuffer from '../stdinBuffer';
import * as javaStreaming from './javaStreaming';

interface WorkerMessage {
	load?: boolean;
	output?: string;
	error?: string;
	results?: boolean;
	mainClass?: string;
	diagnostic?: { fileName: string; severity: string; message: string };
}

const assetRoot = new URL('../../../../static/teavm/', import.meta.url);
const workerSource = readFileSync(new URL('./java.ts', import.meta.url), 'utf8');
const compiledWorker = ts.transpileModule(workerSource, {
	compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;

function readAsset(name: string) {
	try {
		return new Uint8Array(readFileSync(new URL(name, assetRoot)));
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
		return new Uint8Array(gunzipSync(readFileSync(new URL(`${name}.gz`, assetRoot))));
	}
}

async function runWithNativeStacks<T>(operation: () => Promise<T>) {
	const prepareStackTrace = Object.getOwnPropertyDescriptor(Error, 'prepareStackTrace');
	const stackTraceLimit = Object.getOwnPropertyDescriptor(Error, 'stackTraceLimit');
	try {
		// Vitest's stack formatter drops Wasm frames. TeaVM parses native V8 stack
		// text, so restore that format only while invoking the real worker.
		Reflect.deleteProperty(Error, 'prepareStackTrace');
		Error.stackTraceLimit = Math.max(Error.stackTraceLimit || 0, 10);
		return await operation();
	} finally {
		for (const [name, descriptor] of [
			['prepareStackTrace', prepareStackTrace],
			['stackTraceLimit', stackTraceLimit]
		] as const) {
			if (descriptor) Object.defineProperty(Error, name, descriptor);
			else Reflect.deleteProperty(Error, name);
		}
	}
}

async function createRealWorker() {
	const runtime = await import(new URL('compiler.wasm-runtime.js', assetRoot).href);
	const messages: WorkerMessage[] = [];
	const counts = { compile: 0, generate: 0, execute: 0 };
	let handler!: (event: { data: Record<string, unknown> }) => Promise<void>;
	const runtimeBridge = {
		async load(bytes: Uint8Array, options: object) {
			const loaded = await runtime.load(bytes, options);
			if (typeof loaded.exports.createCompiler !== 'function') {
				counts.execute++;
				return loaded;
			}
			return {
				...loaded,
				exports: {
					createCompiler() {
						const compiler = loaded.exports.createCompiler();
						return new Proxy(compiler, {
							get(target, key) {
								const value = Reflect.get(target, key, target);
								if (typeof value !== 'function') return value;
								return (...args: unknown[]) => {
									if (key === 'compile') counts.compile++;
									if (key === 'generateWebAssembly') counts.generate++;
									return value.apply(target, args);
								};
							}
						});
					}
				}
			};
		}
	};
	// Only asset and message transport are replaced. The compiler, Java class library,
	// Wasm runtime, deobfuscator, and source/exception helpers are the real implementations.
	vm.runInNewContext(compiledWorker, {
		exports: {},
		crypto: webcrypto,
		TextDecoder,
		TextEncoder,
		Blob,
		Uint8Array,
		Int8Array,
		Int32Array,
		ArrayBuffer,
		Error,
		WebAssembly,
		console,
		URL: { createObjectURL: () => 'blob:local-teavm', revokeObjectURL() {} },
		self: {
			addEventListener: (_type: string, listener: typeof handler) => {
				handler = listener;
			},
			postMessage: (message: WorkerMessage) => messages.push(structuredClone(message))
		},
		require(id: string) {
			if (id === '../javaDebugBridge') return javaDebugBridge;
			if (id === '../javaDebugSource') return javaDebugSource;
			if (id === '../debugMailbox') return debugMailbox;
			if (id === './javaDebugRuntime') return javaDebugRuntime;
			if (id === 'blob:local-teavm') return runtimeBridge;
			if (id === './javaStreaming') return javaStreaming;
			if (id === '$lib/playground/javaRuntimeErrors') return javaRuntimeErrors;
			if (id === '$lib/playground/javaRuntimeStdin') return javaRuntimeStdin;
			if (id === '$lib/playground/javaSource') return javaSource;
			if (id === '$lib/playground/stdinBuffer') return stdinBuffer;
			if (id === '$lib/playground/worker/assets') {
				return {
					configureWorkerRuntimeAssets() {},
					handleWorkerAssetMessage: () => false,
					loadWorkerRuntimeAsset: async (name: string) => ({ bytes: readAsset(name) })
				};
			}
			throw new Error(`Unexpected worker dependency: ${id}`);
		}
	});
	await runWithNativeStacks(() =>
		handler({ data: { load: true, assets: { baseUrl: '/teavm/' } } })
	);
	expect(messages).toEqual([{ load: true }]);
	return {
		counts,
		async run(code: string, options: Record<string, unknown> = {}) {
			messages.length = 0;
			await runWithNativeStacks(() =>
				handler({
					data: {
						code,
						stdin: '',
						hasExplicitStdin: true,
						args: [],
						buffer: new ArrayBuffer(1024),
						...options
					}
				})
			);
			return messages.slice();
		}
	};
}

function failingProgram(exception: string) {
	return `public class Main {
    static void fail() {
        throw ${exception};
    }
    public static void main(String[] args) {
        fail();
    }
}`;
}

function errorFrom(messages: WorkerMessage[]) {
	const errors = messages.filter((message) => Object.hasOwn(message, 'error'));
	expect(errors).toHaveLength(1);
	expect(messages.at(-1)).toBe(errors[0]);
	expect(messages.some((message) => message.results)).toBe(false);
	const error = errors[0].error!;
	expect(error).not.toContain('(could not fetch message)');
	expect(error).not.toContain('FakeClass');
	expect(error).not.toContain('fakeMethod');
	return error;
}

const outputFrom = (messages: WorkerMessage[]) =>
	messages.map((message) => message.output || '').join('');

describe('Java worker exception reporting with the pinned TeaVM runtime', () => {
	let worker: Awaited<ReturnType<typeof createRealWorker>>;
	beforeAll(async () => {
		worker = await createRealWorker();
	}, 60_000);

	it.each([
		{
			name: 'an explicit detail message',
			exception: 'new IllegalArgumentException("bad input")',
			header: 'java.lang.IllegalArgumentException: bad input'
		},
		{
			name: 'a null detail message',
			exception: 'new RuntimeException()',
			header: 'java.lang.RuntimeException'
		},
		{
			name: 'an empty detail message',
			exception: 'new RuntimeException("")',
			header: 'java.lang.RuntimeException: '
		},
		{
			name: 'a Korean detail message',
			exception: 'new IllegalArgumentException("잘못된 입력입니다")',
			header: 'java.lang.IllegalArgumentException: 잘못된 입력입니다'
		}
	])(
		'preserves class and source frames for $name',
		async ({ exception, header }) => {
			const error = errorFrom(await worker.run(failingProgram(exception)));

			expect(error.split('\n')[0]).toBe(header);
			expect(error).toContain('\tat Main.fail(Main.java:3)');
			expect(error).toContain('\tat Main.main(Main.java:6)');
		},
		60_000
	);

	it('preserves a multiline detail message and chained Java cause', async () => {
		const error = errorFrom(
			await worker.run(
				failingProgram(
					'new IllegalStateException("first line\\nsecond line", new IllegalArgumentException("inner"))'
				)
			)
		);

		expect(error).toContain('java.lang.IllegalStateException: first line\nsecond line\n');
		expect(error).toContain('\nCaused by: java.lang.IllegalArgumentException: inner\n');
		expect(error).toContain('\tat Main.fail(Main.java:3)');
	}, 60_000);

	it('reports the actual custom Throwable class', async () => {
		const messages = await worker.run(`public class Main {
    static class Problem extends RuntimeException {
        Problem() { super("custom detail"); }
    }
    public static void main(String[] args) {
        throw new Problem();
    }
}`);
		const error = errorFrom(messages);
		expect(error).toMatch(/^Main\$Problem: custom detail\n/);
		expect(error).toContain('\tat Main.main(Main.java:6)');
	}, 60_000);

	it('deobfuscates a caught printStackTrace without turning it into a failed run', async () => {
		const messages = await worker.run(`public class Main {
    public static void main(String[] args) {
        try { throw new RuntimeException("caught"); }
        catch (Throwable error) { error.printStackTrace(); }
    }
}`);
		const output = outputFrom(messages);
		expect(messages.some((message) => Object.hasOwn(message, 'error'))).toBe(false);
		expect(messages.at(-1)).toEqual({ results: true, mainClass: 'Main' });
		expect(output).toContain('java.lang.RuntimeException: caught\n');
		expect(output).toContain('\tat Main.main(Main.java:3)');
		expect(output).not.toMatch(/FakeClass|fakeMethod/);
	}, 60_000);

	it('keeps package-private entry points, arguments, and secondary source locations', async () => {
		const messages = await worker.run(
			`package demo;

class Main {
    public static void main(String[] args) {
        Helper.fail(args[0]);
    }
}`,
			{
				activePath: 'demo/Main.java',
				args: ['secondary file'],
				workspaceFiles: [
					{
						path: 'demo/Helper.java',
						content: `package demo;

final class Helper {
    static void fail(String detail) {
        throw new UnsupportedOperationException(detail);
    }
}`
					}
				]
			}
		);
		const error = errorFrom(messages);
		expect(error).toMatch(/^java.lang.UnsupportedOperationException: secondary file\n/);
		expect(error).toContain('\tat demo.Helper.fail(Helper.java:5)');
		expect(error).toContain('\tat demo.Main.main(Main.java:5)');
	}, 60_000);

	it('flushes pending stdout and stderr before reporting the exception', async () => {
		const messages = await worker.run(`public class Main {
    public static void main(String[] args) {
        System.out.print("prompt> ");
        System.err.print("경고: ");
        throw new RuntimeException("failure");
    }
}`);
		expect(errorFrom(messages)).toContain('java.lang.RuntimeException: failure');
		expect(outputFrom(messages)).toBe('prompt> 경고: ');
	}, 60_000);

	it('avoids generated class and formatter names already present in user source', async () => {
		const messages = await worker.run(`public class Main {
    static String wasmIdleFormatJavaException() { return "user method"; }
    public static void main(String[] args) { throw new RuntimeException("user error"); }
}
class WasmIdleJavaEntryPoint {}`);

		expect(errorFrom(messages)).toMatch(/^java.lang.RuntimeException: user error\n/);
	}, 60_000);

	it.each(['java', 'org'])(
		'accepts a user class named %s without shadowing generated bridge dependencies',
		async (name) => {
			const messages = await worker.run(`public class Main {
    public static void main(String[] args) { throw new RuntimeException("${name} class"); }
}
class ${name} {}`);

			expect(errorFrom(messages)).toMatch(
				new RegExp(`^java\\.lang\\.RuntimeException: ${name} class\\n`)
			);
		},
		60_000
	);

	it('accepts a class with the same name as its package', async () => {
		const messages = await worker.run(
			`package demo;
public class Main {
    public static void main(String[] args) { throw new RuntimeException("package name"); }
}
class demo {}`,
			{ activePath: 'demo/Main.java' }
		);

		const error = errorFrom(messages);
		expect(error).toMatch(/^java.lang.RuntimeException: package name\n/);
		expect(error).toContain('\tat demo.Main.main(Main.java:3)');
	}, 60_000);

	it.each(['String', 'Throwable', 'JSExceptions'])(
		'accepts an entry class named %s',
		async (name) => {
			const messages = await worker.run(`public class ${name} {
    public static void main(java.lang.String[] args) {
        throw new RuntimeException("${name} entry");
    }
}`);
			const error = errorFrom(messages);
			expect(error.split('\n')[0]).toBe(`java.lang.RuntimeException: ${name} entry`);
			expect(error).toContain(`\tat ${name}.main(${name}.java:3)`);
		},
		60_000
	);

	it('reserves generated class and export names written with Java Unicode escapes', async () => {
		const messages = await worker.run(String.raw`public class Main {
    @org.teavm.jso.JSExport
    public static String \u0077asmIdleFormatJavaException() { return "user export"; }
    public static void main(String[] args) { throw new RuntimeException("escaped names"); }
}
class \u0057asmIdleJavaEntryPoint {}
class \u0057asmIdleJavaExceptionBridge {}`);

		const error = errorFrom(messages);
		expect(error).toMatch(/^java.lang.RuntimeException: escaped names\n/);
		expect(error).toContain('\tat Main.main(Main.java:4)');
	}, 60_000);

	it.each(['WasmIdleJavaEntryPoint$Program', 'WasmIdleJavaExceptionBridge$Program'])(
		'preserves a user class with the compiled nested-class name %s',
		async (name) => {
			const messages = await worker.run(`public class Main {
    public static void main(String[] args) { throw new RuntimeException(${name}.detail()); }
}
class ${name} {
    static String detail() { return "user nested name"; }
}`);

			expect(errorFrom(messages)).toMatch(/^java.lang.RuntimeException: user nested name\n/);
		},
		60_000
	);

	it('keeps native Wasm trap details when there is no Java Throwable to format', async () => {
		const messages = await worker.run(`public class Main {
    public static void main(String[] args) {
        int zero = args.length;
        System.out.println(1 / zero);
    }
}`);

		expect(errorFrom(messages)).toMatch(/divide by zero/i);
	}, 60_000);

	it('validates a missing user main before compiling the exception launcher', async () => {
		const before = { ...worker.counts };
		const messages = await worker.run('public class Main {}');

		expect(errorFrom(messages)).toBe('Main method not found');
		expect(worker.counts.compile - before.compile).toBe(1);
		expect(worker.counts.generate).toBe(before.generate);
	}, 60_000);

	it('keeps original javac diagnostics when the user source is invalid', async () => {
		const before = { ...worker.counts };
		const messages = await worker.run(`public class Main {
    public static void main(String[] args) { int value = ; }
}`);

		expect(errorFrom(messages)).toContain('Main.java:2');
		expect(messages.some((message) => message.diagnostic?.fileName === 'Main.java')).toBe(true);
		expect(worker.counts.compile - before.compile).toBe(1);
		expect(worker.counts.generate).toBe(before.generate);
	}, 60_000);

	it('reuses prepared artifacts for ordinary successful runs with changed arguments', async () => {
		const code = `public class Main {
    public static void main(String[] args) { System.out.println("argument=" + args[0]); }
}`;
		const before = { ...worker.counts };
		const prepared = await worker.run(code, { prepare: true });
		expect(prepared.at(-1)).toEqual({ results: true });
		expect(outputFrom(prepared)).toBe('');
		expect(prepared.filter((message) => message.diagnostic)).toEqual([]);
		expect(worker.counts.execute).toBe(before.execute);
		expect(worker.counts.compile - before.compile).toBe(2);
		expect(worker.counts.generate - before.generate).toBe(1);

		for (const argument of ['first', 'second']) {
			const messages = await worker.run(code, { args: [argument] });
			expect(messages.at(-1)).toEqual({ results: true, mainClass: 'Main' });
			expect(outputFrom(messages)).toBe(`argument=${argument}\n`);
			expect(messages.filter((message) => message.diagnostic)).toEqual([]);
		}
		expect(worker.counts.compile - before.compile).toBe(2);
		expect(worker.counts.generate - before.generate).toBe(1);
		expect(worker.counts.execute - before.execute).toBe(2);
	}, 60_000);
});
