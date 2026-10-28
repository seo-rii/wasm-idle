import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash, webcrypto } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { loadRuntimeAssetBytes } from '../../../runtimes/wasm-tinygo/src/runtime-assets';
import { readBufferedStdin } from './stdinBuffer';
import { resolveEditorDefaultSource } from '../../routes/editor-defaults';
import { RuntimeAssetCache } from '@wasm-idle/core';
import { WASM_TINYGO_RUNTIME_PROFILE } from './wasmTinyGoVersion';

const workerInstances: MockWorker[] = [];

const createRuntimeFixtureState = () => ({
	activityLog: '',
	artifact: null as {
		path: string;
		bytes: Uint8Array;
		artifactKind?: 'probe' | 'bootstrap' | 'execution';
		runnable?: boolean;
		entrypoint?: '_start' | '_initialize' | 'main' | null;
		reason?: string;
	} | null,
	nextArtifact: null as {
		path: string;
		bytes: Uint8Array;
		artifactKind?: 'probe' | 'bootstrap' | 'execution';
		runnable?: boolean;
		entrypoint?: '_start' | '_initialize' | 'main' | null;
		reason?: string;
	} | null,
	workspaceFiles: null as Record<string, string> | null,
	buildRequestOverrides: null as { target?: string } | null,
	bootCalls: 0,
	planCalls: 0,
	executeCalls: 0,
	disposeCalls: 0,
	lastRuntimeOptions: null as { assetLoader?: unknown } | null,
	nextExecutionFailureLine: null as string | null,
	skipArtifact: false
});

const runtimeFixtureState =
	(
		globalThis as typeof globalThis & {
			__wasmIdleTinyGoRuntimeFixtureState?: ReturnType<typeof createRuntimeFixtureState>;
		}
	).__wasmIdleTinyGoRuntimeFixtureState ||
	((
		globalThis as typeof globalThis & {
			__wasmIdleTinyGoRuntimeFixtureState?: ReturnType<typeof createRuntimeFixtureState>;
		}
	).__wasmIdleTinyGoRuntimeFixtureState = createRuntimeFixtureState());

const { executableGraphFixture } = vi.hoisted(() => ({
	executableGraphFixture: {
		disposeCalls: 0,
		load: vi.fn()
	}
}));

const pinnedFetch = vi.hoisted(() => vi.fn());
const moduleService = vi.hoisted(() => vi.fn());
vi.mock('@wasm-idle/core', async (original) => ({
	...(await original<typeof import('@wasm-idle/core')>()),
	fetchPinnedRuntimeAsset: pinnedFetch,
	createRuntimeWasmModuleService: moduleService
}));

function installExecutableGraphFixture() {
	executableGraphFixture.disposeCalls = 0;
	executableGraphFixture.load.mockReset();
	executableGraphFixture.load.mockImplementation(
		async ({ moduleUrl }: { moduleUrl: string }) => ({
			entryUrl: moduleUrl,
			assetBaseUrl: 'https://example.invalid/wasm-tinygo/',
			moduleUrls: { 'upstream.js': moduleUrl },
			dispose() {
				executableGraphFixture.disposeCalls += 1;
			}
		})
	);
}

const runtimeModuleSource = `
const state = globalThis.__wasmIdleTinyGoRuntimeFixtureState;
export const createBundledTinyGoRuntime = (options = {}) => {
  state.lastRuntimeOptions = options;
  return ({
  async boot() {
    state.bootCalls += 1;
    options.onProgress?.({ assetPath: 'vendor/emception/emception.worker.js', assetUrl: 'https://example.invalid/vendor/emception/emception.worker.js', label: 'emception.worker.js', loaded: 8, total: 16 });
    options.onProgress?.({ assetPath: 'vendor/emception/emception.worker.js', assetUrl: 'https://example.invalid/vendor/emception/emception.worker.js', label: 'emception.worker.js', loaded: 16, total: 16 });
    state.activityLog += '[12:00:00] emception toolchain is ready\\n';
  },
  async plan() {
    state.planCalls += 1;
    options.onProgress?.({ assetPath: 'tools/tinygo-compiler.wasm', assetUrl: 'https://example.invalid/tools/tinygo-compiler.wasm', label: 'tinygo-compiler.wasm', loaded: 2, total: 4 });
    options.onProgress?.({ assetPath: 'tools/tinygo-compiler.wasm', assetUrl: 'https://example.invalid/tools/tinygo-compiler.wasm', label: 'tinygo-compiler.wasm', loaded: 4, total: 4 });
    state.activityLog += '[12:00:01] tinygo compiler module loaded from tools/tinygo-compiler.wasm (mode=direct)\\n';
    state.activityLog += '[12:00:01] frontend bootstrap tool plan skipped: backend lowering is active\\n';
    state.activityLog += '[12:00:01] driver planned 4 step(s)\\n';
    return { ok: true };
  },
  async execute() {
    state.executeCalls += 1;
    options.onProgress?.({ assetPath: 'tools/go-probe.wasm', assetUrl: 'https://example.invalid/tools/go-probe.wasm', label: 'go-probe.wasm', loaded: 3, total: 6 });
    options.onProgress?.({ assetPath: 'tools/go-probe.wasm', assetUrl: 'https://example.invalid/tools/go-probe.wasm', label: 'go-probe.wasm', loaded: 6, total: 6 });
    state.activityLog += '[12:00:02] build artifact ready: /working/out.wasm (4 bytes)\\n';
    if (state.nextExecutionFailureLine) {
      state.activityLog += '[12:00:03] ' + state.nextExecutionFailureLine + '\\n';
      state.nextExecutionFailureLine = null;
    }
    if (state.skipArtifact) {
      state.artifact = null;
      state.skipArtifact = false;
      state.nextArtifact = null;
      return;
    }
	    state.artifact = state.nextArtifact ?? {
	      path: '/working/out.wasm',
	      bytes: new Uint8Array([0, 97, 115, 109]),
	      artifactKind: 'execution',
	      runnable: true,
	      entrypoint: '_start',
	    };
    state.nextArtifact = null;
  },
  reset() {
    state.activityLog = '[12:00:00] log cleared\\n';
    state.artifact = null;
  },
  readActivityLog() {
    return state.activityLog;
  },
  readBuildArtifact() {
    return state.artifact;
  },
  setWorkspaceFiles(files) {
    state.workspaceFiles = files;
  },
  setBuildRequestOverrides(overrides) {
    state.buildRequestOverrides = overrides;
  },
  setMaxAssetBytes() {},
  dispose() {
    state.disposeCalls += 1;
  },
});
}
`;

