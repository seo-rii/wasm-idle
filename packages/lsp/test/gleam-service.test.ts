import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
	createGleamWorkerService,
	type GleamCompiler,
	type GleamCompilerAssets
} from '../src/gleam/index.js';

const baseUrl = 'https://static.example.com/wasm-gleam/';
const manifestUrl = `${baseUrl}source-manifest.v2.json`;
const textEncoder = new TextEncoder();

type Receipt = { path: string; size: number; sha256: string };

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

function computeFingerprint(assets: Receipt[], compilerVersion: string) {
	const canonical = `wasm-idle:gleam-runtime-manifest:v2\nformat\0wasm-gleam-runtime-manifest-v2\ncompilerVersion\0${compilerVersion}\n${assets
		.map((receipt) => `${receipt.path}\0${receipt.size}\0${receipt.sha256}\n`)
		.join('')}`;
	return sha256(textEncoder.encode(canonical));
}

function createRuntimeFixture() {
	const assetBytes = new Map<string, Uint8Array>([
		[
			'compiler/gleam_wasm.js',
			textEncoder.encode('export default async function init(_bytes) {}\n')
		],
		['compiler/gleam_wasm_bg.wasm', Uint8Array.from([0, 97, 115, 109])],
		[
			'src/gleam/io.gleam',
			textEncoder.encode('pub fn println(_value: String) -> Nil { Nil }\n')
		]
	]);
	const assets = [...assetBytes]
		.map(([path, bytes]) => ({ path, size: bytes.byteLength, sha256: sha256(bytes) }))
		.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
	const compilerVersion = 'v-test';
	const fingerprint = computeFingerprint(assets, compilerVersion);
	const sourceReceipt = assets.find((receipt) => receipt.path === 'src/gleam/io.gleam')!;
	return {
		assetBytes,
		fingerprint,
		manifest: {
			format: 'wasm-gleam-runtime-manifest-v2',
			compilerVersion,
			fingerprint,
			assets,
			files: [
				{
					path: 'gleam/io.gleam',
					size: sourceReceipt.size,
					sha256: sourceReceipt.sha256
				}
			],
			javascriptFiles: [] as string[]
		}
	};
}

function stubRuntimeFetch({
	fixture = createRuntimeFixture(),
	manifest = fixture.manifest,
	assetOverrides = new Map<string, Uint8Array>()
}: {
	fixture?: ReturnType<typeof createRuntimeFixture>;
	manifest?: Record<string, unknown>;
	assetOverrides?: Map<string, Uint8Array>;
} = {}) {
	const fetchMock = vi.fn(async (input: string | URL | Request) => {
		const url = String(input);
		if (url === manifestUrl) return new Response(JSON.stringify(manifest));
		for (const [path, bytes] of fixture.assetBytes) {
			const assetUrl = new URL(path, baseUrl);
			assetUrl.searchParams.set('v', fixture.fingerprint);
			if (url === assetUrl.href) return new Response(assetOverrides.get(path) ?? bytes);
		}
		return new Response('missing', { status: 404 });
	});
	vi.stubGlobal('fetch', fetchMock);
	return fetchMock;
}

const context = () => ({
	documents: new Map(),
	publishDiagnostics: vi.fn(),
	reportProgress: vi.fn()
});

