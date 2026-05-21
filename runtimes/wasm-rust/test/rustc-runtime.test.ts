import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

import { File, OpenFile } from '@bjorn3/browser_wasi_shim';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { instantiateRustcInstance } from '../src/rustc-runtime.js';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rustcWasmPath = path.join(projectRoot, 'dist', 'runtime', 'rustc', 'rustc.wasm.gz');
const rustcWasmEnvShims =
	process.env.WASM_RUST_SKIP_DIST_TESTS === '1'
		? describe.skip
		: existsSync(rustcWasmPath)
			? describe
			: describe.skip;

rustcWasmEnvShims('rustc wasm env shims', () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('provides callable env shims for rustc.wasm function imports', async () => {
		const rustcBytes = gunzipSync(await readFile(rustcWasmPath));
		const rustcModule = new WebAssembly.Module(rustcBytes);
		const rustcEnvFunctionImports = WebAssembly.Module.imports(rustcModule).filter(
			(entry) => entry.module === 'env' && entry.kind === 'function'
		);
		const memory = new WebAssembly.Memory({
			initial: 454,
			maximum: 16_384,
			shared: true
		});
		const instantiateSpy = vi.spyOn(WebAssembly, 'instantiate').mockResolvedValue({
			module: rustcModule,
			instance: {
				exports: {
					memory,
					_start() {},
					wasi_thread_start() {}
				}
			}
		} as WebAssembly.WebAssemblyInstantiatedSource);

		expect(rustcEnvFunctionImports.length).toBeGreaterThan(0);

		await instantiateRustcInstance({
			rustcModule,
			memory,
			args: ['rustc'],
			fds: [
				new OpenFile(new File(new Uint8Array(), { readonly: true })),
				new OpenFile(new File(new Uint8Array())),
				new OpenFile(new File(new Uint8Array()))
			],
			threadSpawner: () => 1
		});

		expect(instantiateSpy).toHaveBeenCalledOnce();
		const importObject = instantiateSpy.mock.calls[0]?.[1] as {
			env: Record<string, unknown>;
		};

		expect(importObject.env.memory).toBe(memory);
		for (const entry of rustcEnvFunctionImports) {
			expect(typeof importObject.env[entry.name]).toBe('function');
		}
	});
});
