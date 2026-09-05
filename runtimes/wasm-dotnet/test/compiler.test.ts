import { beforeEach, describe, expect, it, vi } from 'vitest';
import { compileDotnet, createDotnetCompiler, parseDotnetDiagnostics } from '../src/compiler.js';
import {
	loadDotnetCompilerRuntime,
	resolveDotnetRuntimeBaseUrl,
	resetDotnetCompilerRuntimeForTests
} from '../src/runtime-loader.js';

describe('compileDotnet', () => {
	beforeEach(() => {
		resetDotnetCompilerRuntimeForTests();
	});

	it('compiles F# source through the browser runtime bridge', async () => {
		const requests: unknown[] = [];
		const runtimeLanguages: string[] = [];
		const result = await compileDotnet(
			{
				code: 'printfn "hello"'
			},
			{
				loadRuntime: async (language) => {
					runtimeLanguages.push(language);
					return {
						async compile(request) {
							requests.push(request);
							return {
								success: true,
								assemblyId: 'asm-fsharp'
							};
						},
						async run() {
							return { exitCode: 0 };
						}
					};
				}
			}
		);

		expect(result.success).toBe(true);
		expect(result.artifact).toEqual({
			format: 'dotnet-browser-assembly',
			assemblyId: 'asm-fsharp',
			language: 'fsharp',
			target: 'browser-wasm'
		});
		expect(requests).toEqual([
			expect.objectContaining({
				source: 'printfn "hello"',
				language: 'fsharp',
				target: 'browser-wasm'
			})
		]);
		expect(runtimeLanguages).toEqual(['fsharp']);
	});

	it('resolves the default runtime from the selected language directory', () => {
		expect(resolveDotnetRuntimeBaseUrl({ language: 'csharp' }).pathname).toMatch(
			/\/runtime\/csharp\/$/
		);
		expect(resolveDotnetRuntimeBaseUrl({ language: 'fsharp' }).pathname).toMatch(
			/\/runtime\/fsharp\/$/
		);
		expect(resolveDotnetRuntimeBaseUrl({ language: 'vbnet' }).pathname).toMatch(
			/\/runtime\/vbnet\/$/
		);
	});

	it('keeps independent runtime instances for different .NET languages', async () => {
		let creates = 0;
		const dotnetModule = {
			dotnet: {
				async create() {
					creates += 1;
					return {
						async getAssemblyExports() {
							return {
								CompilerHost: {
									Compile: () => JSON.stringify({ success: true }),
									Run: () => JSON.stringify({ exitCode: 0 })
								}
							};
						}
					};
				}
			}
		};

		const csharp = await loadDotnetCompilerRuntime({ language: 'csharp', dotnetModule });
		const csharpAgain = await loadDotnetCompilerRuntime({
			language: 'csharp',
			dotnetModule
		});
		const fsharp = await loadDotnetCompilerRuntime({ language: 'fsharp', dotnetModule });

		expect(csharpAgain).toBe(csharp);
		expect(fsharp).not.toBe(csharp);
		expect(creates).toBe(2);
	});

	it.each(['create', 'exports', 'compile', 'run'] as const)(
		'rejects a pending %s immediately when the runtime aborts',
		async (phase) => {
			const fatal = new Error('native pthread initialization failed');
			let callbacks!: { onAbort(reason: unknown): void; onExit(code: number): void };
			let reached!: () => void;
			const pending = new Promise<void>((resolve) => {
				reached = resolve;
			});
			const stall = () => {
				reached();
				return new Promise<never>(() => {});
			};
			const bridge = {
				Compile: () => (phase === 'compile' ? stall() : JSON.stringify({ success: true })),
				Run: () => (phase === 'run' ? stall() : JSON.stringify({ exitCode: 0 }))
			};
			const create = vi.fn(async () => {
				if (phase === 'create') return await stall();
				return {
					getAssemblyExports: async () =>
						phase === 'exports' ? await stall() : { CompilerHost: bridge }
				};
			});
			const options = {
				onFatalError: vi.fn(),
				dotnetModule: {
					dotnet: {
						withModuleConfig(value: typeof callbacks) {
							callbacks = value;
							return this;
						},
						create
					}
				}
			};
			let runtime: Awaited<ReturnType<typeof loadDotnetCompilerRuntime>> | undefined;
			const operation = (async () => {
				runtime = await loadDotnetCompilerRuntime(options);
				if (phase === 'compile')
					return await runtime.compile({
						language: 'csharp',
						source: '',
						target: 'browser-wasm'
					});
				if (phase === 'run') return await runtime.run({ assemblyId: 'asm-csharp' });
			})();
			const rejected = expect(operation).rejects.toBe(fatal);
			await pending;
			callbacks.onAbort(fatal);
			await rejected;
			expect(options.onFatalError).toHaveBeenCalledExactlyOnceWith(fatal);
			callbacks.onExit(1);
			expect(options.onFatalError).toHaveBeenCalledTimes(1);
			if (runtime)
				await expect(runtime.run({ assemblyId: 'asm-csharp' })).rejects.toBe(fatal);
		}
	);

	it('evicts an exited runtime and creates a replacement for the next load', async () => {
		let onExit!: (code: number) => void;
		const create = vi.fn(async () => ({
			getAssemblyExports: async () => ({
				CompilerHost: {
					Compile: () => JSON.stringify({ success: true }),
					Run: () => JSON.stringify({ exitCode: 0 })
				}
			})
		}));
		const options = {
			dotnetModule: {
				dotnet: {
					withModuleConfig(config: { onExit(code: number): void }) {
						onExit = config.onExit;
						return this;
					},
					create
				}
			}
		};
		const runtime = await loadDotnetCompilerRuntime(options);
		onExit(1);
		await expect(runtime.run({ assemblyId: 'asm-csharp' })).rejects.toThrow(
			'.NET runtime exited with code 1'
		);
		expect(await loadDotnetCompilerRuntime(options)).not.toBe(runtime);
		expect(create).toHaveBeenCalledTimes(2);
	});

	it('does not lazy-load Roslyn assemblies embedded in the AOT runtime', async () => {
		const lazyAssemblies: string[] = [];
		const runtime = await loadDotnetCompilerRuntime({
			dotnetModule: {
				dotnet: {
					async create() {
						return {
							INTERNAL: {
								async loadLazyAssembly(name: string) {
									lazyAssemblies.push(name);
									return true;
								}
							},
							async getAssemblyExports() {
								return {
									CompilerHost: {
										Compile() {
											return JSON.stringify({
												assemblyId: 'asm-fsharp',
												success: true
											});
										},
										Run() {
											return JSON.stringify({ exitCode: 0 });
										}
									}
								};
							}
						};
					}
				}
			}
		});

		await runtime.compile({
			language: 'fsharp',
			source: 'printfn "hello"',
			target: 'browser-wasm'
		});

		expect(lazyAssemblies).toEqual([]);
	});

	it('compiles C# source through the browser runtime bridge', async () => {
		const configs: unknown[] = [];
		const lazyAssemblies: string[] = [];
		const requests: unknown[] = [];
		const tracing: boolean[] = [];
		const compiler = createDotnetCompiler({
			dotnetModule: {
				dotnet: {
					withConfig(config: unknown) {
						configs.push(config);
						return this;
					},
					withDiagnosticTracing(enabled: boolean) {
						tracing.push(enabled);
						return this;
					},
					async create() {
						return {
							INTERNAL: {
								async loadLazyAssembly(name: string) {
									lazyAssemblies.push(name);
									return true;
								}
							},
							getConfig: () => ({
								mainAssemblyName: 'WasmDotnet.Compiler.dll'
							}),
							async getAssemblyExports() {
								return {
									WasmDotnet: {
										Compiler: {
											CompilerHost: {
												Compile(requestJson: string) {
													requests.push(JSON.parse(requestJson));
													return JSON.stringify({
														success: true,
														assemblyId: 'asm-csharp'
													});
												},
												Run() {
													return JSON.stringify({ exitCode: 0 });
												}
											}
										}
									}
								};
							}
						};
					}
				}
			}
		});

		await expect(
			compiler.compile({
				code: 'Console.WriteLine("hello");',
				language: 'csharp'
			})
		).resolves.toMatchObject({
			success: true,
			artifact: {
				format: 'dotnet-browser-assembly',
				assemblyId: 'asm-csharp',
				language: 'csharp'
			}
		});
		expect(requests).toEqual([
			expect.objectContaining({
				source: 'Console.WriteLine("hello");',
				language: 'csharp',
				target: 'browser-wasm'
			})
		]);
		expect(lazyAssemblies).toEqual([]);
		expect(configs).toEqual([
			{
				jsThreadBlockingMode: 'DangerousAllowBlockingWait'
			}
		]);
		expect(tracing).toEqual([false]);
	});

	it('enables runtime diagnostic tracing for explicit compile requests', async () => {
		const tracing: boolean[] = [];
		const compiler = createDotnetCompiler({
			dotnetModule: {
				dotnet: {
					withDiagnosticTracing(enabled: boolean) {
						tracing.push(enabled);
						return this;
					},
					async create() {
						return {
							getConfig: () => ({
								mainAssemblyName: 'WasmDotnet.Compiler.dll'
							}),
							async getAssemblyExports() {
								return {
									WasmDotnet: {
										Compiler: {
											CompilerHost: {
												Compile() {
													return JSON.stringify({
														success: true,
														assemblyId: 'asm-csharp'
													});
												},
												Run() {
													return JSON.stringify({ exitCode: 0 });
												}
											}
										}
									}
								};
							}
						};
					}
				}
			}
		});

		await expect(
			compiler.compile({
				code: 'Console.WriteLine("hello");',
				language: 'csharp',
				log: true,
				runtimeDiagnosticTracing: true
			})
		).resolves.toMatchObject({
			success: true
		});
		expect(tracing).toEqual([true]);
	});

	it('compiles VB.NET source through the browser runtime bridge', async () => {
		const requests: unknown[] = [];
		const result = await compileDotnet(
			{
				code: 'Imports System\nModule Program\n  Sub Main()\n    Console.WriteLine("hello")\n  End Sub\nEnd Module',
				language: 'vbnet'
			},
			{
				loadRuntime: async () => ({
					async compile(request) {
						requests.push(request);
						return {
							success: true,
							assemblyId: 'asm-vbnet'
						};
					},
					async run() {
						return { exitCode: 0 };
					}
				})
			}
		);

		expect(result.success).toBe(true);
		expect(result.artifact).toEqual({
			format: 'dotnet-browser-assembly',
			assemblyId: 'asm-vbnet',
			language: 'vbnet',
			target: 'browser-wasm'
		});
		expect(requests).toEqual([
			expect.objectContaining({
				source: 'Imports System\nModule Program\n  Sub Main()\n    Console.WriteLine("hello")\n  End Sub\nEnd Module',
				language: 'vbnet',
				target: 'browser-wasm'
			})
		]);
	});

	it('parses F# compiler diagnostics', () => {
		expect(
			parseDotnetDiagnostics('/tmp/Program.fs(3,5): error FS0039: The value is not defined')
		).toEqual([
			{
				fileName: '/tmp/Program.fs',
				lineNumber: 3,
				columnNumber: 5,
				severity: 'error',
				message: 'FS0039: The value is not defined'
			}
		]);
	});

	it('parses C# compiler diagnostics', () => {
		expect(
			parseDotnetDiagnostics(
				"/tmp/Program.cs(8,17): error CS0103: The name 'missing' does not exist"
			)
		).toEqual([
			{
				fileName: '/tmp/Program.cs',
				lineNumber: 8,
				columnNumber: 17,
				severity: 'error',
				message: "CS0103: The name 'missing' does not exist"
			}
		]);
	});

	it('parses VB.NET compiler diagnostics', () => {
		expect(
			parseDotnetDiagnostics(
				"/tmp/Program.vb(5,9): error BC30451: 'missing' is not declared. It may be inaccessible due to its protection level."
			)
		).toEqual([
			{
				fileName: '/tmp/Program.vb',
				lineNumber: 5,
				columnNumber: 9,
				severity: 'error',
				message:
					"BC30451: 'missing' is not declared. It may be inaccessible due to its protection level."
			}
		]);
	});
});
