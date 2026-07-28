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
		(globalThis as any).__debugControl = undefined;
		(globalThis as any).__debugModuleLoads = 0;
		(globalThis as any).__compileModes = [];
		(globalThis as any).__compileTargets = [];
		(globalThis as any).__executionCalls = 0;
		(globalThis as any).__sourceWasm = undefined;
		(globalThis as any).__lldbDescriptor = undefined;
		(globalThis as any).__artifactTargetTriple = undefined;
		(globalThis as any).__artifactFormat = undefined;
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
		expect((globalThis as any).__lastCompileOptions.debugMode).toBe('none');
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

	it('separates LLDB artifacts from the normal cache and returns copied bytes without executing them', async () => {
		const compilerModuleUrl = await createMockRustRuntimeModule(`
			export async function createRustCompiler() {
				return {
					async compile(options) {
						globalThis.__lastCompileOptions = options;
						globalThis.__compileModes.push(options.debugMode);
						const wasm = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]);
						if (options.debugMode === 'lldb') {
							globalThis.__sourceWasm = wasm;
						}
						return {
							success: true,
							artifact: {
								wasm,
								targetTriple: options.targetTriple,
								format: 'core-wasm',
								...(options.debugMode === 'lldb'
									? {
											debug: {
												kind: 'dwarf',
												sourceRoot: '/workspace',
												moduleSha256: 'a'.repeat(64),
												files: [{
													path: '/workspace/main.rs',
													contentSha256: 'b'.repeat(64)
												}],
												compiler: {
													name: 'rustc',
													version: '1.99.0',
													revision: 'rust-revision',
													llvmVersion: '22.1.8',
													llvmRevision: 'llvm-revision',
													runtimeVersion: 'test-runtime',
													hostTriple: 'wasm32-wasip1-threads'
												}
											}
										}
									: {})
							}
						};
					}
				};
			}

			export async function executeBrowserRustArtifact() {
				globalThis.__executionCalls += 1;
				return {
					exitCode: 0,
					stdout: '',
					stderr: ''
				};
			}

			export default createRustCompiler;
		`);
		const source = 'fn main() { let answer = 42; println!("{answer}"); }';

		await import('./rust');
		await (globalThis as any).self.onmessage({
			data: {
				load: true,
				compilerUrl: compilerModuleUrl
			}
		});
		await (globalThis as any).self.onmessage({
			data: {
				code: source,
				prepare: false,
				buffer: new SharedArrayBuffer(1024),
				debugMode: 'none',
				targetTriple: 'wasm32-wasip1'
			}
		});
		await (globalThis as any).self.onmessage({
			data: {
				code: source,
				prepare: false,
				buffer: new SharedArrayBuffer(1024),
				debugMode: 'lldb',
				targetTriple: 'wasm32-wasip1'
			}
		});

		const postedMessages = (globalThis as any).postMessage.mock.calls.map(
			([message]: [any]) => message
		);
		const lldbMessage = postedMessages.find((message: any) => message.lldbArtifact);
		expect((globalThis as any).__compileModes).toEqual(['none', 'lldb']);
		expect((globalThis as any).__lastCompileOptions).toMatchObject({
			code: source,
			debugMode: 'lldb',
			targetTriple: 'wasm32-wasip1'
		});
		expect((globalThis as any).__executionCalls).toBe(1);
		expect((globalThis as any).__debugModuleLoads).toBe(0);
		expect(lldbMessage).toMatchObject({
			lldbArtifact: {
				bytes: new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]),
				descriptor: {
					kind: 'dwarf',
					sourceRoot: '/workspace',
					moduleSha256: 'a'.repeat(64)
				},
				sources: [
					{
						path: '/workspace/main.rs',
						content: source,
						contentSha256: 'b'.repeat(64)
					}
				]
			}
		});
		expect(lldbMessage.lldbArtifact.bytes).not.toBe((globalThis as any).__sourceWasm);
		(globalThis as any).__sourceWasm[0] = 255;
		expect(lldbMessage.lldbArtifact.bytes[0]).toBe(0);
		expect(postedMessages.filter((message: any) => message.results)).toHaveLength(1);
	});

	it('rejects malformed LLDB artifacts returned across the dynamic compiler boundary', async () => {
		const compilerModuleUrl = await createMockRustRuntimeModule(`
			export async function createRustCompiler() {
				return {
					async compile() {
						return {
							success: true,
							artifact: {
								wasm: new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]),
								targetTriple: globalThis.__artifactTargetTriple,
								format: globalThis.__artifactFormat,
								debug: globalThis.__lldbDescriptor
							}
						};
					}
				};
			}

			export async function executeBrowserRustArtifact() {
				globalThis.__executionCalls += 1;
				return {
					exitCode: 0,
					stdout: '',
					stderr: ''
				};
			}

			export default createRustCompiler;
		`);
		const validDescriptor = {
			kind: 'dwarf',
			sourceRoot: '/workspace',
			moduleSha256: 'a'.repeat(64),
			files: [
				{
					path: '/workspace/main.rs',
					contentSha256: 'b'.repeat(64)
				}
			],
			compiler: {
				name: 'rustc',
				version: '1.99.0',
				revision: 'rust-revision',
				llvmVersion: '22.1.8',
				llvmRevision: 'llvm-revision',
				runtimeVersion: 'test-runtime',
				hostTriple: 'wasm32-wasip1-threads'
			}
		};
		const malformedCases = [
			{
				name: 'target',
				targetTriple: 'wasm32-wasip2',
				format: 'core-wasm',
				descriptor: validDescriptor,
				error: 'wasm-rust LLDB artifact must be wasm32-wasip1 core-wasm'
			},
			{
				name: 'format',
				targetTriple: 'wasm32-wasip1',
				format: 'component',
				descriptor: validDescriptor,
				error: 'wasm-rust LLDB artifact must be wasm32-wasip1 core-wasm'
			},
			{
				name: 'descriptor kind',
				targetTriple: 'wasm32-wasip1',
				format: 'core-wasm',
				descriptor: { ...validDescriptor, kind: 'trace' },
				error: 'wasm-rust did not return an LLDB DWARF descriptor'
			},
			{
				name: 'source root',
				targetTriple: 'wasm32-wasip1',
				format: 'core-wasm',
				descriptor: { ...validDescriptor, sourceRoot: '/work' },
				error: 'wasm-rust did not return an LLDB DWARF descriptor'
			},
			{
				name: 'module hash',
				targetTriple: 'wasm32-wasip1',
				format: 'core-wasm',
				descriptor: { ...validDescriptor, moduleSha256: 'A'.repeat(64) },
				error: 'wasm-rust LLDB descriptor has an invalid module SHA-256'
			},
			{
				name: 'source list',
				targetTriple: 'wasm32-wasip1',
				format: 'core-wasm',
				descriptor: {
					...validDescriptor,
					files: [...validDescriptor.files, ...validDescriptor.files]
				},
				error: 'wasm-rust LLDB descriptor must contain exactly one /workspace/main.rs source'
			},
			{
				name: 'source hash',
				targetTriple: 'wasm32-wasip1',
				format: 'core-wasm',
				descriptor: {
					...validDescriptor,
					files: [{ ...validDescriptor.files[0], contentSha256: 'B'.repeat(64) }]
				},
				error: 'wasm-rust LLDB descriptor has an invalid /workspace/main.rs SHA-256'
			},
			{
				name: 'compiler provenance',
				targetTriple: 'wasm32-wasip1',
				format: 'core-wasm',
				descriptor: {
					...validDescriptor,
					compiler: { ...validDescriptor.compiler, llvmRevision: ' ' }
				},
				error: 'wasm-rust LLDB descriptor requires complete rustc compiler provenance'
			}
		];

		await import('./rust');
		await (globalThis as any).self.onmessage({
			data: {
				load: true,
				compilerUrl: compilerModuleUrl
			}
		});

		for (const [index, malformed] of malformedCases.entries()) {
			(globalThis as any).postMessage.mockClear();
			(globalThis as any).__artifactTargetTriple = malformed.targetTriple;
			(globalThis as any).__artifactFormat = malformed.format;
			(globalThis as any).__lldbDescriptor = malformed.descriptor;
			await (globalThis as any).self.onmessage({
				data: {
					code: `fn main() { let malformed_case = ${index}; }`,
					prepare: false,
					buffer: new SharedArrayBuffer(1024),
					debugMode: 'lldb',
					targetTriple: 'wasm32-wasip1'
				}
			});

			expect(
				(globalThis as any).postMessage,
				`malformed LLDB artifact case: ${malformed.name}`
			).toHaveBeenCalledOnce();
			expect((globalThis as any).postMessage).toHaveBeenCalledWith({
				error: malformed.error
			});
			expect((globalThis as any).postMessage).not.toHaveBeenCalledWith({
				lldbArtifact: expect.anything()
			});
		}
		expect((globalThis as any).__executionCalls).toBe(0);
	});

	it('passes through compiler errors for unsupported LLDB component targets', async () => {
		const compilerModuleUrl = await createMockRustRuntimeModule(`
			export async function createRustCompiler() {
				return {
					async compile(options) {
						globalThis.__compileTargets.push(options.targetTriple);
						return {
							success: false,
							stderr: 'lldb-target-error:' + options.targetTriple
						};
					}
				};
			}

			export async function executeBrowserRustArtifact() {
				globalThis.__executionCalls += 1;
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
		for (const targetTriple of ['wasm32-wasip2', 'wasm32-wasip3']) {
			await (globalThis as any).self.onmessage({
				data: {
					code: 'fn main() {}',
					prepare: false,
					buffer: new SharedArrayBuffer(1024),
					debugMode: 'lldb',
					targetTriple
				}
			});
		}

		expect((globalThis as any).__compileTargets).toEqual(['wasm32-wasip2', 'wasm32-wasip3']);
		expect((globalThis as any).__executionCalls).toBe(0);
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({
			error: 'lldb-target-error:wasm32-wasip2'
		});
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({
			error: 'lldb-target-error:wasm32-wasip3'
		});
		expect((globalThis as any).postMessage).not.toHaveBeenCalledWith({
			lldbArtifact: expect.anything()
		});
	});

	it('instruments Rust source and forwards debug pauses from stderr trace markers', async () => {
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
								format: 'core-wasm'
							}
						};
					}
				};
			}

			export async function executeBrowserRustArtifact(artifact, runtimeBaseUrl, options = {}) {
				globalThis.__lastExecution = { artifact, runtimeBaseUrl, options };
				options.stderr?.('__WASM_IDLE_RUST_DEBUG__:4:main\\n');
				options.stderr?.('visible stderr\\n');
				return {
					exitCode: 0,
					stdout: '',
					stderr: ''
				};
			}

			export default createRustCompiler;
		`);
		const debugModuleUrl = await createMockRustRuntimeModule(`
			globalThis.__debugModuleLoads += 1;
			export const RUST_DEBUG_MARKER = '__WASM_IDLE_RUST_DEBUG__';
			export function instrumentRustDebugSource(source) {
				return source.replace(
					'    println!("hi");',
					'    eprintln!("__WASM_IDLE_RUST_DEBUG__:{}:{}", 2, "main"); println!("hi");'
				);
			}
		`);
		const debugBuffer = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT * 1028);
		(globalThis as any).__debugControl = new Int32Array(debugBuffer);
		(globalThis as any).postMessage = vi.fn((message: any) => {
			if (message?.debugEvent?.type === 'pause') {
				Atomics.store((globalThis as any).__debugControl, 1, 1);
				Atomics.add((globalThis as any).__debugControl, 0, 1);
				Atomics.notify((globalThis as any).__debugControl, 0);
			}
		});

		await import('./rust');
		await (globalThis as any).self.onmessage({
			data: {
				load: true,
				compilerUrl: compilerModuleUrl,
				debugModuleUrl
			}
		});
		await Promise.resolve();
		await (globalThis as any).self.onmessage({
			data: {
				code: `fn main() {
    println!("hi");
}`,
				prepare: false,
				buffer: new SharedArrayBuffer(1024),
				debugBuffer,
				debug: true,
				breakpoints: [4],
				pauseOnEntry: true
			}
		});
		await Promise.resolve();

		expect((globalThis as any).__lastCompileOptions.code).toContain(
			'eprintln!("__WASM_IDLE_RUST_DEBUG__:{}:{}", 2, "main");'
		);
		expect((globalThis as any).__lastCompileOptions.debugMode).toBe('trace');
		expect((globalThis as any).__debugModuleLoads).toBe(1);
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({
			progress: {
				stage: 'load-debug-instrumenter',
				percent: 1,
				message: 'Loading Rust debugger'
			}
		});
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({
			debugEvent: {
				type: 'pause',
				line: 4,
				reason: 'entry',
				locals: [],
				callStack: [{ functionName: 'main', line: 4 }]
			}
		});
		expect((globalThis as any).postMessage).not.toHaveBeenCalledWith({
			output: '__WASM_IDLE_RUST_DEBUG__:4:main\n'
		});
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({
			output: 'visible stderr\n'
		});
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({ results: true });
	});

	it('keeps Next Line out of callees and handles Step Out at the caller', async () => {
		const compilerModuleUrl = await createMockRustRuntimeModule(`
			export async function createRustCompiler() {
				return {
					async compile(options) {
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

			export async function executeBrowserRustArtifact(_artifact, _runtimeBaseUrl, options = {}) {
				for (const marker of [
					'__WASM_IDLE_RUST_DEBUG__:1:main\\n',
					'__WASM_IDLE_RUST_DEBUG__:10:callee\\n',
					'__WASM_IDLE_RUST_DEBUG__:2:main\\n',
					'__WASM_IDLE_RUST_DEBUG__:11:callee\\n',
					'__WASM_IDLE_RUST_DEBUG__:20:nested\\n',
					'__WASM_IDLE_RUST_DEBUG__:12:callee\\n',
					'__WASM_IDLE_RUST_DEBUG__:3:main\\n'
				]) {
					options.stderr?.(marker);
				}
				return { exitCode: 0, stdout: '', stderr: '' };
			}
		`);
		const debugModuleUrl = await createMockRustRuntimeModule(`
			export const RUST_DEBUG_MARKER = '__WASM_IDLE_RUST_DEBUG__';
			export function instrumentRustDebugSource(source) {
				return source;
			}
		`);
		const debugBuffer = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT * 1028);
		const debugControl = new Int32Array(debugBuffer);
		const commands = [3, 2, 4, 1];
		const pauses: any[] = [];
		(globalThis as any).postMessage = vi.fn((message: any) => {
			if (message?.debugEvent?.type !== 'pause') return;
			pauses.push(message.debugEvent);
			Atomics.store(debugControl, 1, commands.shift() || 1);
			Atomics.add(debugControl, 0, 1);
			Atomics.notify(debugControl, 0);
		});

		await import('./rust');
		await (globalThis as any).self.onmessage({
			data: { load: true, compilerUrl: compilerModuleUrl, debugModuleUrl }
		});
		await (globalThis as any).self.onmessage({
			data: {
				code: 'fn main() {}',
				prepare: false,
				buffer: new SharedArrayBuffer(1024),
				debugBuffer,
				debugMode: 'trace',
				pauseOnEntry: true
			}
		});

		expect(pauses.map(({ line, reason }) => ({ line, reason }))).toEqual([
			{ line: 1, reason: 'entry' },
			{ line: 2, reason: 'nextLine' },
			{ line: 11, reason: 'step' },
			{ line: 3, reason: 'stepOut' }
		]);
	});
});
