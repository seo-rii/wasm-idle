// @vitest-environment node
import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import { resolveExecutionLimits, createRuntimeAssetsKey } from '@wasm-idle/core';
import {
	LFORTRAN_RUNTIME_MANIFEST,
	preflightLfortranRuntimeAssets,
	resolveLfortranRuntimeAssetConfig
} from './lfortranAssets';
import { WASM_LFORTRAN_PROFILE as profile } from './wasmLfortranVersion';
import { StaticStdinRingHost } from './staticStdinRing';

describe('LFortran reviewed consumer profile', () => {
	it('relocates a fixed receipt bundle without changing the f2c Fortran profile', () => {
		const resolved = resolveLfortranRuntimeAssetConfig(
			{ lfortran: { baseUrl: '/mirror/lfortran' } },
			'https://example.com/app/'
		);
		expect(resolved.baseUrl).toBe('https://example.com/mirror/lfortran/');
		expect(resolved.workerReceipt).toEqual(profile.workerReceipt);
		expect(LFORTRAN_RUNTIME_MANIFEST.runtimes[0].identity.languageId).toBe('LFORTRAN');
		expect(LFORTRAN_RUNTIME_MANIFEST.runtimes[0].assets).toHaveLength(4);
		expect(createRuntimeAssetsKey({ lfortran: { baseUrl: '/a/' } })).not.toEqual(
			createRuntimeAssetsKey({ lfortran: { baseUrl: '/b/' } })
		);
	});
	it.each(['https://user:pass@example.com/', 'file:///tmp/', 'https://example.com/?q=1'])(
		'rejects invalid asset root %s',
		(baseUrl) => {
			expect(() =>
				resolveLfortranRuntimeAssetConfig({ lfortran: { baseUrl } }, 'https://example.com/')
			).toThrow();
		}
	);
	it('rejects an insufficient memory budget before downloading the compiler', async () => {
		const fetch = vi.fn();
		await expect(
			preflightLfortranRuntimeAssets('https://example.com/runtime/', {
				limits: resolveExecutionLimits({ maxWasmMemoryBytes: 127 * 1024 * 1024 }),
				fetch
			})
		).rejects.toMatchObject({ code: 'resource-limit', resource: 'wasm-memory' });
		expect(fetch).not.toHaveBeenCalled();
	});
	it('rejects mismatched producer receipt bytes before executing any compiler', async () => {
		const fetch = vi.fn(async (url: RequestInfo | URL) => {
			const name = new URL(String(url)).pathname
				.split('/')
				.pop()!
				.replace(/\.bin$/, '') as keyof typeof profile.assets;
			const response = new Response(new Uint8Array(profile.assets[name].bytes), {
				status: 200,
				headers: {
					'Content-Type': name.endsWith('.json')
						? 'application/json'
						: name.endsWith('.js')
							? 'text/javascript'
							: name.endsWith('.wasm')
								? 'application/wasm'
								: 'application/octet-stream'
				}
			});
			Object.defineProperty(response, 'url', { value: String(url) });
			return response;
		});
		await expect(
			preflightLfortranRuntimeAssets('https://example.com/runtime/', {
				limits: resolveExecutionLimits(),
				fetch
			})
		).rejects.toMatchObject({ code: 'asset-integrity' });
	});
	it('enforces the memory maximum and maps upstream source diagnostics', async () => {
		const source = (
			await readFile(
				new URL(
					'../../../scripts/runtime-workers/wasm-lfortran-runner-worker.js',
					import.meta.url
				),
				'utf8'
			)
		).replace('__WASM_IDLE_LFORTRAN_ASSET_LOCK__', '{}');
		const messages: unknown[] = [];
		const helpers = new Function(
			'self',
			`${source}\nreturn {createBoundedMemory, reportDiagnostics, workspacePath};`
		)({ postMessage: (message: unknown) => messages.push(message) });
		const memory = helpers.createBoundedMemory(128 * 1024 * 1024);
		expect(() => memory.grow(1)).toThrow(RangeError);
		expect(() => helpers.workspacePath('../lib/main.f90')).toThrow();
		helpers.reportDiagnostics(
			"semantic error: Variable 'missing' is not declared\n --> /workspace/main.f90:4:11\n"
		);
		expect(messages).toEqual([
			{
				diagnostic: {
					severity: 'error',
					message: "Variable 'missing' is not declared",
					lineNumber: 4,
					columnNumber: 11,
					fileName: 'main.f90'
				}
			}
		]);
	});
	it('returns available stdin bytes before the next line or EOF arrives', async () => {
		const source = (
			await readFile(
				new URL(
					'../../../scripts/runtime-workers/wasm-lfortran-runner-worker.js',
					import.meta.url
				),
				'utf8'
			)
		).replace('__WASM_IDLE_LFORTRAN_ASSET_LOCK__', '{}');
		const createReader = new Function('self', `${source}\nreturn createSharedStdinReader;`)({
			postMessage() {}
		});
		const host = new StaticStdinRingHost({ capacity: 16, maxBufferedBytes: 32 });
		const input = createReader(host.descriptor);
		const stream = { node: { atime: 0 } };
		const buffer = new Uint8Array(1024);
		const wait = vi.spyOn(Atomics, 'wait').mockImplementation(() => {
			throw new Error('A partial read must not wait for the next input line');
		});
		try {
			host.enqueue('3\n');
			expect(input.read(stream, buffer, 0, 0)).toBe(0);
			expect(input.read(stream, buffer, 4, 1020)).toBe(2);
			expect(new TextDecoder().decode(buffer.subarray(4, 6))).toBe('3\n');
			host.enqueue('7\n');
			expect(input.read(stream, buffer, 0, 1024)).toBe(2);
			expect(new TextDecoder().decode(buffer.subarray(0, 2))).toBe('7\n');
			host.close();
			expect(input.read(stream, buffer, 0, 1024)).toBe(0);
			expect(wait).not.toHaveBeenCalled();
		} finally {
			wait.mockRestore();
			host.cancel();
		}
	});
});
