// @vitest-environment node
import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import {
	createRuntimeAssetsKey,
	normalizeLanguageId,
	resolveExecutionLimits
} from '@wasm-idle/core';
import {
	COMMONLISP_RUNTIME_MANIFEST,
	COMMONLISP_WASM_STORAGE_PATH,
	decompressCommonLispWasm,
	preflightCommonLispRuntimeAssets,
	resolveCommonLispRuntimeAssetConfig
} from './commonlispAssets';
import { WASM_COMMONLISP_PROFILE as profile } from './wasmCommonLispVersion';
import { StaticStdinRingHost } from './staticStdinRing';

const workerSource = async () =>
	(
		await readFile(
			new URL(
				'../../../scripts/runtime-workers/wasm-commonlisp-runner-worker.js',
				import.meta.url
			),
			'utf8'
		)
	).replace('__WASM_IDLE_COMMONLISP_ASSET_LOCK__', '{}');

describe('Common Lisp reviewed consumer profile', () => {
	it('pins ECL 26.5.5 from an immutable wasm-llvm revision', () => {
		expect(profile.version).toBe('26.5.5');
		expect(profile.source).toBe('74780fa2cd2874889793a657d55b557488d3e346');
		expect(profile.producerRevision).toMatch(/^[0-9a-f]{40}$/);
		expect(Object.keys(profile.assets).sort()).toEqual([
			'ecl.mjs',
			'ecl.wasm.gz',
			'producer-receipt.json'
		]);
		expect(Object.keys(profile.runtime)).toEqual(['ecl.wasm']);
		expect(profile.assets['ecl.wasm.gz'].bytes).toBeLessThan(profile.runtime['ecl.wasm'].bytes);
		expect(COMMONLISP_RUNTIME_MANIFEST.runtimes[0].assets).toContainEqual(
			expect.objectContaining({
				key: 'ecl.wasm',
				path: COMMONLISP_WASM_STORAGE_PATH,
				encoding: 'gzip',
				compressedSha256: profile.assets['ecl.wasm.gz'].sha256,
				uncompressedSha256: profile.runtime['ecl.wasm'].sha256
			})
		);
		expect(COMMONLISP_RUNTIME_MANIFEST.runtimes[0].identity).toMatchObject({
			languageId: 'COMMONLISP',
			implementationId: 'ecl-emscripten',
			implementationVersion: '26.5.5'
		});
	});

	it('keeps the Scheme LISP id separate and routes Common Lisp aliases', () => {
		expect(normalizeLanguageId('CL')).toBe('COMMONLISP');
		expect(normalizeLanguageId('ecl')).toBe('COMMONLISP');
		expect(normalizeLanguageId('common-lisp')).toBe('COMMONLISP');
		expect(normalizeLanguageId('LISP')).toBe('LISP');
		expect(normalizeLanguageId('SCHEME')).toBe('LISP');
	});

	it('relocates the fixed receipt bundle', () => {
		const resolved = resolveCommonLispRuntimeAssetConfig(
			{ commonlisp: { baseUrl: '/mirror/ecl' } },
			'https://example.com/app/'
		);
		expect(resolved.baseUrl).toBe('https://example.com/mirror/ecl/');
		expect(resolved.workerReceipt).toEqual(profile.workerReceipt);
		expect(
			resolveCommonLispRuntimeAssetConfig({ rootUrl: '/root/' }, 'https://example.com/')
				.baseUrl
		).toBe('https://example.com/root/wasm-commonlisp/');
		expect(createRuntimeAssetsKey({ commonlisp: { baseUrl: '/a/' } })).not.toEqual(
			createRuntimeAssetsKey({ commonlisp: { baseUrl: '/b/' } })
		);
	});

	it.each(['https://user:pass@example.com/', 'file:///tmp/', 'https://example.com/?q=1'])(
		'rejects invalid asset root %s',
		(baseUrl) => {
			expect(() =>
				resolveCommonLispRuntimeAssetConfig(
					{ commonlisp: { baseUrl } },
					'https://example.com/'
				)
			).toThrow();
		}
	);

	it('rejects an insufficient memory budget before downloading ECL', async () => {
		const fetch = vi.fn();
		await expect(
			preflightCommonLispRuntimeAssets('https://example.com/runtime/', {
				limits: resolveExecutionLimits({ maxWasmMemoryBytes: 63 * 1024 * 1024 }),
				fetch
			})
		).rejects.toMatchObject({ code: 'resource-limit', resource: 'wasm-memory' });
		expect(fetch).not.toHaveBeenCalled();
	});

	it('rejects mismatched asset bytes before executing ECL', async () => {
		const fetch = vi.fn(async (url: RequestInfo | URL) => {
			const file = new URL(String(url)).pathname.split('/').pop();
			const name = (
				file === COMMONLISP_WASM_STORAGE_PATH ? 'ecl.wasm.gz' : file
			) as keyof typeof profile.assets;
			const response = new Response(new Uint8Array(profile.assets[name].bytes), {
				status: 200,
				headers: {
					'Content-Type': name.endsWith('.json')
						? 'application/json'
						: name.endsWith('.mjs')
							? 'text/javascript'
							: 'application/wasm'
				}
			});
			Object.defineProperty(response, 'url', { value: String(url) });
			return response;
		});
		await expect(
			preflightCommonLispRuntimeAssets('https://example.com/runtime/', {
				limits: resolveExecutionLimits(),
				fetch
			})
		).rejects.toMatchObject({ code: 'asset-integrity' });
	});

	it('rejects gzip deliveries that do not decode to the reviewed ecl.wasm', async () => {
		const { gzipSync } = await import('node:zlib');
		await expect(decompressCommonLispWasm(new Uint8Array([1, 2, 3]))).rejects.toMatchObject({
			code: 'asset-integrity'
		});
		await expect(
			decompressCommonLispWasm(gzipSync(new Uint8Array(profile.runtime['ecl.wasm'].bytes)))
		).rejects.toMatchObject({ code: 'asset-integrity' });
		await expect(
			decompressCommonLispWasm(
				gzipSync(new Uint8Array(profile.runtime['ecl.wasm'].bytes + 1))
			)
		).rejects.toMatchObject({ code: 'asset-integrity' });
	});

	it('bounds memory, validates workspace paths and builds a LOAD form that always exits', async () => {
		const helpers = new Function(
			'self',
			`${await workerSource()}\nreturn {createBoundedMemory, workspacePath, loadForm, conditionSummary};`
		)({ postMessage() {} });
		const memory = helpers.createBoundedMemory(64 * 1024 * 1024);
		expect(() => memory.grow(1)).toThrow(RangeError);
		expect(() => helpers.createBoundedMemory(32 * 1024 * 1024)).toThrow(/at least/);
		for (const bad of ['../x.lisp', '/abs.lisp', 'a\\b.lisp', 'q"uote.lisp', 'a/./b.lisp'])
			expect(() => helpers.workspacePath(bad)).toThrow();
		expect(helpers.workspacePath('lib/util.lisp')).toBe('/workspace/lib/util.lisp');
		const form = helpers.loadForm('main.lisp');
		expect(form).toContain('(load "main.lisp" :verbose nil :print nil)');
		expect(form).toMatch(/^\(progn \(setq \*load-verbose\* nil \*compile-verbose\* nil\)/);
		expect(form).toContain('serious-condition');
		expect(form.endsWith('(ext:quit 0)))')).toBe(true);
		expect(form.split('(').length).toBe(form.split(')').length);
		expect(helpers.conditionSummary('warn\n;;; Unhandled SIMPLE-ERROR: boom 7\n')).toBe(
			'SIMPLE-ERROR: boom 7'
		);
	});

	it('returns available stdin bytes before the next line or EOF arrives', async () => {
		const createReader = new Function(
			'self',
			`${await workerSource()}\nreturn createSharedStdinReader;`
		)({ postMessage() {} });
		const host = new StaticStdinRingHost({ capacity: 16, maxBufferedBytes: 32 });
		const input = createReader(host.descriptor);
		const stream = { node: { atime: 0 } };
		const buffer = new Uint8Array(1024);
		const wait = vi.spyOn(Atomics, 'wait').mockImplementation(() => {
			throw new Error('A partial read must not wait for the next input line');
		});
		try {
			host.enqueue('ada\n');
			expect(input.read(stream, buffer, 0, 1024)).toBe(4);
			expect(new TextDecoder().decode(buffer.subarray(0, 4))).toBe('ada\n');
			host.close();
			expect(input.read(stream, buffer, 0, 1024)).toBe(0);
			expect(wait).not.toHaveBeenCalled();
		} finally {
			wait.mockRestore();
			host.cancel();
		}
	});

	it('serves prebuffered stdin when no shared channel is available', async () => {
		const createReader = new Function(
			'self',
			`${await workerSource()}\nreturn createBufferedStdinReader;`
		)({ postMessage() {} });
		const input = createReader('12\n');
		const buffer = new Uint8Array(8);
		expect(input.read({ node: { atime: 0 } }, buffer, 0, 8)).toBe(3);
		expect(input.read({ node: { atime: 0 } }, buffer, 0, 8)).toBe(0);
	});
});
