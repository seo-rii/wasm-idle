import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushQueuedStdin } from '$lib/playground/stdinBuffer';

const mocks = vi.hoisted(() => ({
	loadVerifiedLispRuntimeAssets: vi.fn()
}));

vi.mock('$lib/playground/lispAssets', () => ({
	loadVerifiedLispRuntimeAssets: mocks.loadVerifiedLispRuntimeAssets
}));

const runtimeConfig = Object.freeze({
	moduleUrl: 'https://static.example.com/wasm-lisp/index.js',
	manifestUrl: 'https://static.example.com/wasm-lisp/runtime-manifest.v2.json',
	manifestFingerprint: 'a'.repeat(64)
});

function configureRuntime(options: {
	compile: (options: any) => Promise<any>;
	execute: (artifact: any, options?: any) => Promise<any>;
}) {
	const compilerModule = { instantiate: vi.fn() };
	const compilerCoreModules = {
		'puppyc.core.wasm': {} as WebAssembly.Module,
		'puppyc.core2.wasm': {} as WebAssembly.Module
	};
	const createLispCompiler = vi.fn(async (injected) => {
		(globalThis as any).__lastCompilerInjection = injected;
		return { compile: options.compile };
	});
	mocks.loadVerifiedLispRuntimeAssets.mockResolvedValue({
		module: {
			createLispCompiler,
			executeBrowserLispArtifact: options.execute
		},
		compilerModule,
		compilerCoreModules,
		manifest: { profileId: 'fixture' }
	});
	return { compilerModule, compilerCoreModules, createLispCompiler };
}

describe('Lisp worker', () => {
	beforeEach(() => {
		vi.resetModules();
		mocks.loadVerifiedLispRuntimeAssets.mockReset();
		(globalThis as any).self = globalThis as any;
		(globalThis as any).document = undefined;
		(globalThis as any).postMessage = vi.fn();
		(globalThis as any).__lastCompileOptions = undefined;
		(globalThis as any).__lastCompilerInjection = undefined;
		(globalThis as any).__lastExecution = undefined;
		(globalThis as any).__lastStdin = undefined;
	});

	it('loads the verified compiler graph and runs the returned artifact', async () => {
		const injection = configureRuntime({
			async compile(options) {
				(globalThis as any).__lastCompileOptions = options;
				return {
					stdout: 'compile log\n',
					success: true,
					diagnostics: [
						{
							fileName: options.fileName,
							lineNumber: 1,
							columnNumber: 2,
							severity: 'warning',
							message: 'demo warning'
						}
					],
					artifact: { fileName: options.fileName, source: options.code }
				};
			},
			async execute(artifact, options = {}) {
				(globalThis as any).__lastExecution = { artifact, options };
				options.stdout?.('hi\n');
				return { exitCode: 0, stdout: 'hi\n', stderr: '' };
			}
		});

		await import('./lisp');
		await (globalThis as any).self.onmessage({ data: { load: true, runtimeConfig } });
		await (globalThis as any).self.onmessage({
			data: {
				code: '(display "hi")',
				prepare: false,
				buffer: new SharedArrayBuffer(1024),
				args: ['one'],
				activePath: 'main.scm',
				workspaceFiles: [{ path: 'lib.scm', content: '(define x 1)' }],
				log: true
			}
		});

		expect(mocks.loadVerifiedLispRuntimeAssets).toHaveBeenCalledWith(runtimeConfig);
		expect((globalThis as any).__lastCompilerInjection).toEqual({
			compilerModule: injection.compilerModule,
			compilerCoreModules: injection.compilerCoreModules
		});
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({ load: true });
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({
			diagnostic: {
				fileName: 'main.scm',
				lineNumber: 1,
				columnNumber: 2,
				severity: 'warning',
				message: 'demo warning'
			}
		});
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({ output: 'compile log\n' });
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({ output: 'hi\n' });
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({ results: true });
		expect((globalThis as any).__lastCompileOptions).toEqual({
			code: '(display "hi")',
			fileName: 'main.scm',
			files: [{ path: 'lib.scm', content: '(define x 1)' }],
			log: true
		});
		expect((globalThis as any).__lastExecution.options.args).toEqual(['one']);
		expect((globalThis as any).__lastExecution.options.env).toEqual({ USER: 'jungol' });
	});

	it('reads stdin from the shared buffer when the verified runtime requests input', async () => {
		configureRuntime({
			async compile(options) {
				return { success: true, diagnostics: [], artifact: { source: options.code } };
			},
			async execute(_artifact, options = {}) {
				const chunk = options.stdin?.() || '';
				(globalThis as any).__lastStdin = chunk;
				options.stdout?.(chunk);
				return { exitCode: 0, stdout: chunk, stderr: '' };
			}
		});
		const buffer = new SharedArrayBuffer(1024);
		const queuedInput = ['5\n'];
		(globalThis as any).postMessage = vi.fn((message: any) => {
			if (message?.buffer) flushQueuedStdin(queuedInput, buffer);
		});

		await import('./lisp');
		await (globalThis as any).self.onmessage({ data: { load: true, runtimeConfig } });
		await (globalThis as any).self.onmessage({
			data: {
				code: '(display (read-char))',
				prepare: false,
				buffer,
				activePath: 'main.scm'
			}
		});

		expect((globalThis as any).postMessage).toHaveBeenCalledWith({ buffer: true });
		expect((globalThis as any).__lastStdin).toBe('5\n');
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({ output: '5\n' });
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({ results: true });
	});

	it('reports compiler failures after forwarding diagnostics', async () => {
		configureRuntime({
			async compile() {
				return {
					success: false,
					stderr: 'error: bad scheme',
					diagnostics: [
						{
							fileName: 'bad.scm',
							lineNumber: 1,
							severity: 'error',
							message: 'bad scheme'
						}
					]
				};
			},
			async execute() {
				throw new Error('should not execute');
			}
		});

		await import('./lisp');
		await (globalThis as any).self.onmessage({ data: { load: true, runtimeConfig } });
		await (globalThis as any).self.onmessage({
			data: {
				code: '(bad)',
				prepare: false,
				buffer: new SharedArrayBuffer(1024),
				activePath: 'bad.scm'
			}
		});

		expect((globalThis as any).postMessage).toHaveBeenCalledWith({
			diagnostic: {
				fileName: 'bad.scm',
				lineNumber: 1,
				columnNumber: undefined,
				endColumnNumber: undefined,
				severity: 'error',
				message: 'bad scheme'
			}
		});
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({
			error: 'error: bad scheme'
		});
	});
});
