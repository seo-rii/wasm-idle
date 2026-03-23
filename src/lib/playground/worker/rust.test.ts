import { beforeEach, describe, expect, it, vi } from 'vitest';

import { flushQueuedStdin } from '$lib/playground/stdinBuffer';

async function createMockRustRuntimeModule(source: string) {
	return `data:text/javascript;base64,${Buffer.from(source, 'utf8').toString('base64')}`;
}

describe('Rust worker', () => {
	beforeEach(() => {
		vi.resetModules();
		(globalThis as any).self = globalThis as any;
		(globalThis as any).document = undefined;
		(globalThis as any).postMessage = vi.fn();
		(globalThis as any).__lastCompileOptions = undefined;
		(globalThis as any).__lastExecution = undefined;
		(globalThis as any).__lastStdin = undefined;
	});

	it('loads a wasm-rust-style compiler module and runs the returned artifact through executeBrowserRustArtifact', async () => {
		const compilerModuleUrl = await createMockRustRuntimeModule(`
			export async function createRustCompiler() {
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
								targetTriple: options.targetTriple,
								format: options.targetTriple === 'wasm32-wasip1' ? 'core-wasm' : 'component'
							}
						};
					}
				};
			}

			export async function executeBrowserRustArtifact(artifact, runtimeBaseUrl, options = {}) {
				globalThis.__lastExecution = { artifact, runtimeBaseUrl, options };
				options.stdout?.('hi\\n');
				return {
					exitCode: 0,
					stdout: 'hi\\n',
					stderr: ''
				};
			}

			export default createRustCompiler;
		`);

		await import('./rust');
		await (globalThis as any).self.onmessage({
			data: {
				load: true,
				compilerUrl: compilerModuleUrl
			}
		});
		await Promise.resolve();

		await (globalThis as any).self.onmessage({
			data: {
				code: 'fn main() { println!("hi"); }',
				prepare: false,
				buffer: new SharedArrayBuffer(1024),
				args: ['one'],
				targetTriple: 'wasm32-wasip2',
				log: true
			}
		});
		await Promise.resolve();

		expect((globalThis as any).postMessage).toHaveBeenCalledWith({ load: true });
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({
			diagnostic: {
				lineNumber: 1,
				columnNumber: 1,
				severity: 'warning',
				message: 'demo warning'
			}
		});
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({ output: 'build log\n' });
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({ output: 'hi\n' });
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({ results: true });
		expect((globalThis as any).__lastCompileOptions.targetTriple).toBe('wasm32-wasip2');
		expect((globalThis as any).__lastExecution.artifact.targetTriple).toBe('wasm32-wasip2');
		expect((globalThis as any).__lastExecution.runtimeBaseUrl).toBe(compilerModuleUrl);
		expect((globalThis as any).__lastExecution.options.args).toEqual(['one']);
		expect((globalThis as any).__lastExecution.options.env).toEqual({ USER: 'jungol' });
	});

	it('reads stdin from the shared buffer when executeBrowserRustArtifact requests input', async () => {
		const compilerModuleUrl = await createMockRustRuntimeModule(`
			export async function createRustCompiler() {
				return {
					async compile(options) {
						return {
							success: true,
							artifact: {
								wasm: new Uint8Array([0, 97, 115, 109]),
								targetTriple: options.targetTriple,
								format: 'component'
							}
						};
					}
				};
			}

			export async function executeBrowserRustArtifact(_artifact, _runtimeBaseUrl, options = {}) {
				const chunk = options.stdin?.() || '';
				globalThis.__lastStdin = chunk;
				options.stdout?.(chunk);
				return {
					exitCode: 0,
					stdout: chunk,
					stderr: ''
				};
			}

			export default createRustCompiler;
		`);
		const buffer = new SharedArrayBuffer(1024);
		const queuedInput = ['5\n'];

		(globalThis as any).postMessage = vi.fn((message: any) => {
			if (message?.buffer) {
				flushQueuedStdin(queuedInput, buffer);
			}
		});

		await import('./rust');
		await (globalThis as any).self.onmessage({
			data: {
				load: true,
				compilerUrl: compilerModuleUrl
			}
		});
		await Promise.resolve();
		await (globalThis as any).self.onmessage({
			data: {
				code: 'use std::io::{self, Read}; fn main() { let mut input = String::new(); io::stdin().read_to_string(&mut input).unwrap(); print!("{input}"); }',
				prepare: false,
				buffer,
				targetTriple: 'wasm32-wasip2'
			}
		});
		await Promise.resolve();

		expect((globalThis as any).postMessage).toHaveBeenCalledWith({ buffer: true });
		expect((globalThis as any).__lastStdin).toBe('5\n');
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({ output: '5\n' });
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({ results: true });
	});

	it('passes wasm32-wasip3 through as a component artifact target', async () => {
		const compilerModuleUrl = await createMockRustRuntimeModule(`
			export async function createRustCompiler() {
				return {
					async compile(options) {
						globalThis.__lastCompileOptions = options;
						return {
							success: true,
							artifact: {
								wasm: new Uint8Array([0, 97, 115, 109]),
								targetTriple: options.targetTriple,
								format: options.targetTriple === 'wasm32-wasip1' ? 'core-wasm' : 'component'
							}
						};
					}
				};
			}

			export async function executeBrowserRustArtifact(artifact, runtimeBaseUrl, options = {}) {
				globalThis.__lastExecution = { artifact, runtimeBaseUrl, options };
				return {
					exitCode: 0,
					stdout: '',
					stderr: ''
				};
			}

			export default createRustCompiler;
		`);

		await import('./rust');
		await (globalThis as any).self.onmessage({
			data: {
				load: true,
				compilerUrl: compilerModuleUrl
			}
		});
		await Promise.resolve();

		await (globalThis as any).self.onmessage({
			data: {
				code: 'fn main() { println!("hi"); }',
				prepare: false,
				buffer: new SharedArrayBuffer(1024),
				targetTriple: 'wasm32-wasip3'
			}
		});
		await Promise.resolve();

		expect((globalThis as any).__lastCompileOptions.targetTriple).toBe('wasm32-wasip3');
		expect((globalThis as any).__lastExecution.artifact.targetTriple).toBe('wasm32-wasip3');
		expect((globalThis as any).__lastExecution.artifact.format).toBe('component');
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({ results: true });
	});

	it('forwards structured compile progress back to the UI worker host', async () => {
		const compilerModuleUrl = await createMockRustRuntimeModule(`
			export async function createRustCompiler() {
				return {
					async compile(options) {
						options.onProgress?.({
							stage: 'fetch-sysroot',
							attempt: 1,
							maxAttempts: 5,
							completed: 3,
							total: 10,
							percent: 34,
							message: 'fetching sysroot'
						});
						return {
							success: true,
							artifact: {
								wasm: new Uint8Array([0, 97, 115, 109]),
								targetTriple: options.targetTriple,
								format: 'core-wasm'
							}
						};
					}
				};
			}

			export async function executeBrowserRustArtifact() {
				return {
					exitCode: 0,
					stdout: '',
					stderr: ''
				};
			}

			export default createRustCompiler;
		`);

		await import('./rust');
		await (globalThis as any).self.onmessage({
			data: {
				load: true,
				compilerUrl: compilerModuleUrl
			}
		});
		await Promise.resolve();
		await (globalThis as any).self.onmessage({
			data: {
				code: 'fn main() {}',
				prepare: true,
				buffer: new SharedArrayBuffer(1024),
				targetTriple: 'wasm32-wasip1'
			}
		});
		await Promise.resolve();

		expect((globalThis as any).postMessage).toHaveBeenCalledWith({
			progress: expect.objectContaining({
				stage: 'fetch-sysroot',
				percent: 34,
				message: 'fetching sysroot'
			})
		});
	});
});
