import { describe, expect, it } from 'vitest';
import wabt from 'wabt';

import { createBrowserWasiHost, executeBrowserGoArtifact } from '../src/browser-execution.js';

async function buildPreview1StdoutModule() {
	const wabtApi = await wabt();
	const parsed = wabtApi.parseWat(
		'stdout.wat',
		`(module
			(import "wasi_snapshot_preview1" "fd_write"
				(func $fd_write (param i32 i32 i32 i32) (result i32)))
			(import "wasi_snapshot_preview1" "proc_exit"
				(func $proc_exit (param i32)))
			(memory (export "memory") 1)
			(data (i32.const 8) "hi\\0a")
			(func (export "_start")
				(i32.store (i32.const 0) (i32.const 8))
				(i32.store (i32.const 4) (i32.const 3))
				(drop
					(call $fd_write
						(i32.const 1)
						(i32.const 0)
						(i32.const 1)
						(i32.const 20)))
				(call $proc_exit (i32.const 0))
			)
		)`
	);
	const binary = parsed.toBinary({});
	return new Uint8Array(binary.buffer);
}

async function buildEmptyModule() {
	const wabtApi = await wabt();
	const parsed = wabtApi.parseWat(
		'empty.wat',
		`(module
			(memory (export "mem") 1)
		)`
	);
	const binary = parsed.toBinary({});
	return new Uint8Array(binary.buffer);
}

describe('browser execution', () => {
	it('builds a wasi host with PWD=/ and a root preopen', () => {
		const host = createBrowserWasiHost({
			files: [
				{
					path: 'nested/hello.txt',
					contents: 'hello'
				}
			]
		});

		expect(host.envEntries).toContain('PWD=/');
		expect(host.rootDirectory.contents.get('nested')).toBeDefined();
		expect(host.fds).toHaveLength(5);
	});

	it('executes preview1 wasi modules and captures stdout', async () => {
		const bytes = await buildPreview1StdoutModule();
		const result = await executeBrowserGoArtifact({
			bytes,
			target: 'wasip1/wasm',
			format: 'wasi-core-wasm'
		});

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toBe('hi\n');
		expect(result.stderr).toBe('');
	});

	it('also executes transitional wasip2/wasip3 aliases through the preview1 host', async () => {
		const bytes = await buildPreview1StdoutModule();

		for (const target of ['wasip2/wasm', 'wasip3/wasm'] as const) {
			const result = await executeBrowserGoArtifact({
				bytes,
				target,
				format: 'wasi-core-wasm'
			});

			expect(result.exitCode).toBe(0);
			expect(result.stdout).toBe('hi\n');
		}
	});

	it('executes js/wasm artifacts through wasm_exec.js', async () => {
		const bytes = await buildEmptyModule();
		const result = await executeBrowserGoArtifact(
			{
				bytes,
				target: 'js/wasm',
				format: 'js-wasm'
			},
			{
				manifest: {
					manifestVersion: 1,
					version: 'test-runtime-v1',
					goVersion: 'go1.26.1',
					defaultTarget: 'js/wasm',
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
						'js/wasm': {
							goos: 'js',
							goarch: 'wasm',
							artifactFormat: 'js-wasm',
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
				},
				fetchImpl: async () =>
					new Response(`globalThis.Go = class {
						constructor() {
							this.argv = ['js'];
							this.env = {};
							this.importObject = {};
							this.exit = () => {};
						}
						async run() {
							globalThis.fs.writeSync(1, new TextEncoder().encode('js-hi\\n'));
							this.exit(0);
						}
					};`)
			}
		);

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toBe('js-hi\n');
		expect(result.stderr).toBe('');
	});

	it('feeds js/wasm stdin through the Node-style fs.read bridge', async () => {
		const bytes = await buildEmptyModule();
		let supplied = false;
		const result = await executeBrowserGoArtifact(
			{
				bytes,
				target: 'js/wasm',
				format: 'js-wasm'
			},
			{
				stdin: () => {
					if (supplied) return null;
					supplied = true;
					return '5\n';
				},
				manifest: {
					manifestVersion: 1,
					version: 'test-runtime-v1',
					goVersion: 'go1.26.1',
					defaultTarget: 'js/wasm',
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
						'js/wasm': {
							goos: 'js',
							goarch: 'wasm',
							artifactFormat: 'js-wasm',
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
				},
				fetchImpl: async () =>
					new Response(`globalThis.Go = class {
						constructor() {
							this.argv = ['js'];
							this.env = {};
							this.importObject = {};
							this.exit = () => {};
						}
						async run() {
							const read = (buffer, offset, length) =>
								new Promise((resolve, reject) => {
									globalThis.fs.read(0, buffer, offset, length, null, (error, bytesRead) => {
										if (error) {
											reject(error);
											return;
										}
										resolve(bytesRead ?? 0);
									});
								});
							const firstBuffer = new Uint8Array(4);
							const firstBytes = await read(firstBuffer, 1, 1);
							const secondBuffer = new Uint8Array(4);
							const secondBytes = await read(secondBuffer, 0, 4);
							const eofBytes = await read(new Uint8Array(1), 0, 1);
							if (eofBytes !== 0) throw new Error('expected stdin EOF');
							globalThis.fs.writeSync(1, firstBuffer.subarray(1, 1 + firstBytes));
							globalThis.fs.writeSync(1, secondBuffer.subarray(0, secondBytes));
							this.exit(0);
						}
					};`)
			}
		);

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toBe('5\n');
		expect(result.stderr).toBe('');
	});
});