const runtimeModuleUrl = `data:text/javascript;base64,${Buffer.from(runtimeModuleSource, 'utf8').toString('base64')}`;

const createUpstreamFixtureState = () => ({
	onLoad: null as ((options: { fetchImpl?: typeof fetch }) => Promise<void>) | null,
	onCompile: null as ((options: { signal?: AbortSignal }) => Promise<void>) | null,
	capCalls: [] as Array<{ maxBytes: number; label: string }>,
	loadCalls: 0,
	loadFailures: 0,
	compileCalls: 0,
	loadOptions: null as Record<string, unknown> | null,
	compileRequest: null as { workspaceFiles?: Record<string, string> } | null,
	compileOptions: null as {
		maxWasmMemoryBytes?: number;
		modulePorts?: Record<'compiler' | 'packageGraph' | 'lld', MessagePort>;
	} | null
});

const upstreamFixtureState =
	(
		globalThis as typeof globalThis & {
			__wasmIdleTinyGoUpstreamFixtureState?: ReturnType<typeof createUpstreamFixtureState>;
		}
	).__wasmIdleTinyGoUpstreamFixtureState ||
	((
		globalThis as typeof globalThis & {
			__wasmIdleTinyGoUpstreamFixtureState?: ReturnType<typeof createUpstreamFixtureState>;
		}
	).__wasmIdleTinyGoUpstreamFixtureState = createUpstreamFixtureState());

const upstreamModuleSource = `
const state = globalThis.__wasmIdleTinyGoUpstreamFixtureState;
export function capTinyGoWasmMemory(bytes, maxBytes, label) {
  state.capCalls.push({ maxBytes, label });
  return bytes;
}
export async function loadTinyGoUpstreamToolchainAssets(options) {
  state.loadCalls += 1;
  state.loadOptions = options;
  await state.onLoad?.(options);
  if (state.loadFailures > 0) {
    state.loadFailures -= 1;
    throw new Error('fixture upstream asset load failed');
  }
  options.onProgress?.({ assetPath: 'tools/upstream/tinygo-compiler.wasm', assetUrl: 'https://example.invalid/tinygo-compiler.wasm', label: 'upstream TinyGo compiler', loaded: 4, total: 4 });
  return { fixture: 'receipt-verified-assets' };
}
export async function compileTinyGoInDisposableWorker(_assets, request, options) {
  state.compileCalls += 1;
  state.compileRequest = request;
  state.compileOptions = options;
  await state.onCompile?.(options);
  options.onPhase?.('prepare');
  options.onPhase?.('graph');
  options.onPhase?.('validate');
  options.onPhase?.('compile');
  options.onPhase?.('link');
  options.onPhase?.('optimize');
  return { wasm: new Uint8Array([0, 97, 115, 109]) };
}
`;

const upstreamModuleUrl = `data:text/javascript;base64,${Buffer.from(upstreamModuleSource, 'utf8').toString('base64')}`;

class MockWorker {
	onmessage: ((event: MessageEvent<any>) => void) | null = null;
	onerror: ((event: ErrorEvent) => void) | null = null;
	onmessageerror: ((event: MessageEvent<any>) => void) | null = null;
	postMessage = vi.fn((message: any) => {
		if (message.load) {
			queueMicrotask(() => this.onmessage?.({ data: { load: true } } as MessageEvent<any>));
			return;
		}
		queueMicrotask(() =>
			this.onmessage?.({
				data: { output: 'tinygo-ok\n', results: true, buffer: true }
			} as MessageEvent<any>)
		);
	});
	terminate = vi.fn();

	constructor() {
		workerInstances.push(this);
	}
}

vi.mock('$lib/playground/worker/tinygo?worker', () => ({
	default: MockWorker
}));

vi.mock('$lib/playground/tinygoExecutableGraph', () => ({
	loadVerifiedTinyGoExecutableGraph: executableGraphFixture.load
}));

import TinyGo from './tinygo';

