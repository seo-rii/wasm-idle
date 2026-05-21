import type { BrowserGoCompileRequest, RuntimeManifestV1 } from '../src/types.js';

export function createRuntimeManifest(): RuntimeManifestV1 {
	return {
		manifestVersion: 1,
		version: 'test-runtime-v1',
		goVersion: 'go1.26.1',
		defaultTarget: 'wasip1/wasm',
		compiler: {
			compile: {
				asset: 'tools/compile.wasm.gz',
				argv0: 'compile',
				memory: {
					initialPages: 64,
					maximumPages: 512
				}
			},
			link: {
				asset: 'tools/link.wasm.gz',
				argv0: 'link',
				memory: {
					initialPages: 64,
					maximumPages: 512
				}
			},
			compileTimeoutMs: 30_000,
			linkTimeoutMs: 30_000,
			host: {
				rootDirectory: '/',
				pwd: '/',
				tmpDirectory: '/tmp',
				env: ['HOME=/', 'PWD=/']
			}
		},
		targets: {
			'wasip1/wasm': {
				goos: 'wasip1',
				goarch: 'wasm',
				artifactFormat: 'wasi-core-wasm',
				sysrootPack: {
					index: 'sysroot/wasip1.index.json.gz',
					asset: 'sysroot/wasip1.pack.gz',
					fileCount: 2,
					totalBytes: 6
				},
				execution: {
					kind: 'wasi-preview1'
				},
				planner: {
					workspaceRoot: '/workspace',
					importcfgPath: '/workspace/importcfg',
					embedcfgPath: '/workspace/embedcfg',
					compileOutputPath: '/workspace/pkg/main.a',
					linkOutputPath: '/workspace/bin/main.wasm',
					defaultLang: 'go1.26',
					defaultTrimpath: '/workspace'
				}
			},
			'wasip2/wasm': {
				goos: 'wasip1',
				goarch: 'wasm',
				artifactFormat: 'wasi-core-wasm',
				sysrootPack: {
					index: 'sysroot/wasip1.index.json.gz',
					asset: 'sysroot/wasip1.pack.gz',
					fileCount: 2,
					totalBytes: 6
				},
				execution: {
					kind: 'wasi-preview1'
				},
				planner: {
					workspaceRoot: '/workspace',
					importcfgPath: '/workspace/importcfg',
					embedcfgPath: '/workspace/embedcfg',
					compileOutputPath: '/workspace/pkg/main.a',
					linkOutputPath: '/workspace/bin/main.wasm',
					defaultLang: 'go1.26',
					defaultTrimpath: '/workspace'
				}
			},
			'wasip3/wasm': {
				goos: 'wasip1',
				goarch: 'wasm',
				artifactFormat: 'wasi-core-wasm',
				sysrootPack: {
					index: 'sysroot/wasip1.index.json.gz',
					asset: 'sysroot/wasip1.pack.gz',
					fileCount: 2,
					totalBytes: 6
				},
				execution: {
					kind: 'wasi-preview1'
				},
				planner: {
					workspaceRoot: '/workspace',
					importcfgPath: '/workspace/importcfg',
					embedcfgPath: '/workspace/embedcfg',
					compileOutputPath: '/workspace/pkg/main.a',
					linkOutputPath: '/workspace/bin/main.wasm',
					defaultLang: 'go1.26',
					defaultTrimpath: '/workspace'
				}
			},
			'js/wasm': {
				goos: 'js',
				goarch: 'wasm',
				artifactFormat: 'js-wasm',
				sysrootFiles: [
					{
						asset: 'sysroot/js/libstd.a.gz',
						runtimePath: '/sysroot/libstd.a'
					}
				],
				execution: {
					kind: 'js-wasm-exec',
					wasmExecJs: 'runtime/wasm_exec.js'
				},
				planner: {
					workspaceRoot: '/workspace',
					importcfgPath: '/workspace/importcfg',
					embedcfgPath: '/workspace/embedcfg',
					compileOutputPath: '/workspace/pkg/main.a',
					linkOutputPath: '/workspace/bin/main.wasm',
					defaultLang: 'go1.26',
					defaultTrimpath: '/workspace'
				}
			}
		}
	};
}

export function createCompileRequest(
	overrides: Partial<BrowserGoCompileRequest> = {}
): BrowserGoCompileRequest {
	return {
		packageImportPath: 'example.com/hello',
		packageKind: 'main',
		target: 'wasip1/wasm',
		files: {
			'main.go': `package main

import "fmt"

func main() {
	fmt.Println("hello")
}
`
		},
		dependencies: [
			{
				importPath: 'fmt',
				archivePath: '/sysroot/fmt.a'
			},
			{
				importPath: 'runtime',
				archivePath: '/sysroot/runtime.a'
			}
		],
		...overrides
	};
}
