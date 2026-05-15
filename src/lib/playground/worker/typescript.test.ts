import { beforeEach, describe, expect, it, vi } from 'vitest';

import { flushQueuedStdin } from '$lib/playground/stdinBuffer';

async function createMockTypeScriptRuntimeModule(source: string) {
	return `data:text/javascript;base64,${Buffer.from(source, 'utf8').toString('base64')}`;
}

describe('TypeScript worker', () => {
	beforeEach(() => {
		vi.resetModules();
		(globalThis as any).self = globalThis as any;
		(globalThis as any).document = undefined;
		(globalThis as any).postMessage = vi.fn();
		(globalThis as any).__lastCompileOptions = undefined;
		(globalThis as any).__lastExecution = undefined;
		(globalThis as any).__lastStdin = undefined;
	});

	it('loads a wasm-typescript-style module and executes the compiled artifact', async () => {
		const moduleUrl = await createMockTypeScriptRuntimeModule(`
			export async function createTypeScriptCompiler() {
				return {
					async compile(options) {
						globalThis.__lastCompileOptions = options;
						return {
							stdout: 'build log\\n',
							success: true,
							diagnostics: [
								{
									fileName: 'main.ts',
									lineNumber: 1,
									columnNumber: 1,
									severity: 'warning',
									message: 'demo warning'
								}
							],
							artifact: {
								javascript: 'console.log("hi")',
								language: options.language,
								fileName: options.fileName
							}
						};
					}
				};
			}

			export async function executeBrowserTypeScriptArtifact(artifact, options = {}) {
				globalThis.__lastExecution = { artifact, options };
				options.stdout?.('hi\\n');
				return {
					exitCode: 0,
					stdout: 'hi\\n',
					stderr: ''
				};
			}

			export default createTypeScriptCompiler;
		`);

		await import('./typescript');
		await (globalThis as any).self.onmessage({
			data: {
				load: true,
				moduleUrl
			}
		});
		await Promise.resolve();

		await (globalThis as any).self.onmessage({
			data: {
				code: 'const value: number = 1;',
				prepare: false,
				buffer: new SharedArrayBuffer(1024),
				args: ['one'],
				language: 'typescript',
				activePath: 'main.ts',
				log: true
			}
		});
		await Promise.resolve();

		expect((globalThis as any).postMessage).toHaveBeenCalledWith({ load: true });
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({
			diagnostic: {
				fileName: 'main.ts',
				lineNumber: 1,
				columnNumber: 1,
				severity: 'warning',
				message: 'demo warning'
			}
		});
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({ output: 'build log\n' });
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({ output: 'hi\n' });
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({ results: true });
		expect((globalThis as any).__lastCompileOptions.language).toBe('typescript');
		expect((globalThis as any).__lastCompileOptions.fileName).toBe('main.ts');
		expect((globalThis as any).__lastExecution.options.args).toEqual(['one']);
		expect((globalThis as any).__lastExecution.options.env).toEqual({ USER: 'jungol' });
	});

	it('reads injected stdin without waiting for terminal input', async () => {
		const moduleUrl = await createMockTypeScriptRuntimeModule(`
			export async function createTypeScriptCompiler() {
				return {
					async compile(options) {
						return {
							success: true,
							artifact: {
								javascript: options.code,
								language: options.language,
								fileName: options.fileName
							}
						};
					}
				};
			}

			export async function executeBrowserTypeScriptArtifact(_artifact, options = {}) {
				const first = options.stdin?.();
				const second = options.stdin?.();
				globalThis.__lastStdin = [first, second];
				options.stdout?.(String(first ?? ''));
				return {
					exitCode: 0,
					stdout: String(first ?? ''),
					stderr: ''
				};
			}

			export default createTypeScriptCompiler;
		`);

		await import('./typescript');
		await (globalThis as any).self.onmessage({
			data: {
				load: true,
				moduleUrl
			}
		});
		await Promise.resolve();

		await (globalThis as any).self.onmessage({
			data: {
				code: 'console.log(1)',
				prepare: false,
				buffer: new SharedArrayBuffer(1024),
				stdin: 'injected\n',
				language: 'javascript',
				activePath: 'main.js'
			}
		});
		await Promise.resolve();

		expect((globalThis as any).postMessage).not.toHaveBeenCalledWith({ buffer: true });
		expect((globalThis as any).__lastStdin).toEqual(['injected\n', null]);
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({ output: 'injected\n' });
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({ results: true });
	});

	it('reads terminal stdin from the shared buffer when no stdin is injected', async () => {
		const moduleUrl = await createMockTypeScriptRuntimeModule(`
			export async function createTypeScriptCompiler() {
				return {
					async compile(options) {
						return {
							success: true,
							artifact: {
								javascript: options.code,
								language: options.language,
								fileName: options.fileName
							}
						};
					}
				};
			}

			export async function executeBrowserTypeScriptArtifact(_artifact, options = {}) {
				const chunk = options.stdin?.() || '';
				globalThis.__lastStdin = chunk;
				options.stdout?.(chunk);
				return {
					exitCode: 0,
					stdout: chunk,
					stderr: ''
				};
			}

			export default createTypeScriptCompiler;
		`);
		const buffer = new SharedArrayBuffer(1024);
		const queuedInput = ['5\n'];

		(globalThis as any).postMessage = vi.fn((message: any) => {
			if (message?.buffer) {
				flushQueuedStdin(queuedInput, buffer);
			}
		});

		await import('./typescript');
		await (globalThis as any).self.onmessage({
			data: {
				load: true,
				moduleUrl
			}
		});
		await Promise.resolve();
		await (globalThis as any).self.onmessage({
			data: {
				code: 'console.log(1)',
				prepare: false,
				buffer,
				language: 'javascript',
				activePath: 'main.js'
			}
		});
		await Promise.resolve();

		expect((globalThis as any).postMessage).toHaveBeenCalledWith({ buffer: true });
		expect((globalThis as any).__lastStdin).toBe('5\n');
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({ output: '5\n' });
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({ results: true });
	});
});
