import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LispRuntimeModuleEnvironment } from '@wasm-idle/core';
import { loadVerifiedLispRuntimeAssets } from './lispAssets';
import { WASM_LISP_ASSET_VERSION } from './wasmLispVersion';

const staticDir = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	'../../../static/wasm-lisp'
);
const files = [
	'runtime-manifest.v2.json',
	'index.js.gz',
	'puppyc.core.wasm',
	'puppyc.core2.wasm.gz',
	'puppyc.js'
] as const;
const installed = Object.fromEntries(
	files.map((file) => [file, Uint8Array.from(readFileSync(path.join(staticDir, file)))])
) as Record<(typeof files)[number], Uint8Array>;

const config = Object.freeze({
	moduleUrl: `https://static.example.com/wasm-lisp/index.js?v=${WASM_LISP_ASSET_VERSION}`,
	manifestUrl: `https://static.example.com/wasm-lisp/runtime-manifest.v2.json?v=${WASM_LISP_ASSET_VERSION}`,
	manifestFingerprint: WASM_LISP_ASSET_VERSION
});

function moduleEnvironment() {
	const revoked: string[] = [];
	let nextUrl = 0;
	const environment: LispRuntimeModuleEnvironment = {
		createObjectUrl: () => `blob:scheme-fixture-${nextUrl++}`,
		revokeObjectUrl: (url) => revoked.push(url),
		importModule: vi
			.fn()
			.mockResolvedValueOnce({
				createLispCompiler: vi.fn(),
				executeBrowserLispArtifact: vi.fn()
			})
			.mockResolvedValueOnce({ instantiate: vi.fn() })
	};
	return { environment, revoked };
}

const decompressGzip = async (bytes: Uint8Array, expectedBytes: number) => {
	const output = Uint8Array.from(gunzipSync(bytes));
	expect(output.byteLength).toBe(expectedBytes);
	return output;
};

describe('verified Lisp runtime assets', () => {
	beforeEach(() => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async (input: string | URL | Request) => {
				const requestUrl = new URL(
					typeof input === 'string' || input instanceof URL ? input : input.url
				);
				const bytes =
					installed[path.basename(requestUrl.pathname) as keyof typeof installed];
				if (!bytes) throw new Error(`Unexpected Lisp fixture request: ${requestUrl.href}`);
				const response = new Response(Uint8Array.from(bytes).buffer, {
					headers: { 'content-length': String(bytes.byteLength) }
				});
				Object.defineProperty(response, 'url', { value: requestUrl.href });
				return response;
			})
		);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('verifies every storage and logical receipt before materializing modules', async () => {
		const { environment, revoked } = moduleEnvironment();
		const runtime = await loadVerifiedLispRuntimeAssets(config, {
			moduleEnvironment: environment,
			decompressGzip
		});

		expect(runtime.manifest.fingerprint).toBe(WASM_LISP_ASSET_VERSION);
		expect(runtime.module.createLispCompiler).toBeTypeOf('function');
		expect(runtime.compilerModule.instantiate).toBeTypeOf('function');
		expect(runtime.compilerCoreModules['puppyc.core.wasm']).toBeInstanceOf(WebAssembly.Module);
		expect(runtime.compilerCoreModules['puppyc.core2.wasm']).toBeInstanceOf(WebAssembly.Module);
		expect(environment.importModule).toHaveBeenCalledTimes(2);
		expect(revoked).toEqual(['blob:scheme-fixture-1', 'blob:scheme-fixture-0']);
	});

	it('accepts transparently decoded gzip bodies only after logical receipt verification', async () => {
		const manifest = JSON.parse(
			new TextDecoder().decode(installed['runtime-manifest.v2.json'])
		) as {
			assets: Array<{ path: string; size: number }>;
			storage: Array<{ logicalPath: string; path: string; size: number }>;
		};
		const logicalByPath = new Map(manifest.assets.map((asset) => [asset.path, asset]));
		const storageByPath = new Map(manifest.storage.map((asset) => [asset.path, asset]));
		const fetchMock = vi.mocked(fetch);
		fetchMock.mockImplementation(async (input: string | URL | Request) => {
			const requestUrl = new URL(
				typeof input === 'string' || input instanceof URL ? input : input.url
			);
			const file = path.basename(requestUrl.pathname) as keyof typeof installed;
			const storage = storageByPath.get(file);
			const bytes = storage?.path.endsWith('.gz')
				? Uint8Array.from(gunzipSync(installed[file]))
				: installed[file];
			const response = new Response(Uint8Array.from(bytes).buffer, {
				headers: {
					'content-encoding': storage?.path.endsWith('.gz') ? 'gzip' : 'identity',
					'content-length': String(storage?.size ?? bytes.byteLength)
				}
			});
			Object.defineProperty(response, 'url', { value: requestUrl.href });
			return response;
		});
		const { environment } = moduleEnvironment();
		const decompress = vi.fn(decompressGzip);

		const runtime = await loadVerifiedLispRuntimeAssets(config, {
			moduleEnvironment: environment,
			decompressGzip: decompress
		});

		expect(runtime.manifest.fingerprint).toBe(WASM_LISP_ASSET_VERSION);
		expect(decompress).not.toHaveBeenCalled();
		for (const storage of manifest.storage.filter((asset) => asset.path.endsWith('.gz'))) {
			expect(logicalByPath.get(storage.logicalPath)?.size).toBeGreaterThan(storage.size);
		}
	});

	it('rejects a corrupted stored asset before importing any module', async () => {
		const corrupted = Uint8Array.from(installed['puppyc.js']);
		corrupted[0] ^= 0xff;
		const fetchMock = vi.mocked(fetch);
		fetchMock.mockImplementation(async (input: string | URL | Request) => {
			const requestUrl = new URL(
				typeof input === 'string' || input instanceof URL ? input : input.url
			);
			const file = path.basename(requestUrl.pathname) as keyof typeof installed;
			const bytes = file === 'puppyc.js' ? corrupted : installed[file];
			const response = new Response(Uint8Array.from(bytes).buffer, {
				headers: { 'content-length': String(bytes.byteLength) }
			});
			Object.defineProperty(response, 'url', { value: requestUrl.href });
			return response;
		});
		const { environment } = moduleEnvironment();

		await expect(
			loadVerifiedLispRuntimeAssets(config, {
				moduleEnvironment: environment,
				decompressGzip
			})
		).rejects.toMatchObject({ name: 'AssetIntegrityError', runtimeId: 'LISP' });
		expect(environment.importModule).not.toHaveBeenCalled();
	});

	it('requires an explicit fingerprint before fetching the manifest', async () => {
		await expect(
			loadVerifiedLispRuntimeAssets({ ...config, manifestFingerprint: '' })
		).rejects.toThrow(/manifestFingerprint trust anchor/u);
		expect(fetch).not.toHaveBeenCalled();
	});
});
