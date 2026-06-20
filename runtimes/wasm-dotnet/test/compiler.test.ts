import { beforeEach, describe, expect, it } from 'vitest';
import { compileDotnet, createDotnetCompiler, parseDotnetDiagnostics } from '../src/compiler.js';
import { resetDotnetCompilerRuntimeForTests } from '../src/runtime-loader.js';

describe('compileDotnet', () => {
	beforeEach(() => {
		resetDotnetCompilerRuntimeForTests();
	});

	it('compiles F# source through the browser runtime bridge', async () => {
		const requests: unknown[] = [];
		const result = await compileDotnet(
			{
				code: 'printfn "hello"'
			},
			{
				loadRuntime: async () => ({
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
				})
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
		expect(lazyAssemblies).toEqual([
			'Microsoft.CodeAnalysis.wasm',
			'Microsoft.CodeAnalysis.CSharp.wasm'
		]);
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
