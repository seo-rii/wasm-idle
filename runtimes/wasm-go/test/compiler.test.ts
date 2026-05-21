import { describe, expect, it } from 'vitest';

import {
	compileGo,
	createGoCompiler,
	preloadBrowserGoRuntime
} from '../src/compiler.js';
import { createCompileRequest, createRuntimeManifest } from './helpers.js';

describe('compiler facade', () => {
	it('returns a clear failure when bundled runtime assets are missing', async () => {
		const result = await compileGo(createCompileRequest(), {
			manifest: createRuntimeManifest(),
			runtimeBaseUrl: 'https://example.invalid/runtime/',
			dependencies: {
				fetchImpl: async () => new Response(null, { status: 404 })
			}
		});

		expect(result.success).toBe(false);
		expect(result.plan?.compile.tool).toBe('compile');
		expect(result.stderr).toMatch(/failed to fetch/);
		expect(result.stderr).toMatch(/wasip1\.(pack|index\.json)\.gz/);
	});

	it('runs compile and link invocations through an injected runner', async () => {
		const invocations: string[] = [];
		const compiler = await createGoCompiler({
			manifest: createRuntimeManifest(),
			dependencies: {
				runTool: async (invocation) => {
					invocations.push(`${invocation.tool}:${invocation.args.join(' ')}`);
					if (invocation.tool === 'compile') {
						return {
							exitCode: 0,
							stdout: 'compile ok\n',
							outputs: {
								[invocation.outputPath]: new Uint8Array([1, 2, 3])
							}
						};
					}
					return {
						exitCode: 0,
						stdout: 'link ok\n',
						outputs: {
							[invocation.outputPath]: new Uint8Array([0, 97, 115, 109, 1])
						}
					};
				}
			}
		});

		const result = await compiler.compile(createCompileRequest());

		expect(result.success).toBe(true);
		expect(result.artifact?.format).toBe('wasi-core-wasm');
		expect(Array.from(result.artifact?.bytes as Uint8Array)).toEqual([0, 97, 115, 109, 1]);
		expect(Array.from(result.artifact?.wasm as Uint8Array)).toEqual([0, 97, 115, 109, 1]);
		expect(invocations).toHaveLength(2);
	});

	it('returns preview1-compatible core wasm artifacts for transitional wasip2/wasip3 targets', async () => {
		const requestedTargets = ['wasip2/wasm', 'wasip3/wasm'] as const;

		for (const target of requestedTargets) {
			const result = await compileGo(
				createCompileRequest({
					target
				}),
				{
					manifest: createRuntimeManifest(),
					dependencies: {
						runTool: async (invocation) => {
							expect(invocation.env.GOOS).toBe('wasip1');
							return {
								exitCode: 0,
								outputs: {
									[invocation.outputPath]:
										invocation.tool === 'compile'
											? new Uint8Array([1, 2, 3])
											: new Uint8Array([0, 97, 115, 109, 1])
								}
							};
						}
					}
				}
			);

			expect(result.success).toBe(true);
			expect(result.artifact?.target).toBe(target);
			expect(result.artifact?.format).toBe('wasi-core-wasm');
		}
	});

	it('fails early when compile succeeds without emitting the main archive', async () => {
		const invocations: string[] = [];
		const result = await compileGo(createCompileRequest(), {
			manifest: createRuntimeManifest(),
			dependencies: {
				runTool: async (invocation) => {
					invocations.push(invocation.tool);
					return {
						exitCode: 0,
						stdout: 'compile ok\n',
						outputs: {}
					};
				}
			}
		});

		expect(result.success).toBe(false);
		expect(result.stderr).toContain('/workspace/pkg/main.a');
		expect(invocations).toEqual(['compile']);
	});

	it('prefers stderr when parsing compile diagnostics', async () => {
		const result = await compileGo(createCompileRequest(), {
			manifest: createRuntimeManifest(),
			dependencies: {
				runTool: async () => ({
					exitCode: 1,
					stdout: 'stdout banner\n',
					stderr: 'main.go:5:2: undefined: fmtx\n'
				})
			}
		});

		expect(result.success).toBe(false);
		expect(result.diagnostics).toEqual([
			{
				fileName: 'main.go',
				lineNumber: 5,
				columnNumber: 2,
				severity: 'error',
				message: 'undefined: fmtx'
			},
			{
				severity: 'error',
				message: 'stdout banner'
			}
		]);
	});

	it('returns go archives for library builds', async () => {
		const result = await compileGo(
			createCompileRequest({
				packageKind: 'library'
			}),
			{
				manifest: createRuntimeManifest(),
				dependencies: {
					runTool: async (invocation) => ({
						exitCode: 0,
						outputs: {
							[invocation.outputPath]: new Uint8Array([9, 9, 9])
						}
					})
				}
			}
		);

		expect(result.success).toBe(true);
		expect(result.artifact?.format).toBe('go-archive');
	});

	it('preloads the selected runtime assets', async () => {
		const fetched: string[] = [];
		const preload = await preloadBrowserGoRuntime({
			manifest: createRuntimeManifest(),
			target: 'js/wasm',
			fetchImpl: async (url) => {
				fetched.push(String(url));
				if (String(url).endsWith('.index.json.gz')) {
					return new Response(
						JSON.stringify({
							format: 'wasm-go-runtime-pack-index-v1',
							fileCount: 2,
							totalBytes: 6,
							entries: [
								{ runtimePath: '/sysroot/fmt.a', offset: 0, length: 3 },
								{ runtimePath: '/sysroot/runtime.a', offset: 3, length: 3 }
							]
						})
					);
				}
				return new Response(new Uint8Array([1, 2, 3, 4, 5, 6]));
			}
		});

		expect(preload.target.target).toBe('js/wasm');
		expect(fetched.some((url) => url.endsWith('/runtime/wasm_exec.js'))).toBe(true);
		expect(fetched.some((url) => url.endsWith('/tools/compile.wasm.gz'))).toBe(true);
		expect(fetched.some((url) => url.endsWith('/tools/link.wasm.gz'))).toBe(true);
	});

	it('preloads transitional preview targets with the shared packed sysroot', async () => {
		const fetched: string[] = [];

		const preload = await preloadBrowserGoRuntime({
			manifest: createRuntimeManifest(),
			target: 'wasip3/wasm',
			fetchImpl: async (url) => {
				fetched.push(String(url));
				if (String(url).endsWith('.index.json.gz')) {
					return new Response(
						JSON.stringify({
							format: 'wasm-go-runtime-pack-index-v1',
							fileCount: 2,
							totalBytes: 6,
							entries: [
								{ runtimePath: '/sysroot/fmt.a', offset: 0, length: 3 },
								{ runtimePath: '/sysroot/runtime.a', offset: 3, length: 3 }
							]
						})
					);
				}
				return new Response(new Uint8Array([1, 2, 3, 4, 5, 6]));
			}
		});

		expect(preload.target.target).toBe('wasip3/wasm');
		expect(fetched.some((url) => url.endsWith('/sysroot/wasip1.index.json.gz'))).toBe(true);
		expect(fetched.some((url) => url.endsWith('/sysroot/wasip1.pack.gz'))).toBe(true);
	});

	it('accepts a code-only request and auto-populates sysroot dependencies', async () => {
		const manifest = createRuntimeManifest();
		const wasip1Target = manifest.targets['wasip1/wasm'];
		if (!wasip1Target) {
			throw new Error('missing wasip1 target in test manifest');
		}
		const compiler = await createGoCompiler({
			manifest: {
				...manifest,
				targets: {
					...manifest.targets,
					'wasip1/wasm': {
						...wasip1Target,
						sysrootFiles: [
							{
								asset: 'sysroot/fmt.a.gz',
								runtimePath: '/sysroot/fmt.a'
							},
							{
								asset: 'sysroot/runtime.a.gz',
								runtimePath: '/sysroot/runtime.a'
							}
						],
						sysrootPack: undefined
					}
				}
			},
			dependencies: {
				runTool: async (invocation) => {
					if (invocation.tool === 'compile') {
						expect(invocation.args).toContain('/workspace/main.go');
						return {
							exitCode: 0,
							outputs: {
								[invocation.outputPath]: new Uint8Array([1, 2, 3])
							}
						};
					}
					return {
						exitCode: 0,
						outputs: {
							[invocation.outputPath]: new Uint8Array([0, 97, 115, 109, 1])
						}
					};
				}
			}
		});

		const result = await compiler.compile({
			code: `package main

import "fmt"

func main() {
	fmt.Println("hello")
}
`,
			target: 'wasip1/wasm'
		});

		expect(result.success).toBe(true);
		expect(result.plan?.importcfg).toContain('packagefile fmt=/sysroot/fmt.a');
		expect(result.plan?.importcfg).toContain('packagefile runtime=/sysroot/runtime.a');
	});

	it('closes only the requested stdlib dependency graph when a stdlib index is present', async () => {
		const manifest = createRuntimeManifest();
		const wasip1Target = manifest.targets['wasip1/wasm'];
		if (!wasip1Target) {
			throw new Error('missing wasip1 target in test manifest');
		}
		const result = await compileGo(
			{
				code: `package main

import "fmt"

func main() {
	fmt.Println("hello")
}
`,
				target: 'wasip1/wasm'
			},
			{
				manifest: {
					...manifest,
					targets: {
						...manifest.targets,
						'wasip1/wasm': {
							...wasip1Target,
							stdlibIndex: {
								asset: 'sysroot/wasip1.stdlib-index.json.gz',
								packageCount: 4
							}
						}
					}
				},
				dependencies: {
					fetchImpl: async (url) => {
						if (String(url).endsWith('/sysroot/wasip1.stdlib-index.json.gz')) {
							return new Response(
								JSON.stringify({
									format: 'wasm-go-stdlib-index-v1',
									packageCount: 4,
									packages: [
										{
											importPath: 'bytes',
											runtimePath: '/sysroot/bytes.a',
											imports: []
										},
										{
											importPath: 'errors',
											runtimePath: '/sysroot/errors.a',
											imports: []
										},
										{
											importPath: 'fmt',
											runtimePath: '/sysroot/fmt.a',
											imports: ['errors', 'runtime']
										},
										{
											importPath: 'runtime',
											runtimePath: '/sysroot/runtime.a',
											imports: []
										}
									]
								})
							);
						}
						return new Response(new Uint8Array([1, 2, 3]));
					},
					runTool: async (invocation) => ({
						exitCode: 0,
						outputs: {
							[invocation.outputPath]:
								invocation.tool === 'compile'
									? new Uint8Array([1, 2, 3])
									: new Uint8Array([0, 97, 115, 109, 1])
						}
					})
				}
			}
		);

		expect(result.success).toBe(true);
		expect(result.plan?.importcfg).toContain('packagefile fmt=/sysroot/fmt.a');
		expect(result.plan?.importcfg).toContain('packagefile errors=/sysroot/errors.a');
		expect(result.plan?.importcfg).toContain('packagefile runtime=/sysroot/runtime.a');
		expect(result.plan?.importcfg).not.toContain('packagefile bytes=/sysroot/bytes.a');
	});

	it('rejects empty requests early', async () => {
		const result = await compileGo(
			{},
			{
				manifest: createRuntimeManifest()
			}
		);

		expect(result.success).toBe(false);
		expect(result.stderr).toMatch(
			/requires either a non-empty Go source string or at least one workspace file/
		);
	});
});
