import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushQueuedStdin } from '$lib/playground/stdinBuffer';

async function createMockLispRuntimeModule(source: string) {
	return `data:text/javascript;base64,${Buffer.from(source, 'utf8').toString('base64')}`;
}

describe('Lisp worker', () => {
	beforeEach(() => {
		vi.resetModules();
		(globalThis as any).self = globalThis as any;
		(globalThis as any).document = undefined;
		(globalThis as any).postMessage = vi.fn();
		(globalThis as any).__lastCompileOptions = undefined;
		(globalThis as any).__lastExecution = undefined;
		(globalThis as any).__lastStdin = undefined;
	});

	it('loads a wasm-lisp-style compiler module and runs the returned artifact', async () => {
		const moduleUrl = await createMockLispRuntimeModule(`
			export async function createLispCompiler() {
				return {
					async compile(options) {
						globalThis.__lastCompileOptions = options;
						return {
							stdout: 'compile log\\n',
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
							artifact: {
								component: new Uint8Array([0, 97, 115, 109]),
								format: 'component',
								fileName: options.fileName,
								source: options.code,
								compiler: 'puppy-scheme'
							}
						};
					}
				};
			}

			export async function executeBrowserLispArtifact(artifact, options = {}) {
				globalThis.__lastExecution = { artifact, options };
				options.stdout?.('hi\\n');
				return {
					exitCode: 0,
					stdout: 'hi\\n',
					stderr: ''
				};
			}

			export default createLispCompiler;
		`);

		await import('./lisp');
		await (globalThis as any).self.onmessage({
			data: {
				load: true,
				moduleUrl
			}
		});
		await Promise.resolve();

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
		await Promise.resolve();

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

	it('reads stdin from the shared buffer when executeBrowserLispArtifact requests input', async () => {
		const moduleUrl = await createMockLispRuntimeModule(`
			export async function createLispCompiler() {
				return {
					async compile(options) {
						return {
							success: true,
							diagnostics: [],
							artifact: {
								component: new Uint8Array([0, 97, 115, 109]),
								format: 'component',
								fileName: options.fileName,
								source: options.code,
								compiler: 'puppy-scheme'
							}
						};
					}
				};
			}

			export async function executeBrowserLispArtifact(_artifact, options = {}) {
				const chunk = options.stdin?.() || '';
				globalThis.__lastStdin = chunk;
				options.stdout?.(chunk);
				return {
					exitCode: 0,
					stdout: chunk,
					stderr: ''
				};
			}

			export default createLispCompiler;
		`);
		const buffer = new SharedArrayBuffer(1024);
		const queuedInput = ['5\n'];

		(globalThis as any).postMessage = vi.fn((message: any) => {
			if (message?.buffer) {
				flushQueuedStdin(queuedInput, buffer);
			}
		});

		await import('./lisp');
		await (globalThis as any).self.onmessage({
			data: {
				load: true,
				moduleUrl
			}
		});
		await Promise.resolve();
		await (globalThis as any).self.onmessage({
			data: {
				code: '(display (read-char))',
				prepare: false,
				buffer,
				activePath: 'main.scm'
			}
		});
		await Promise.resolve();

		expect((globalThis as any).postMessage).toHaveBeenCalledWith({ buffer: true });
		expect((globalThis as any).__lastStdin).toBe('5\n');
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({ output: '5\n' });
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({ results: true });
	});

	it('reports compiler failures as worker errors after forwarding diagnostics', async () => {
		const moduleUrl = await createMockLispRuntimeModule(`
			export async function createLispCompiler() {
				return {
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
					}
				};
			}

			export async function executeBrowserLispArtifact() {
				throw new Error('should not execute');
			}

			export default createLispCompiler;
		`);

		await import('./lisp');
		await (globalThis as any).self.onmessage({
			data: {
				load: true,
				moduleUrl
			}
		});
		await Promise.resolve();
		await (globalThis as any).self.onmessage({
			data: {
				code: '(bad)',
				prepare: false,
				buffer: new SharedArrayBuffer(1024),
				activePath: 'bad.scm'
			}
		});
		await Promise.resolve();

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