describe('createGleamWorkerService', () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});
	afterEach(() => {
		vi.unstubAllGlobals();
		delete (globalThis as typeof globalThis & { __wasmIdleGleamInit?: number[] })
			.__wasmIdleGleamInit;
	});

	it.each([
		[['../../private.gleam'], 'unsafe path'],
		[['%2e%2e/private.gleam'], 'unsafe path'],
		[['gleam/io.gleam', 'gleam/io.gleam'], 'duplicate path']
	])('rejects unsafe source manifest entries %j', async (files, expectedMessage) => {
		const fixture = createRuntimeFixture();
		const sourceReceipt = fixture.manifest.files[0];
		const manifest = structuredClone(fixture.manifest) as Record<string, unknown>;
		manifest.files = files.map((path) => ({ ...sourceReceipt, path }));
		const compiler: GleamCompiler = {
			reset_filesystem: vi.fn(),
			write_file: vi.fn(),
			write_module: vi.fn(),
			compile_package: vi.fn()
		};
		const fetchMock = stubRuntimeFetch({ fixture, manifest });
		const service = createGleamWorkerService(async () => compiler);

		await expect(
			service.initialize?.(
				{
					baseUrl,
					manifestUrl,
					manifestFingerprint: fixture.fingerprint
				},
				context()
			)
		).rejects.toThrow(expectedMessage);
		expect(fetchMock).toHaveBeenCalledOnce();
	});

	it('rejects a source manifest above the file-count limit before fetching sources', async () => {
		const fixture = createRuntimeFixture();
		const sourceReceipt = fixture.manifest.files[0];
		const manifest = structuredClone(fixture.manifest) as Record<string, unknown>;
		manifest.files = Array.from({ length: 4_097 }, (_, index) => ({
			...sourceReceipt,
			path: `module_${index}.gleam`
		}));
		const compiler: GleamCompiler = {
			reset_filesystem: vi.fn(),
			write_file: vi.fn(),
			write_module: vi.fn(),
			compile_package: vi.fn()
		};
		const fetchMock = stubRuntimeFetch({ fixture, manifest });
		const service = createGleamWorkerService(async () => compiler);

		await expect(
			service.initialize?.(
				{
					baseUrl,
					manifestUrl,
					manifestFingerprint: fixture.fingerprint
				},
				context()
			)
		).rejects.toThrow('exceeds the 4096 file limit');
		expect(fetchMock).toHaveBeenCalledOnce();
	});

	it('requires a host-pinned manifest fingerprint before fetching assets', async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);
		const loadCompiler = vi.fn();
		const service = createGleamWorkerService(loadCompiler);

		await expect(service.initialize?.({ baseUrl, manifestUrl }, context())).rejects.toThrow(
			'requires a valid manifest fingerprint'
		);
		expect(fetchMock).not.toHaveBeenCalled();
		expect(loadCompiler).not.toHaveBeenCalled();
	});

	it('rejects a manifest that differs from the host-pinned fingerprint', async () => {
		const fixture = createRuntimeFixture();
		const fetchMock = stubRuntimeFetch({ fixture });
		const loadCompiler = vi.fn();
		const service = createGleamWorkerService(loadCompiler);

		await expect(
			service.initialize?.(
				{ baseUrl, manifestUrl, manifestFingerprint: '0'.repeat(64) },
				context()
			)
		).rejects.toThrow('does not match the pinned fingerprint');
		expect(fetchMock).toHaveBeenCalledOnce();
		expect(loadCompiler).not.toHaveBeenCalled();
	});

	it('rejects a modified receipt graph before fetching runtime assets', async () => {
		const fixture = createRuntimeFixture();
		const manifest = structuredClone(fixture.manifest);
		manifest.assets[0].size += 1;
		const fetchMock = stubRuntimeFetch({ fixture, manifest });
		const loadCompiler = vi.fn();
		const service = createGleamWorkerService(loadCompiler);

		await expect(
			service.initialize?.(
				{ baseUrl, manifestUrl, manifestFingerprint: fixture.fingerprint },
				context()
			)
		).rejects.toMatchObject({ code: 'asset-integrity', runtimeId: 'gleam-lsp' });
		expect(fetchMock).toHaveBeenCalledOnce();
		expect(loadCompiler).not.toHaveBeenCalled();
	});

	it.each(['missing compiler receipt', 'undeclared extra receipt'])(
		'rejects an inconsistent runtime allowlist with %s',
		async (scenario) => {
			const fixture = createRuntimeFixture();
			const manifest = structuredClone(fixture.manifest);
			if (scenario === 'missing compiler receipt') {
				manifest.assets = manifest.assets.filter(
					(receipt) => receipt.path !== 'compiler/gleam_wasm_bg.wasm'
				);
			} else {
				const extraBytes = textEncoder.encode('unexpected');
				manifest.assets.push({
					path: 'javascript/unexpected.mjs',
					size: extraBytes.byteLength,
					sha256: sha256(extraBytes)
				});
				manifest.assets.sort((left, right) =>
					left.path < right.path ? -1 : left.path > right.path ? 1 : 0
				);
			}
			manifest.fingerprint = computeFingerprint(manifest.assets, manifest.compilerVersion);
			const fetchMock = stubRuntimeFetch({ fixture, manifest });
			const loadCompiler = vi.fn();
			const service = createGleamWorkerService(loadCompiler);

			await expect(
				service.initialize?.(
					{
						baseUrl,
						manifestUrl,
						manifestFingerprint: manifest.fingerprint
					},
					context()
				)
			).rejects.toThrow('asset allowlist is inconsistent');
			expect(fetchMock).toHaveBeenCalledOnce();
			expect(loadCompiler).not.toHaveBeenCalled();
		}
	);

	it.each(['compiler/gleam_wasm.js', 'compiler/gleam_wasm_bg.wasm', 'src/gleam/io.gleam'])(
		'rejects modified verified asset %s before loading the compiler',
		async (assetPath) => {
			const fixture = createRuntimeFixture();
			const modifiedBytes = fixture.assetBytes.get(assetPath)!.slice();
			modifiedBytes[0] ^= 1;
			const fetchMock = stubRuntimeFetch({
				fixture,
				assetOverrides: new Map([[assetPath, modifiedBytes]])
			});
			const loadCompiler = vi.fn();
			const service = createGleamWorkerService(loadCompiler);

			await expect(
				service.initialize?.(
					{ baseUrl, manifestUrl, manifestFingerprint: fixture.fingerprint },
					context()
				)
			).rejects.toMatchObject({ code: 'asset-integrity', runtimeId: 'gleam-lsp' });
			expect(fetchMock).toHaveBeenCalled();
			expect(loadCompiler).not.toHaveBeenCalled();
		}
	);

	it('rejects a truncated source before loading the compiler', async () => {
		const fixture = createRuntimeFixture();
		const sourceBytes = fixture.assetBytes.get('src/gleam/io.gleam')!;
		const fetchMock = stubRuntimeFetch({
			fixture,
			assetOverrides: new Map([['src/gleam/io.gleam', sourceBytes.slice(0, -1)]])
		});
		const loadCompiler = vi.fn();
		const service = createGleamWorkerService(loadCompiler);

		await expect(
			service.initialize?.(
				{ baseUrl, manifestUrl, manifestFingerprint: fixture.fingerprint },
				context()
			)
		).rejects.toMatchObject({ code: 'asset-integrity', runtimeId: 'gleam-lsp' });
		expect(fetchMock).toHaveBeenCalled();
		expect(loadCompiler).not.toHaveBeenCalled();
	});

	it('keeps the previous compiler and cache identity when reinitialization fails', async () => {
		const fixture = createRuntimeFixture();
		stubRuntimeFetch({ fixture });
		const compiler: GleamCompiler = {
			reset_filesystem: vi.fn(),
			delete_project: vi.fn(),
			write_file: vi.fn(),
			write_module: vi.fn(),
			compile_package: vi.fn()
		};
		const loadCompiler = vi.fn(async () => compiler);
		const service = createGleamWorkerService(loadCompiler);
		const serviceContext = context();
		const document = {
			uri: 'file:///workspace/main.gleam',
			languageId: 'gleam',
			version: 1,
			text: 'pub fn main() { Nil }\n'
		};

		await service.initialize?.(
			{ baseUrl, manifestUrl, manifestFingerprint: fixture.fingerprint },
			serviceContext
		);
		await service.diagnostics?.(document, serviceContext);
		await expect(
			service.initialize?.(
				{
					baseUrl: 'https://other.example.com/wasm-gleam/',
					manifestUrl,
					manifestFingerprint: '0'.repeat(64)
				},
				serviceContext
			)
		).rejects.toThrow('does not match the pinned fingerprint');
		await service.diagnostics?.(document, serviceContext);

		expect(loadCompiler).toHaveBeenCalledOnce();
		expect(compiler.compile_package).toHaveBeenCalledOnce();
	});

	it('imports the compiler from verified bytes and initializes it with verified Wasm', async () => {
		const fixture = createRuntimeFixture();
		stubRuntimeFetch({ fixture });
		const importedModuleSource = `
export function reset_filesystem() {}
export function write_file() {}
export function write_module() {}
export function compile_package() {}
export default async function init(bytes) {
  globalThis.__wasmIdleGleamInit = Array.from(bytes);
}
`;
		const moduleUrl = `data:text/javascript;charset=utf-8,${encodeURIComponent(importedModuleSource)}`;
		const createObjectUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue(moduleUrl);
		const revokeObjectUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
		const service = createGleamWorkerService();

		await service.initialize?.(
			{ baseUrl, manifestUrl, manifestFingerprint: fixture.fingerprint },
			context()
		);

		const compilerBlob = createObjectUrl.mock.calls[0][0] as Blob;
		expect(new Uint8Array(await compilerBlob.arrayBuffer())).toEqual(
			fixture.assetBytes.get('compiler/gleam_wasm.js')
		);
		expect(
			(globalThis as typeof globalThis & { __wasmIdleGleamInit?: number[] })
				.__wasmIdleGleamInit
		).toEqual([...fixture.assetBytes.get('compiler/gleam_wasm_bg.wasm')!]);
		expect(revokeObjectUrl).toHaveBeenCalledOnce();
		expect(revokeObjectUrl).toHaveBeenCalledWith(moduleUrl);
	});

	it('revokes the verified compiler Blob URL when module evaluation fails', async () => {
		const fixture = createRuntimeFixture();
		stubRuntimeFetch({ fixture });
		const moduleUrl = `data:text/javascript;charset=utf-8,${encodeURIComponent(
			'throw new Error("synthetic compiler import failure");'
		)}`;
		vi.spyOn(URL, 'createObjectURL').mockReturnValue(moduleUrl);
		const revokeObjectUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
		const service = createGleamWorkerService();

		await expect(
			service.initialize?.(
				{ baseUrl, manifestUrl, manifestFingerprint: fixture.fingerprint },
				context()
			)
		).rejects.toThrow('synthetic compiler import failure');
		expect(revokeObjectUrl).toHaveBeenCalledOnce();
		expect(revokeObjectUrl).toHaveBeenCalledWith(moduleUrl);
	});

	it('uses the real Gleam compiler API for diagnostics', async () => {
		const fixture = createRuntimeFixture();
		const compiler: GleamCompiler = {
			reset_filesystem: vi.fn(),
			delete_project: vi.fn(),
			write_file: vi.fn(),
			write_module: vi.fn(),
			compile_package: vi.fn(() => {
				throw new Error('Syntax error\n/src/main.gleam:2:5');
			})
		};
		const fetchMock = stubRuntimeFetch({ fixture });
		const loadCompiler = vi.fn(async (_base: string, _assets: GleamCompilerAssets) => compiler);
		const service = createGleamWorkerService(loadCompiler);
		const reportProgress = vi.fn();
		const context = {
			documents: new Map(),
			publishDiagnostics: vi.fn(),
			reportProgress
		};

		await service.initialize?.(
			{
				baseUrl,
				manifestUrl,
				manifestFingerprint: fixture.fingerprint
			},
			context
		);
		const diagnostics = await service.diagnostics?.(
			{
				uri: 'file:///workspace/main.gleam',
				languageId: 'gleam',
				version: 1,
				text: 'pub fn main() {\n  let\n}\n'
			},
			context
		);

		expect(fetchMock).toHaveBeenCalledWith(
			manifestUrl,
			expect.objectContaining({
				cache: 'no-store',
				credentials: 'omit',
				redirect: 'error',
				referrerPolicy: 'no-referrer'
			})
		);
		expect(loadCompiler).toHaveBeenCalledWith(baseUrl, {
			manifestFingerprint: fixture.fingerprint,
			moduleBytes: fixture.assetBytes.get('compiler/gleam_wasm.js'),
			wasmBytes: fixture.assetBytes.get('compiler/gleam_wasm_bg.wasm')
		});
		expect(compiler.write_file).toHaveBeenCalledWith(
			expect.any(Number),
			'/src/gleam/io.gleam',
			expect.any(String)
		);
		expect(compiler.write_file).toHaveBeenCalledWith(
			expect.any(Number),
			'/src/wasm_idle/stdin.gleam',
			expect.stringContaining('pub fn read_line')
		);
		expect(compiler.write_module).toHaveBeenCalledWith(
			expect.any(Number),
			'main',
			'pub fn main() {\n  let\n}\n'
		);
		expect(compiler.compile_package).toHaveBeenCalledWith(expect.any(Number), 'javascript');
		expect(diagnostics).toEqual([
			{
				range: {
					start: { line: 1, character: 4 },
					end: { line: 1, character: 5 }
				},
				severity: 1,
				source: 'gleam',
				message: 'Syntax error\n/src/main.gleam:2:5'
			}
		]);
		expect(reportProgress).toHaveBeenCalledWith('load-gleam-compiler');
		expect(reportProgress).toHaveBeenCalledWith('gleam-diagnostics');
		expect(compiler.delete_project).toHaveBeenCalledWith(expect.any(Number));
	});
});