describe('TinyGo sandbox', () => {
	it('rejects a debug request before compiling an ordinary release artifact', async () => {
		const sandbox = new TinyGo();
		await expect(
			sandbox.run('package main\nfunc main() {}', false, false, undefined, [], {
				debugMode: 'lldb'
			})
		).rejects.toThrow('does not provide a debug runtime closure');
		expect(workerInstances).toHaveLength(0);
	});

	beforeEach(() => {
		vi.restoreAllMocks();
		vi.stubGlobal('fetch', vi.fn());
		workerInstances.length = 0;
		window.history.replaceState({}, '', 'http://localhost:3000/');
		Object.assign(runtimeFixtureState, createRuntimeFixtureState());
		Object.assign(upstreamFixtureState, createUpstreamFixtureState());
		installExecutableGraphFixture();
		pinnedFetch.mockReset();
		pinnedFetch.mockResolvedValue(new Uint8Array([0, 97, 115, 109]));
		moduleService.mockReset();
		moduleService.mockImplementation(() => ({ port: {}, close: vi.fn() }));
	});

	it('keeps raw TinyGo 404/query probes native and caches only exact pinned transport URLs', async () => {
		const root = 'https://example.invalid/wasm-tinygo/';
		const logical = `${root}tools/upstream/tinygo-compiler.wasm`;
		const missing = new Response('missing', { status: 404 });
		const fetcher = vi.fn(async () => missing);
		vi.stubGlobal('fetch', fetcher);
		upstreamFixtureState.onLoad = async ({ fetchImpl }) => {
			expect(fetchImpl).toBeTypeOf('function');
			// These original responses let the producer perform its existing gzip fallback.
			expect(await fetchImpl!(logical)).toBe(missing);
			expect(await fetchImpl!(`${logical}.gz?v=custom`)).toBe(missing);
			expect(pinnedFetch).not.toHaveBeenCalled();
			const verified = await fetchImpl!(`${logical}.gz`);
			expect(verified.url).toBe('');
			expect(new Uint8Array(await verified.arrayBuffer())).toEqual(
				new Uint8Array([0, 97, 115, 109])
			);
		};
		const sandbox = new TinyGo();
		await sandbox.load({
			tinygo: { moduleUrl: upstreamModuleUrl },
			persistentCache: { enabled: true, maxBytes: 4096 }
		});
		await sandbox.run('package main\nfunc main() {}', true);
		expect(fetcher).toHaveBeenCalledTimes(2);
		expect(pinnedFetch).toHaveBeenCalledWith(
			expect.objectContaining({
				url: `${logical}.gz`,
				persistentCache: expect.objectContaining({ enabled: true, maxBytes: 4096 }),
				receipt: expect.objectContaining({ uncompressedSha256: expect.any(String) })
			})
		);
		await sandbox.dispose();
	});

	it.each(['valid', 'corrupt'])(
		'verifies %s HTTP-decoded gzip bytes after the transport cache rejects them',
		async (variant) => {
			const originalCrypto = globalThis.crypto;
			vi.stubGlobal('crypto', webcrypto);
			const sandbox = new TinyGo();
			try {
				// A valid Wasm custom section makes the logical bytes larger than their gzip.
				const logical = Uint8Array.from([
					0,
					97,
					115,
					109,
					1,
					0,
					0,
					0,
					0,
					0x81,
					0x02,
					...new Uint8Array(257)
				]);
				const storage = gzipSync(logical);
				const digest = (bytes: Uint8Array) =>
					createHash('sha256').update(bytes).digest('hex');
				const receipt = {
					bytes: storage.byteLength,
					sha256: digest(storage),
					uncompressedBytes: logical.byteLength,
					uncompressedSha256: digest(logical)
				};
				const assetPath = 'tools/upstream/tinygo-package-graph.wasm';
				const logicalUrl = `https://example.invalid/wasm-tinygo/${assetPath}`;
				const decoded = logical.slice();
				if (variant === 'corrupt') decoded[decoded.length - 1] ^= 1;
				const fetcher = vi.fn(async (input: RequestInfo | URL) => {
					const url = String(input);
					const response = new Response(
						url.endsWith('.gz')
							? decoded
							: '<!doctype html><title>missing asset</title>',
						{
							headers: url.endsWith('.gz')
								? {
										'Content-Encoding': 'gzip',
										'Content-Length': String(storage.byteLength)
									}
								: { 'Content-Type': 'text/html' }
						}
					);
					Object.defineProperty(response, 'url', { value: url });
					return response;
				});
				vi.stubGlobal('fetch', fetcher);
				const core =
					await vi.importActual<typeof import('@wasm-idle/core')>('@wasm-idle/core');
				pinnedFetch.mockImplementation(core.fetchPinnedRuntimeAsset);
				upstreamFixtureState.onLoad = async ({ fetchImpl }) => {
					const loaded = loadRuntimeAssetBytes({
						assetPath,
						assetUrl: logicalUrl,
						label: 'package provider',
						fetchImpl,
						receipt,
						maxAssetBytes: 1024
					});
					if (variant === 'corrupt') await expect(loaded).rejects.toThrow('HTML');
					else expect(await loaded).toEqual(logical);
				};
				await sandbox.load({
					tinygo: {
						...WASM_TINYGO_RUNTIME_PROFILE,
						moduleUrl: upstreamModuleUrl,
						assetReceipts: {
							...WASM_TINYGO_RUNTIME_PROFILE.assetReceipts,
							[assetPath]: receipt
						}
					},
					persistentCache: false
				});
				await sandbox.run('package main\nfunc main() {}', true);
				expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
					logicalUrl,
					`${logicalUrl}.gz`,
					`${logicalUrl}.gz`
				]);
			} finally {
				await sandbox.dispose();
				vi.stubGlobal('crypto', originalCrypto);
			}
		}
	);

	it('preserves nonencoded cache failures and aborts without a native retry', async () => {
		const failure = new Error('pinned receipt rejected');
		const aborted = new Error('transport aborted');
		const controller = new AbortController();
		pinnedFetch.mockRejectedValueOnce(failure).mockImplementationOnce(async () => {
			controller.abort(aborted);
			throw failure;
		});
		upstreamFixtureState.onLoad = async ({ fetchImpl }) => {
			const root = 'https://example.invalid/wasm-tinygo/tools/upstream/';
			await expect(fetchImpl!(`${root}upstream-toolchain.v2.json`)).rejects.toBe(failure);
			await expect(
				fetchImpl!(`${root}tinygo-package-graph.wasm.gz`, { signal: controller.signal })
			).rejects.toBe(aborted);
		};
		const sandbox = new TinyGo();
		try {
			await sandbox.load({ tinygo: { moduleUrl: upstreamModuleUrl } });
			await sandbox.run('package main\nfunc main() {}', true);
			expect(globalThis.fetch).not.toHaveBeenCalled();
		} finally {
			await sandbox.dispose();
		}
	});

	it('snapshots lazy TinyGo run overrides and restores the load baseline on the next run', async () => {
		const sandbox = new TinyGo();
		await sandbox.load({
			tinygo: { moduleUrl: upstreamModuleUrl },
			persistentCache: { enabled: true, maxBytes: 4096 }
		});
		const requests: unknown[] = [];
		upstreamFixtureState.onLoad = async ({ fetchImpl }) => {
			await fetchImpl!(
				'https://example.invalid/wasm-tinygo/tools/upstream/upstream-toolchain.v2.json'
			);
			requests.push(pinnedFetch.mock.calls.at(-1)?.[0].persistentCache);
		};
		// Retire only the in-memory runtime to exercise lazy recreation with the original load baseline.
		await sandbox.clear();
		await sandbox.run('package main\nfunc main() {}', true, false, undefined, [], {
			persistentCache: false
		});
		expect(executableGraphFixture.load.mock.calls.at(-1)?.[0].persistentCache).toMatchObject({
			enabled: false,
			maxBytes: 4096
		});
		await sandbox.clear();
		await sandbox.run('package main\nfunc main() {}', true);
		expect(executableGraphFixture.load.mock.calls.at(-1)?.[0].persistentCache).toMatchObject({
			enabled: true,
			maxBytes: 4096
		});
		expect(requests).toEqual([
			expect.objectContaining({ enabled: false, maxBytes: 4096 }),
			expect.objectContaining({ enabled: true, maxBytes: 4096 })
		]);
		await sandbox.dispose();
	});

	it('keeps custom TinyGo asset loaders outside the default persistent adapter', async () => {
		const assetLoader = vi.fn(async () => new Uint8Array([1]));
		const sandbox = new TinyGo();
		await sandbox.load({ tinygo: { moduleUrl: upstreamModuleUrl, assetLoader } });
		await sandbox.run('package main\nfunc main() {}', true);
		expect(upstreamFixtureState.loadOptions?.loader).toBe(assetLoader);
		expect(upstreamFixtureState.loadOptions?.fetchImpl).toBeUndefined();
		expect(pinnedFetch).not.toHaveBeenCalled();
		await sandbox.dispose();
	});

	it('compiles public TinyGo with receipt-verified upstream assets in the disposable worker', async () => {
		const sandbox = new TinyGo();
		const outputs: string[] = [];
		const code = 'package main\nfunc main() {}\n';
		sandbox.output = (chunk: string) => outputs.push(chunk);

		await sandbox.load({
			rootUrl: '/absproxy/5173',
			tinygo: { moduleUrl: upstreamModuleUrl }
		});
		await expect(
			sandbox.run(code, true, true, undefined, [], {
				tinygoTarget: 'wasip1',
				limits: { maxWasmMemoryBytes: 65_536 }
			})
		).resolves.toBe(true);
		await expect(
			sandbox.run(code, true, true, undefined, [], {
				tinygoTarget: 'wasip1',
				limits: { maxWasmMemoryBytes: 131_072 }
			})
		).resolves.toBe(true);

		expect(upstreamFixtureState.loadCalls).toBe(1);
		expect(upstreamFixtureState.loadOptions?.profile).toMatchObject({
			profileId: 'tinygo-0.43.0-wasip1-protocol-v6',
			protocolVersion: 6,
			manifestPath: 'tools/upstream/upstream-toolchain.v2.json',
			manifestFingerprint: expect.stringMatching(/^[0-9a-f]{64}$/u)
		});
		expect(upstreamFixtureState.compileCalls).toBe(2);
		expect(upstreamFixtureState.compileRequest?.workspaceFiles).toEqual({
			'go.mod': 'module wasm-idle.local/main\n\ngo 1.24.0\n',
			'main.go': code
		});
		expect(upstreamFixtureState.compileOptions?.maxWasmMemoryBytes).toBe(131_072);
		expect(outputs.join('')).toContain('upstream TinyGo phase: compile');
		expect(outputs.join('')).toContain('upstream TinyGo artifact ready');
	});

	it('keeps the cache owner fixed while loading, loaded, running, or disposed', async () => {
		const cache = new RuntimeAssetCache();
		const replacement = new RuntimeAssetCache();
		const sandbox = new TinyGo();
		sandbox.setRuntimeAssetCache(cache);
		const load = sandbox.load({ tinygo: { moduleUrl: upstreamModuleUrl } });
		expect(() => sandbox.setRuntimeAssetCache(cache)).not.toThrow();
		expect(() => sandbox.setRuntimeAssetCache(replacement)).toThrow(
			'Cannot replace TinyGo runtime asset cache'
		);
		await load;
		expect(() => sandbox.setRuntimeAssetCache(cache)).not.toThrow();
		expect(() => sandbox.setRuntimeAssetCache(replacement)).toThrow(
			'Cannot replace TinyGo runtime asset cache'
		);
		upstreamFixtureState.onCompile = ({ signal }) =>
			new Promise<void>((_resolve, reject) => {
				signal!.addEventListener('abort', () => reject(signal!.reason), { once: true });
			});
		const pending = sandbox.run('package main\nfunc main() {}', true);
		const rejection = expect(pending).rejects.toBe('Process terminated');
		expect(() => sandbox.setRuntimeAssetCache(cache)).not.toThrow();
		expect(() => sandbox.setRuntimeAssetCache(replacement)).toThrow(
			'Cannot replace TinyGo runtime asset cache'
		);
		await vi.waitFor(() => expect(upstreamFixtureState.compileCalls).toBe(1));
		sandbox.terminate();
		await rejection;
		await sandbox.dispose();
		expect(() => sandbox.setRuntimeAssetCache(replacement)).toThrow(
			'TinyGo sandbox is disposed'
		);
		expect(cache.stats().disposed).toBe(false);
		expect(replacement.stats().disposed).toBe(false);
	});

	it('forwards three receipt-bound module services and closes them after compilation', async () => {
		const cache = new RuntimeAssetCache();
		const sandbox = new TinyGo();
		sandbox.setRuntimeAssetCache(cache);
		await sandbox.load({ tinygo: { moduleUrl: upstreamModuleUrl } });
		await sandbox.run('package main\nfunc main() {}', true, false, undefined, [], {
			limits: { maxWasmMemoryBytes: 65_536 }
		});
		expect(moduleService).toHaveBeenCalledTimes(3);
		const services = moduleService.mock.results.map(({ value }) => value);
		expect(upstreamFixtureState.compileOptions?.modulePorts).toEqual({
			compiler: services[0].port,
			packageGraph: services[1].port,
			lld: services[2].port
		});
		for (const [index, assetPath] of [
			'tools/upstream/tinygo-compiler.wasm',
			'tools/upstream/tinygo-package-graph.wasm',
			'tools/upstream/lld.wasm'
		].entries()) {
			const pinned =
				WASM_TINYGO_RUNTIME_PROFILE.assetReceipts[
					assetPath as keyof typeof WASM_TINYGO_RUNTIME_PROFILE.assetReceipts
				];
			expect(moduleService.mock.calls[index][0]).toMatchObject({
				cache,
				receipt: {
					bytes: 'uncompressedBytes' in pinned ? pinned.uncompressedBytes : pinned.bytes,
					sha256:
						'uncompressedSha256' in pinned ? pinned.uncompressedSha256 : pinned.sha256
				},
				compileKey: 'tinygo-wasi-memory-cap-v1:65536'
			});
			await moduleService.mock.calls[index][0].compile(
				new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0])
			);
			expect(services[index].close).toHaveBeenCalledOnce();
		}
		expect(upstreamFixtureState.capCalls.map(({ maxBytes }) => maxBytes)).toEqual([
			65_536, 65_536, 65_536
		]);
		await sandbox.dispose();
		expect(cache.stats().disposed).toBe(false);
	});

	it('keeps module identities stable on revisit and distinguishes the compiler memory cap', async () => {
		const cache = new RuntimeAssetCache();
		for (const cap of [65_536, 65_536, 131_072]) {
			const sandbox = new TinyGo();
			sandbox.setRuntimeAssetCache(cache);
			await sandbox.load({ tinygo: { moduleUrl: upstreamModuleUrl } });
			await sandbox.run('package main\nfunc main() {}', true, false, undefined, [], {
				limits: { maxWasmMemoryBytes: cap }
			});
			await sandbox.dispose();
		}
		for (let index = 0; index < 3; index += 1) {
			const first = moduleService.mock.calls[index][0];
			const revisit = moduleService.mock.calls[index + 3][0];
			const tighterOrWider = moduleService.mock.calls[index + 6][0];
			expect(revisit.identity).toBe(first.identity);
			expect(revisit.compileKey).toBe(first.compileKey);
			expect(tighterOrWider.compileKey).not.toBe(first.compileKey);
		}
		expect(cache.stats().disposed).toBe(false);
	});

	it('closes only the current compile services on failure or cancellation', async () => {
		const cache = new RuntimeAssetCache();
		const sandbox = new TinyGo();
		sandbox.setRuntimeAssetCache(cache);
		await sandbox.load({ tinygo: { moduleUrl: upstreamModuleUrl } });
		upstreamFixtureState.onCompile = async () => {
			throw new Error('compiler fixture failed');
		};
		await expect(sandbox.run('package main\nfunc main() {}', true)).rejects.toBe(
			'compiler fixture failed'
		);
		for (const { value } of moduleService.mock.results) {
			expect(value.close).toHaveBeenCalledOnce();
		}
		upstreamFixtureState.onCompile = ({ signal }) =>
			new Promise<void>((_resolve, reject) => {
				signal!.addEventListener('abort', () => reject(signal!.reason), { once: true });
			});
		const pending = sandbox.run('package main\nfunc main() {}', true);
		const rejection = expect(pending).rejects.toBe('Process terminated');
		await vi.waitFor(() => expect(upstreamFixtureState.compileCalls).toBe(2));
		sandbox.terminate();
		await rejection;
		await vi.waitFor(() => {
			for (const { value } of moduleService.mock.results.slice(3)) {
				expect(value.close).toHaveBeenCalledOnce();
			}
		});
		expect(moduleService.mock.calls[3][0].signal.aborted).toBe(true);
		expect(cache.stats().disposed).toBe(false);
		await sandbox.dispose();
	});

	it('rejects an incomplete TinyGo trust-profile override before worker creation', async () => {
		const sandbox = new TinyGo();

		await expect(
			sandbox.load({
				tinygo: {
					moduleUrl: upstreamModuleUrl,
					profileId: 'partial-profile'
				}
			})
		).rejects.toMatchObject({
			name: 'RuntimeConfigurationError',
			code: 'runtime-configuration',
			runtimeId: 'TINYGO'
		});
		expect(workerInstances).toHaveLength(0);
		expect(upstreamFixtureState.loadCalls).toBe(0);
	});

	it('rejects an executable graph fingerprint override before graph or worker creation', async () => {
		const sandbox = new TinyGo();

		await expect(
			sandbox.load({
				tinygo: {
					moduleUrl: upstreamModuleUrl,
					executableGraphFingerprint: '0'.repeat(64)
				}
			})
		).rejects.toMatchObject({
			name: 'RuntimeConfigurationError',
			code: 'runtime-configuration',
			runtimeId: 'TINYGO'
		});
		expect(executableGraphFixture.load).not.toHaveBeenCalled();
		expect(workerInstances).toHaveLength(0);
	});

	it('verifies the executable graph before creating a worker and retries cleanly', async () => {
		const sandbox = new TinyGo();
		executableGraphFixture.load.mockRejectedValueOnce(
			new Error('fixture TinyGo executable receipt mismatch')
		);

		await expect(sandbox.load({ tinygo: { moduleUrl: upstreamModuleUrl } })).rejects.toThrow(
			'fixture TinyGo executable receipt mismatch'
		);
		expect(workerInstances).toHaveLength(0);

		await expect(
			sandbox.load({ tinygo: { moduleUrl: upstreamModuleUrl } })
		).resolves.toBeUndefined();
		expect(executableGraphFixture.load).toHaveBeenCalledTimes(2);
		expect(workerInstances).toHaveLength(1);
	});

	it('imports only the verified graph entry instead of the configured network URL', async () => {
		const sandbox = new TinyGo();
		const configuredModuleUrl = 'https://mirror.example/wasm-tinygo/upstream.js';
		executableGraphFixture.load.mockImplementationOnce(async () => ({
			entryUrl: runtimeModuleUrl,
			assetBaseUrl: 'https://mirror.example/wasm-tinygo/',
			moduleUrls: { 'upstream.js': runtimeModuleUrl },
			dispose() {
				executableGraphFixture.disposeCalls += 1;
			}
		}));

		await expect(
			sandbox.load({ tinygo: { moduleUrl: configuredModuleUrl } })
		).resolves.toBeUndefined();

		expect(executableGraphFixture.load).toHaveBeenCalledWith(
			expect.objectContaining({
				moduleUrl: expect.stringMatching(
					/^https:\/\/mirror\.example\/wasm-tinygo\/upstream\.js\?v=[a-f0-9]{64}$/u
				)
			})
		);
		expect(runtimeFixtureState.lastRuntimeOptions).not.toBeNull();
		expect(workerInstances).toHaveLength(1);
	});

	it('disposes a verified graph whose entry module fails to import', async () => {
		const sandbox = new TinyGo();
		executableGraphFixture.load.mockImplementationOnce(async () => ({
			entryUrl:
				'data:text/javascript,throw%20new%20Error(%22fixture%20verified%20import%20failed%22)',
			assetBaseUrl: 'https://mirror.example/wasm-tinygo/',
			moduleUrls: {},
			dispose() {
				executableGraphFixture.disposeCalls += 1;
			}
		}));

		await expect(
			sandbox.load({
				tinygo: { moduleUrl: 'https://mirror.example/wasm-tinygo/upstream.js' }
			})
		).rejects.toThrow('fixture verified import failed');

		expect(executableGraphFixture.disposeCalls).toBe(1);
		expect(workerInstances).toHaveLength(0);
		expect(sandbox.executableGraph).toBeNull();
	});

	it('uses the verified upstream compiler memory default when the caller omits a limit', async () => {
		const sandbox = new TinyGo();
		const code = 'package main\nfunc main() {}\n';

		await sandbox.load({ tinygo: { moduleUrl: upstreamModuleUrl } });
		await expect(sandbox.run(code, true)).resolves.toBe(true);

		expect(upstreamFixtureState.compileOptions?.maxWasmMemoryBytes).toBe(
			2 * 1024 * 1024 * 1024
		);
	});

	it('retries upstream asset loading after a transient verified-asset failure', async () => {
		const sandbox = new TinyGo();
		const code = 'package main\nfunc main() {}\n';
		upstreamFixtureState.loadFailures = 1;

		await sandbox.load({ tinygo: { moduleUrl: upstreamModuleUrl } });
		await expect(sandbox.run(code, true)).rejects.toThrow('fixture upstream asset load failed');
		await expect(sandbox.run(code, true)).resolves.toBe(true);

		expect(upstreamFixtureState.loadCalls).toBe(2);
		expect(upstreamFixtureState.compileCalls).toBe(1);
	});

	it('reloads upstream assets when the per-asset quota changes', async () => {
		const sandbox = new TinyGo();
		const code = 'package main\nfunc main() {}\n';

		await sandbox.load({ tinygo: { moduleUrl: upstreamModuleUrl } });
		await expect(
			sandbox.run(code, true, true, undefined, [], {
				limits: { maxAssetBytes: 1_000_000 }
			})
		).resolves.toBe(true);
		await expect(
			sandbox.run(code, true, true, undefined, [], {
				limits: { maxAssetBytes: 2_000_000 }
			})
		).resolves.toBe(true);

		expect(upstreamFixtureState.loadCalls).toBe(2);
		expect(upstreamFixtureState.compileCalls).toBe(2);
	});

	it('loads the TinyGo runtime module, compiles once during prepare, and runs the cached artifact', async () => {
		const sandbox = new TinyGo();
		const outputs: string[] = [];
		const code = resolveEditorDefaultSource('go', 'wasm32-wasip1');

		sandbox.output = (chunk: string) => outputs.push(chunk);

		await sandbox.load({
			rootUrl: '/absproxy/5173',
			tinygo: {
				moduleUrl: runtimeModuleUrl
			}
		});
		await expect(sandbox.run(code, true)).resolves.toBe(true);
		await expect(sandbox.run(code, false, true, undefined, ['demo'])).resolves.toBe(true);

		expect(workerInstances).toHaveLength(1);
		expect(runtimeFixtureState.workspaceFiles).toEqual({
			'main.go': code
		});
		expect(runtimeFixtureState.workspaceFiles?.['main.go']).toContain("ReadString('\\n')");
		expect(runtimeFixtureState.workspaceFiles?.['main.go']).toContain(
			'fmt.Printf("fibonacci=%d\\n", fibonacci(n)+bonus)'
		);
		expect(runtimeFixtureState.bootCalls).toBe(1);
		expect(runtimeFixtureState.planCalls).toBe(1);
		expect(runtimeFixtureState.executeCalls).toBe(1);
		expect(workerInstances[0].postMessage).toHaveBeenNthCalledWith(1, { load: true });
		expect(workerInstances[0].postMessage).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({
				artifact: expect.any(Uint8Array),
				args: ['demo'],
				log: true
			})
		);
		expect(outputs.join('')).toContain(
			'tinygo compiler module loaded from tools/tinygo-compiler.wasm (mode=direct)'
		);
		expect(outputs.join('')).toContain(
			'frontend bootstrap tool plan skipped: backend lowering is active'
		);
		expect(outputs.join('')).toContain('driver planned 4 step(s)');
		expect(outputs.join('')).toContain('tinygo-ok\n');
	});

	it('passes selected TinyGo targets into the browser runtime and compile cache key', async () => {
		const sandbox = new TinyGo();
		const code = resolveEditorDefaultSource('go', 'wasm32-wasip1');

		await sandbox.load({
			rootUrl: '/absproxy/5173',
			tinygo: {
				moduleUrl: runtimeModuleUrl
			}
		});

		await expect(
			sandbox.run(code, true, true, undefined, [], { tinygoTarget: 'wasip2' })
		).resolves.toBe(true);
		expect(runtimeFixtureState.buildRequestOverrides).toEqual({ target: 'wasip2' });
		expect(runtimeFixtureState.planCalls).toBe(1);
		expect(runtimeFixtureState.executeCalls).toBe(1);

		await expect(
			sandbox.run(code, true, true, undefined, [], { tinygoTarget: 'wasip2' })
		).resolves.toBe(true);
		expect(runtimeFixtureState.planCalls).toBe(1);
		expect(runtimeFixtureState.executeCalls).toBe(1);

		await expect(
			sandbox.run(code, true, true, undefined, [], { tinygoTarget: 'wasip3' })
		).resolves.toBe(true);
		expect(runtimeFixtureState.buildRequestOverrides).toEqual({ target: 'wasip3' });
		expect(runtimeFixtureState.planCalls).toBe(2);
		expect(runtimeFixtureState.executeCalls).toBe(2);
	});

	it('maps browser runtime asset progress into the provided sandbox progress sink', async () => {
		const sandbox = new TinyGo();
		const values: number[] = [];
		const code = resolveEditorDefaultSource('go', 'wasm32-wasip1');

		await sandbox.load({
			rootUrl: '/absproxy/5173',
			tinygo: {
				moduleUrl: runtimeModuleUrl
			}
		});
		await expect(
			sandbox.run(code, true, true, {
				set(value: number) {
					values.push(value);
				}
			})
		).resolves.toBe(true);

		expect(values.some((value) => value > 0.05 && value < 0.35)).toBe(true);
		expect(values.some((value) => value > 0.35 && value < 0.65)).toBe(true);
		expect(values.some((value) => value > 0.65 && value < 0.92)).toBe(true);
		expect(values.at(-1)).toBe(0.95);
		for (let index = 1; index < values.length; index += 1) {
			expect(values[index]).toBeGreaterThanOrEqual(values[index - 1] || 0);
		}
	});

	it('passes the rust runtime base url into the TinyGo browser runtime', async () => {
		const sandbox = new TinyGo();

		await sandbox.load({
			rootUrl: '/absproxy/5173',
			rust: {
				compilerUrl: '/absproxy/5173/wasm-rust/index.js?v=test'
			},
			tinygo: {
				moduleUrl: runtimeModuleUrl
			}
		});

		expect(runtimeFixtureState.lastRuntimeOptions).toEqual(
			expect.objectContaining({
				rustRuntimeBaseUrl: 'http://localhost:3000/absproxy/5173/wasm-rust/runtime/'
			})
		);
	});

	it('passes the TinyGo runtime asset loader into the runtime module', async () => {
		const sandbox = new TinyGo();
		const loader = vi.fn(async () => null);

		await sandbox.load({
			tinygo: {
				moduleUrl: runtimeModuleUrl,
				assetLoader: loader
			}
		});

		expect(runtimeFixtureState.lastRuntimeOptions).toEqual(
			expect.objectContaining({
				assetLoader: loader,
				onProgress: expect.any(Function)
			})
		);
	});

	it('writes queued stdin when the TinyGo worker requests input', async () => {
		const sandbox = new TinyGo();
		const worker = new MockWorker();
		const code = resolveEditorDefaultSource('go', 'wasm32-wasip1');

		sandbox.worker = worker as unknown as Worker;
		let runMessage: any;
		worker.postMessage.mockImplementationOnce((message) => {
			runMessage = message;
			queueMicrotask(() => {
				sandbox.write('42\n');
				worker.onmessage?.({
					data: {
						buffer: true,
						results: true
					}
				} as MessageEvent<any>);
			});
		});

		await sandbox.load({
			rootUrl: '/absproxy/5173',
			tinygo: {
				moduleUrl: runtimeModuleUrl
			}
		});
		await expect(sandbox.run(code, false, true, undefined, ['demo'])).resolves.toBe(true);

		expect(readBufferedStdin(runMessage.buffer)).toBe('42\n');
	});

	it('fails load when no TinyGo runtime module url is configured outside localhost preview defaults', async () => {
		const sandbox = new TinyGo();
		const originalWindow = window;
		vi.stubGlobal('window', {
			location: {
				href: 'https://example.com/app'
			}
		});

		try {
			await expect(
				sandbox.load({
					tinygo: {}
				})
			).rejects.toThrow(
				'TinyGo runtime is not configured. Set runtimeAssets.tinygo.moduleUrl.'
			);
		} finally {
			vi.stubGlobal('window', originalWindow);
		}
	});

	it('prefers the browser runtime when only a TinyGo browser module is configured on localhost', async () => {
		const sandbox = new TinyGo();
		const outputs: string[] = [];
		const code = resolveEditorDefaultSource('go', 'wasm32-wasip1');
		window.history.replaceState({}, '', 'http://localhost:3000/absproxy/5173/');

		sandbox.output = (chunk: string) => outputs.push(chunk);

		await sandbox.load({
			tinygo: {
				moduleUrl: runtimeModuleUrl
			}
		});
		await expect(sandbox.run(code, false, true, undefined, ['demo'])).resolves.toBe(true);

		expect(fetch).not.toHaveBeenCalled();
		expect(runtimeFixtureState.bootCalls).toBe(1);
		expect(runtimeFixtureState.planCalls).toBe(1);
		expect(runtimeFixtureState.executeCalls).toBe(1);
		expect(outputs.join('')).toContain(
			'tinygo compiler module loaded from tools/tinygo-compiler.wasm (mode=direct)'
		);
		expect(outputs.join('')).toContain('tinygo artifact ready: /working/out.wasm');
		expect(outputs.join('')).toContain('tinygo-ok\n');
	});

	it('runs a browser fallback artifact when the runtime reports a main entrypoint', async () => {
		const sandbox = new TinyGo();
		const outputs: string[] = [];
		const code = resolveEditorDefaultSource('go', 'wasm32-wasip1');

		sandbox.output = (chunk: string) => outputs.push(chunk);

		await sandbox.load({
			rootUrl: '/absproxy/5173',
			tinygo: {
				moduleUrl: runtimeModuleUrl
			}
		});
		runtimeFixtureState.nextArtifact = {
			path: '/working/out.exec.wasm',
			bytes: new Uint8Array([0, 97, 115, 109]),
			runnable: true,
			entrypoint: 'main'
		};

		await expect(sandbox.run(code, false, true, undefined, ['demo'])).resolves.toBe(true);
		expect(workerInstances).toHaveLength(1);
		expect(workerInstances[0].postMessage).toHaveBeenCalledTimes(2);
		expect(workerInstances[0].postMessage).toHaveBeenNthCalledWith(1, { load: true });
		expect(workerInstances[0].postMessage).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({
				artifact: expect.any(Uint8Array),
				args: ['demo'],
				log: true
			})
		);
		expect(outputs.join('')).toContain('tinygo-ok\n');
	});

	it('rejects execution when the TinyGo runtime reports a bootstrap-only artifact', async () => {
		const sandbox = new TinyGo();
		const code = resolveEditorDefaultSource('go', 'wasm32-wasip1');

		await sandbox.load({
			rootUrl: '/absproxy/5173',
			tinygo: {
				moduleUrl: runtimeModuleUrl
			}
		});
		runtimeFixtureState.nextArtifact = {
			path: '/working/out.wasm',
			bytes: new Uint8Array([0, 97, 115, 109]),
			artifactKind: 'bootstrap',
			runnable: false,
			entrypoint: null,
			reason: 'bootstrap-artifact'
		};

		await expect(sandbox.run(code, false)).rejects.toContain(
			'TinyGo browser runtime produced a bootstrap artifact and cannot execute it yet.'
		);
		expect(workerInstances).toHaveLength(1);
		expect(workerInstances[0].postMessage).toHaveBeenCalledTimes(1);
		expect(workerInstances[0].postMessage).toHaveBeenNthCalledWith(1, { load: true });
	});

	it('rejects execution when the TinyGo browser runtime only produces a non-runnable probe artifact', async () => {
		const sandbox = new TinyGo();
		const code = resolveEditorDefaultSource('go', 'wasm32-wasip1');

		await sandbox.load({
			rootUrl: '/absproxy/5173',
			tinygo: {
				moduleUrl: runtimeModuleUrl
			}
		});
		runtimeFixtureState.nextArtifact = {
			path: '/working/out.wasm',
			bytes: new Uint8Array([0, 97, 115, 109]),
			artifactKind: 'probe',
			runnable: false,
			entrypoint: null,
			reason: 'missing-wasi-entrypoint'
		};

		await expect(sandbox.run(code, false)).rejects.toContain(
			'TinyGo browser runtime produced a non-runnable probe artifact without a supported WASI entrypoint.'
		);
		expect(workerInstances).toHaveLength(1);
		expect(workerInstances[0].postMessage).toHaveBeenCalledTimes(1);
		expect(workerInstances[0].postMessage).toHaveBeenNthCalledWith(1, { load: true });
	});

	it('surfaces a bootstrap fallback artifact directly when the browser runtime cannot execute it', async () => {
		const sandbox = new TinyGo();
		const code = resolveEditorDefaultSource('go', 'wasm32-wasip1');
		await sandbox.load({
			tinygo: {
				moduleUrl: runtimeModuleUrl
			}
		});
		runtimeFixtureState.nextArtifact = {
			path: '/working/out.wasm',
			bytes: new Uint8Array([0, 97, 115, 109]),
			artifactKind: 'bootstrap',
			runnable: false,
			entrypoint: null,
			reason: 'bootstrap-artifact'
		};

		await expect(sandbox.run(code, false)).rejects.toContain(
			'TinyGo browser runtime produced a bootstrap artifact and cannot execute it yet.'
		);
		expect(workerInstances).toHaveLength(1);
		expect(workerInstances[0].postMessage).toHaveBeenCalledTimes(1);
		expect(workerInstances[0].postMessage).toHaveBeenNthCalledWith(1, { load: true });
	});

	it('surfaces the browser runtime execution failure directly when no runnable artifact is produced', async () => {
		const sandbox = new TinyGo();
		const code = resolveEditorDefaultSource('go', 'wasm32-wasip1');

		await sandbox.load({
			tinygo: {
				moduleUrl: runtimeModuleUrl
			}
		});
		runtimeFixtureState.skipArtifact = true;
		runtimeFixtureState.nextExecutionFailureLine =
			'build execution failed: browser runtime stopped before linking a final artifact because the backend emitted a probe-only command artifact';

		const errorMessage = await sandbox.run(code, false).then(
			() => null,
			(error) => (error instanceof Error ? error.message : String(error))
		);
		expect(errorMessage).toContain(
			'TinyGo browser runtime could not produce a runnable execution artifact: build execution failed: browser runtime stopped before linking a final artifact because the backend emitted a probe-only command artifact.'
		);
		expect(workerInstances).toHaveLength(1);
		expect(workerInstances[0].postMessage).toHaveBeenCalledTimes(1);
		expect(workerInstances[0].postMessage).toHaveBeenNthCalledWith(1, { load: true });
	});
});
