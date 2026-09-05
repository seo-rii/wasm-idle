import { createHash } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

// The runtime patcher is a build-time ESM script rather than part of the published TypeScript API.
// @ts-expect-error The build script intentionally has no declaration file.
import { patchRuntime } from '../scripts/patch-runtime.mjs';

const temporaryDirectories: string[] = [];
const nativeInitialization =
	'ENVIRONMENT_IS_WORKER=dotnet_replacements.ENVIRONMENT_IS_WORKER;Module.__dotnet_runtime.initializeReplacements(dotnet_replacements);';

afterEach(async () => {
	await Promise.all(
		temporaryDirectories
			.splice(0)
			.map((directory) => rm(directory, { recursive: true, force: true }))
	);
});

describe('patchRuntime', () => {
	it('promotes only the selected language compiler assemblies', async () => {
		const runtimeDir = await mkdtemp(join(tmpdir(), 'wasm-dotnet-runtime-'));
		temporaryDirectories.push(runtimeDir);
		await writeFile(join(runtimeDir, 'dotnet.native.js'), nativeInitialization);
		await writeFile(
			join(runtimeDir, 'blazor.boot.json'),
			JSON.stringify({
				resources: {
					jsModuleNative: { 'dotnet.native.js': 'original-native-hash' },
					jsModuleWorker: { 'dotnet.native.worker.mjs': 'worker' },
					lazyAssembly: {
						'Microsoft.CodeAnalysis.CSharp.wasm': 'csharp',
						'Microsoft.CodeAnalysis.VisualBasic.wasm': 'visual-basic'
					}
				}
			}),
			'utf8'
		);

		await patchRuntime({
			runtimeDir,
			compilerAssemblies: ['Microsoft.CodeAnalysis.CSharp.wasm']
		});

		const boot = JSON.parse(await readFile(join(runtimeDir, 'blazor.boot.json'), 'utf8'));
		expect(boot.resources.coreAssembly).toEqual({
			'Microsoft.CodeAnalysis.CSharp.wasm': 'csharp'
		});
		expect(boot.resources.lazyAssembly).toEqual({
			'Microsoft.CodeAnalysis.VisualBasic.wasm': 'visual-basic'
		});
	});

	it('preserves the upstream pthread runtime while keeping AOT compilers eager', async () => {
		const runtimeDir = await mkdtemp(join(tmpdir(), 'wasm-dotnet-runtime-'));
		temporaryDirectories.push(runtimeDir);
		await mkdir(runtimeDir, { recursive: true });
		await writeFile(join(runtimeDir, 'dotnet.runtime.js'), 'upstream-runtime', 'utf8');
		await writeFile(join(runtimeDir, 'dotnet.native.worker.mjs'), 'upstream-worker', 'utf8');
		await writeFile(join(runtimeDir, 'dotnet.native.worker.polyfill.mjs'), 'stale', 'utf8');
		await writeFile(join(runtimeDir, 'dotnet.native.js'), nativeInitialization);
		await writeFile(
			join(runtimeDir, 'blazor.boot.json'),
			JSON.stringify({
				resources: {
					jsModuleNative: { 'dotnet.native.js': 'original-native-hash' },
					jsModuleWorker: {
						'dotnet.native.worker.mjs': 'worker'
					},
					coreAssembly: {
						'FSharp.Compiler.Service.wasm': 'fsharp-service',
						'FSharp.Core.wasm': 'fsharp-core',
						'Microsoft.CodeAnalysis.wasm': 'code-analysis',
						'Microsoft.CodeAnalysis.CSharp.wasm': 'csharp',
						'Microsoft.CodeAnalysis.VisualBasic.wasm': 'visual-basic'
					}
				}
			}),
			'utf8'
		);

		await patchRuntime({ runtimeDir });
		await patchRuntime({ runtimeDir });

		const runtimeSource = await readFile(join(runtimeDir, 'dotnet.runtime.js'), 'utf8');
		const boot = JSON.parse(await readFile(join(runtimeDir, 'blazor.boot.json'), 'utf8'));
		expect(runtimeSource).toBe('upstream-runtime');
		expect(boot.resources.jsModuleWorker).toEqual({
			'dotnet.native.worker.mjs': 'worker'
		});
		expect(boot.resources.coreAssembly['FSharp.Compiler.Service.wasm']).toBe('fsharp-service');
		expect(boot.resources.coreAssembly['Microsoft.CodeAnalysis.wasm']).toBe('code-analysis');
		expect(boot.resources.lazyAssembly).toBeUndefined();
		expect(boot.pthreadPoolInitialSize).toBe(8);
		expect(boot.pthreadPoolUnusedSize).toBe(8);
		await expect(
			readFile(join(runtimeDir, 'dotnet.native.worker.polyfill.mjs'))
		).rejects.toThrow();
	});

	it('applies the host-thread replacement before Emscripten decides which thread to attach', async () => {
		const runtimeDir = await mkdtemp(join(tmpdir(), 'wasm-dotnet-runtime-'));
		temporaryDirectories.push(runtimeDir);
		await writeFile(join(runtimeDir, 'dotnet.native.js'), nativeInitialization);
		await writeFile(
			join(runtimeDir, 'blazor.boot.json'),
			JSON.stringify({
				resources: {
					jsModuleWorker: { 'dotnet.native.worker.mjs': 'worker' },
					jsModuleNative: { 'dotnet.native.js': 'stale-hash' }
				}
			})
		);
		await patchRuntime({ runtimeDir });
		await patchRuntime({ runtimeDir });
		const nativeSource = await readFile(join(runtimeDir, 'dotnet.native.js'), 'utf8');
		for (const isPthread of [false, true]) {
			const state = {
				ENVIRONMENT_IS_WORKER: true,
				dotnet_replacements: { ENVIRONMENT_IS_WORKER: true },
				Module: {
					__dotnet_runtime: {
						initializeReplacements(replacements: { ENVIRONMENT_IS_WORKER: boolean }) {
							replacements.ENVIRONMENT_IS_WORKER = isPthread;
						}
					}
				}
			};
			runInNewContext(nativeSource, state);
			expect(state.ENVIRONMENT_IS_WORKER).toBe(isPthread);
		}
		const boot = JSON.parse(await readFile(join(runtimeDir, 'blazor.boot.json'), 'utf8'));
		expect(boot.resources.jsModuleNative['dotnet.native.js']).toBe(
			`sha256-${createHash('sha256').update(nativeSource).digest('base64')}`
		);
	});

	it('rejects an unknown native layout without weakening the boot hash', async () => {
		const runtimeDir = await mkdtemp(join(tmpdir(), 'wasm-dotnet-runtime-'));
		temporaryDirectories.push(runtimeDir);
		await writeFile(join(runtimeDir, 'dotnet.native.js'), 'unknown-layout');
		const boot = JSON.stringify({
			resources: {
				jsModuleWorker: { 'dotnet.native.worker.mjs': 'worker' },
				jsModuleNative: { 'dotnet.native.js': 'original-hash' }
			}
		});
		await writeFile(join(runtimeDir, 'blazor.boot.json'), boot);
		await expect(patchRuntime({ runtimeDir })).rejects.toThrow(
			'Unsupported .NET pthread initialization'
		);
		expect(await readFile(join(runtimeDir, 'blazor.boot.json'), 'utf8')).toBe(boot);
		expect(await readFile(join(runtimeDir, 'dotnet.native.js'), 'utf8')).toBe('unknown-layout');
	});

	it('leaves a single-threaded runtime intact while keeping compilers eager', async () => {
		const runtimeDir = await mkdtemp(join(tmpdir(), 'wasm-dotnet-runtime-'));
		temporaryDirectories.push(runtimeDir);
		await writeFile(join(runtimeDir, 'dotnet.runtime.js'), 'unmodified-runtime', 'utf8');
		await writeFile(join(runtimeDir, 'dotnet.native.worker.polyfill.mjs'), 'stale', 'utf8');
		await writeFile(join(runtimeDir, 'dotnet.native.js'), nativeInitialization);
		await writeFile(
			join(runtimeDir, 'blazor.boot.json'),
			JSON.stringify({
				pthreadPoolInitialSize: 8,
				pthreadPoolUnusedSize: 8,
				resources: {
					jsModuleNative: { 'dotnet.native.js': 'original-native-hash' },
					assembly: {
						'Microsoft.CodeAnalysis.CSharp.wasm': 'csharp'
					},
					jsModuleRuntime: {
						'dotnet.runtime.js': 'runtime-hash'
					}
				}
			}),
			'utf8'
		);

		await patchRuntime({ runtimeDir });

		const runtimeSource = await readFile(join(runtimeDir, 'dotnet.runtime.js'), 'utf8');
		const boot = JSON.parse(await readFile(join(runtimeDir, 'blazor.boot.json'), 'utf8'));
		expect(runtimeSource).toBe('unmodified-runtime');
		expect(boot.resources.jsModuleRuntime['dotnet.runtime.js']).toBe('runtime-hash');
		expect(boot.resources.assembly['Microsoft.CodeAnalysis.CSharp.wasm']).toBe('csharp');
		expect(boot.resources.lazyAssembly).toBeUndefined();
		expect(boot.pthreadPoolInitialSize).toBeUndefined();
		expect(boot.pthreadPoolUnusedSize).toBeUndefined();
		await expect(
			readFile(join(runtimeDir, 'dotnet.native.worker.polyfill.mjs'))
		).rejects.toThrow();
	});
});
