import { beforeEach, describe, expect, it, vi } from 'vitest';

import { flushQueuedStdin } from '$lib/playground/stdinBuffer';

async function createMockGoRuntimeModule(source: string) {
	return `data:text/javascript;base64,${Buffer.from(source, 'utf8').toString('base64')}`;
}

describe('Go worker', () => {
	beforeEach(() => {
		vi.resetModules();
		(globalThis as any).self = globalThis as any;
		(globalThis as any).document = undefined;
		(globalThis as any).postMessage = vi.fn();
		(globalThis as any).__lastCompileOptions = undefined;
		(globalThis as any).__lastExecution = undefined;
		(globalThis as any).__lastStdin = undefined;
	});

	it('loads a wasm-go-style compiler module and runs the returned artifact through executeBrowserGoArtifact', async () => {
		const compilerModuleUrl = await createMockGoRuntimeModule(`
			export async function createGoCompiler() {
				return {
					async compile(options) {
						globalThis.__lastCompileOptions = options;
						return {
							stdout: 'build log\\n',
							success: true,
							diagnostics: [
								{
									lineNumber: 1,
									columnNumber: 1,
									severity: 'warning',
									message: 'demo warning'
								}
							],
							artifact: {
								wasm: new Uint8Array([0, 97, 115, 109]),
								bytes: new Uint8Array([0, 97, 115, 109]),
								target: options.target,
								format: 'wasi-core-wasm'
							}
						};
					}
				};
			}

			export async function executeBrowserGoArtifact(artifact, options = {}) {
				globalThis.__lastExecution = { artifact, options };
				options.stdout?.('hi\\n');
				return {
					exitCode: 0,
					stdout: 'hi\\n',
					stderr: ''
				};
			}

			export default createGoCompiler;
		`);

		await import('./go');
		await (globalThis as any).self.onmessage({
			data: {
				load: true,
				compilerUrl: compilerModuleUrl
			}
		});
		await Promise.resolve();

		await (globalThis as any).self.onmessage({
			data: {
				code: 'package main\nfunc main() {}',
				prepare: false,
				buffer: new SharedArrayBuffer(1024),
				args: ['one'],
				log: true
			}
		});
		await Promise.resolve();

		expect((globalThis as any).postMessage).toHaveBeenCalledWith({ load: true });
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({
			diagnostic: {
				fileName: null,
				lineNumber: 1,
				columnNumber: 1,
				severity: 'warning',
				message: 'demo warning'
			}
		});
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({ output: 'build log\n' });
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({ output: 'hi\n' });
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({ results: true });
		expect((globalThis as any).__lastCompileOptions.target).toBe('wasip1/wasm');
		expect((globalThis as any).__lastExecution.artifact.target).toBe('wasip1/wasm');
		expect((globalThis as any).__lastExecution.options.args).toEqual(['one']);
		expect((globalThis as any).__lastExecution.options.env).toEqual({ USER: 'jungol' });
	});

	it('reads stdin from the shared buffer when executeBrowserGoArtifact requests input', async () => {
		const compilerModuleUrl = await createMockGoRuntimeModule(`
			export async function createGoCompiler() {
				return {
					async compile(options) {
						return {
							success: true,
							artifact: {
								wasm: new Uint8Array([0, 97, 115, 109]),
								bytes: new Uint8Array([0, 97, 115, 109]),
								target: options.target,
								format: 'wasi-core-wasm'
							}
						};
					}
				};
			}

			export async function executeBrowserGoArtifact(_artifact, options = {}) {
				const chunk = options.stdin?.() || '';
				globalThis.__lastStdin = chunk;
				options.stdout?.(chunk);
				return {
					exitCode: 0,
					stdout: chunk,
					stderr: ''
				};
			}

			export default createGoCompiler;
		`);
		const buffer = new SharedArrayBuffer(1024);
		const queuedInput = ['5\n'];

		(globalThis as any).postMessage = vi.fn((message: any) => {
			if (message?.buffer) {
				flushQueuedStdin(queuedInput, buffer);
			}
		});

		await import('./go');
		await (globalThis as any).self.onmessage({
			data: {
				load: true,
				compilerUrl: compilerModuleUrl
			}
		});
		await Promise.resolve();
		await (globalThis as any).self.onmessage({
			data: {
				code: 'package main\nfunc main() {}',
				prepare: false,
				buffer
			}
		});
		await Promise.resolve();

		expect((globalThis as any).postMessage).toHaveBeenCalledWith({ buffer: true });
		expect((globalThis as any).__lastStdin).toBe('5\n');
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({ output: '5\n' });
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({ results: true });
	});

	it('forwards structured compile progress back to the UI worker host', async () => {
		const compilerModuleUrl = await createMockGoRuntimeModule(`
			export async function createGoCompiler() {
				return {
					async compile(options) {
						options.onProgress?.({
							stage: 'compile',
							completed: 3,
							total: 10,
							percent: 34,
							message: 'compiling'
						});
						return {
							success: true,
							artifact: {
								wasm: new Uint8Array([0, 97, 115, 109]),
								bytes: new Uint8Array([0, 97, 115, 109]),
								target: options.target,
								format: 'wasi-core-wasm'
							}
						};
					}
				};
			}

			export async function executeBrowserGoArtifact() {
				return {
					exitCode: 0,
					stdout: '',
					stderr: ''
				};
			}

			export default createGoCompiler;
		`);

		await import('./go');
		await (globalThis as any).self.onmessage({
			data: {
				load: true,
				compilerUrl: compilerModuleUrl
			}
		});
		await Promise.resolve();
		await (globalThis as any).self.onmessage({
			data: {
				code: 'package main\nfunc main() {}',
				prepare: true,
				buffer: new SharedArrayBuffer(1024)
			}
		});
		await Promise.resolve();

		expect((globalThis as any).postMessage).toHaveBeenCalledWith({
			progress: expect.objectContaining({
				stage: 'compile',
				percent: 34,
				message: 'compiling'
			})
		});
	});
});
